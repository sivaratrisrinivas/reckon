import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {appendFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {promisify} from 'node:util';
import {providers} from 'near-api-js';
import {ForecastService, type OnChainPrediction} from '../../forecast.js';
import {publishBlobEvidence} from '../../evidence-store.js';
import {NearChain} from '../../testnet-chain.js';

// One real testnet round: refresh the oracle reference, publish with live providers and the
// restricted key, challenge from the challenger account, settle through price-oracle.testnet,
// and compare the outcome and payout with actual balances. Secrets are read from private files
// and the private .env; nothing secret is printed or written to the evidence file.
const run = promisify(execFile);
if (existsSync('.env')) process.loadEnvFile('.env');

const AGENT = process.env.RECKON_AGENT_ACCOUNT ?? 'reckon-srinivas-test-2026.testnet';
const CHALLENGER = process.env.RECKON_CHALLENGER_ACCOUNT ?? 'challenger.reckon-srinivas-test-2026.testnet';
const ORACLE = 'price-oracle.testnet';
const RPC = process.env.RECKON_TESTNET_RPC ?? 'https://rpc.testnet.near.org';
const MODEL_CALL_LIMIT = 6;
const PAID_ORACLE_LIMIT = 4;
const stateDirectory = '.local/runtime/live';
const roundId = process.argv[3] ?? new Date().toISOString().replace(/[:.]/g, '-');
const logPath = `${stateDirectory}/round-${roundId}.log`;
const provider = new providers.JsonRpcProvider({url: RPC});
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const NEAR = 10n ** 24n;

type Step = {step: string; at: string; [key: string]: unknown};
const steps: Step[] = [];

async function log(step: string, detail: Record<string, unknown> = {}): Promise<void> {
  const entry: Step = {step, at: new Date().toISOString(), ...detail};
  steps.push(entry);
  console.log(JSON.stringify(entry));
  await appendFile(logPath, `${JSON.stringify(entry)}\n`);
}

function formatNear(yocto: bigint): string {
  const digits = yocto.toString().padStart(25, '0');
  return `${digits.slice(0, -24)}.${digits.slice(-24)} NEAR`;
}

async function readSecret(name: string): Promise<string> {
  return (await readFile(`${stateDirectory}/${name}.key`, 'utf8')).trim();
}

async function account(accountId: string): Promise<{amount: bigint; storage: number; codeHash: string}> {
  const view = await provider.query({request_type: 'view_account', finality: 'optimistic', account_id: accountId}) as unknown as {amount: string; storage_usage: number; code_hash: string};
  return {amount: BigInt(view.amount), storage: view.storage_usage, codeHash: view.code_hash};
}

async function cost(hash: string, signer: string): Promise<{tokens_burnt: string; gas_burnt: string}> {
  const outcome = await provider.txStatus(hash, signer, 'FINAL') as unknown as {
    transaction_outcome: {outcome: {tokens_burnt: string; gas_burnt: number}};
    receipts_outcome: Array<{outcome: {tokens_burnt: string; gas_burnt: number}}>;
  };
  const all = [outcome.transaction_outcome.outcome, ...outcome.receipts_outcome.map(receipt => receipt.outcome)];
  return {
    tokens_burnt: all.reduce((sum, entry) => sum + BigInt(entry.tokens_burnt), 0n).toString(),
    gas_burnt: all.reduce((sum, entry) => sum + BigInt(entry.gas_burnt), 0n).toString(),
  };
}

async function receiptFailures(hash: string, signer: string): Promise<string[]> {
  const outcome = await provider.txStatus(hash, signer, 'FINAL') as unknown as {
    receipts_outcome: Array<{outcome: {executor_id: string; status: unknown}}>;
  };
  const failures: string[] = [];
  for (const receipt of outcome.receipts_outcome) {
    const status = receipt.outcome.status;
    if (typeof status === 'object' && status !== null && 'Failure' in status && status.Failure) {
      failures.push(`${receipt.outcome.executor_id}: ${JSON.stringify(status.Failure).slice(0, 300)}`);
    }
  }
  return failures;
}

async function cli(args: string[]): Promise<{hash: string; output: string}> {
  const {stdout, stderr} = await run('./scripts/with-local-env.sh', ['near', ...args], {maxBuffer: 8 * 1024 * 1024, timeout: 240_000});
  // Strip terminal colours; the CLI prints the transaction id on its own line.
  const output = `${stdout}\n${stderr}`.replace(/\u001b\[[0-9;]*m/g, '');
  const hash = /Transaction ID:\s*([1-9A-HJ-NP-Za-km-z]{43,44})/.exec(output)?.[1];
  if (!hash) throw new Error(`The CLI did not report a transaction id:\n${output.slice(-800)}`);
  return {hash, output};
}

async function ledgerCount(file: string): Promise<number> {
  try {
    return (JSON.parse(await readFile(`${stateDirectory}/${file}`, 'utf8')) as {count: number}).count;
  } catch {
    return 0;
  }
}

async function bump(file: string, limit: number, label: string): Promise<void> {
  const count = await ledgerCount(file);
  if (count >= limit) throw new Error(`${label} limit of ${limit} is already used`);
  await writeFile(`${stateDirectory}/${file}`, JSON.stringify({count: count + 1}), {mode: 0o600});
}

async function oraclePrice(): Promise<{usd: string | null; timestamp: string; recency: number}> {
  const response = await provider.query({
    request_type: 'call_function', finality: 'final', account_id: ORACLE, method_name: 'get_price_data',
    args_base64: Buffer.from(JSON.stringify({asset_ids: ['wrap.near']})).toString('base64'),
  }) as unknown as {result: number[]};
  const data = JSON.parse(Buffer.from(response.result).toString()) as {timestamp: string; recency_duration_sec: number; prices: Array<{price: {multiplier: string; decimals: number} | null}>};
  const price = data.prices[0].price;
  return {usd: price ? `${price.multiplier}e-${price.decimals}` : null, timestamp: data.timestamp, recency: data.recency_duration_sec};
}

const command = process.argv[2];
await mkdir(stateDirectory, {recursive: true, mode: 0o700});

const chain = new NearChain({
  networkId: 'testnet',
  rpcUrl: RPC,
  contractId: AGENT,
  predictionSecretKey: await readSecret('prediction-rehearsal-2'),
  keeperAccountId: CHALLENGER,
  keeperSecretKey: await readSecret('keeper-rehearsal-2'),
});

if (command === 'preflight') {
  const [agent, challenger, life, active] = await Promise.all([
    account(AGENT), account(CHALLENGER), chain.view('life'), chain.view('active_prediction'),
  ]);
  const wasm = await readFile(process.argv[4] ?? 'contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm');
  console.log(JSON.stringify({
    agent_balance: formatNear(agent.amount), agent_storage_bytes: agent.storage, agent_code_hash: agent.codeHash,
    local_wasm_sha256: createHash('sha256').update(wasm).digest('hex'),
    challenger_balance: formatNear(challenger.amount), life, active,
    model_calls_used: await ledgerCount('model-calls.json'), paid_oracle_calls_used: await ledgerCount('oracle-calls.json'),
    oracle_cache: await oraclePrice(),
  }, null, 2));
  process.exit(0);
}

if (command !== 'round') {
  console.error('Usage: tsx scripts/live/round.ts preflight|round [round-id]');
  process.exit(2);
}

const evidence: Record<string, unknown> = {round_id: roundId, network: 'testnet', agent: AGENT, challenger: CHALLENGER};
const costs: Array<{label: string; hash: string; signer: string; tokens_burnt: string; gas_burnt: string}> = [];
async function recordCost(label: string, hash: string, signer: string): Promise<void> {
  try {
    costs.push({label, hash, signer, ...await cost(hash, signer)});
  } catch (error) {
    await log('cost-unavailable', {label, hash, reason: error instanceof Error ? error.message.slice(0, 160) : String(error)});
  }
}

const balances: Record<string, {agent: string; challenger: string}> = {};
async function snapshotBalances(label: string): Promise<void> {
  const [agent, challenger] = await Promise.all([account(AGENT), account(CHALLENGER)]);
  balances[label] = {agent: agent.amount.toString(), challenger: challenger.amount.toString()};
  await log('balances', {label, agent: formatNear(agent.amount), challenger: formatNear(challenger.amount)});
}

const startLife = await chain.view<Record<string, string | boolean>>('life');
if (startLife.dead) throw new Error('The agent is dead');
if (await chain.view('active_prediction')) throw new Error('An unresolved prediction already exists');
await snapshotBalances('start');

// 1. Paid reference refresh. The cached reference is null until someone refreshes it.
await bump('oracle-calls.json', PAID_ORACLE_LIMIT, 'Paid oracle call');
const refresh = await cli([
  'contract', 'call-function', 'as-transaction', ORACLE, 'request_price_data',
  'json-args', '{"asset_ids":["wrap.near"],"resource_limits":null}',
  'prepaid-gas', '250 Tgas', 'attached-deposit', '0.02 NEAR',
  'sign-as', CHALLENGER, 'network-config', 'testnet', 'sign-with-legacy-keychain', 'send',
]);
await recordCost('reference refresh (request_price_data, 0.02 NEAR attached)', refresh.hash, CHALLENGER);
const refreshFailures = await receiptFailures(refresh.hash, CHALLENGER);
await log('reference-refresh-receipts', {transaction: refresh.hash, failures: refreshFailures});
if (refreshFailures.length > 0) throw new Error(`The paid reference refresh failed; stopping before any further paid step: ${refreshFailures.join(' | ')}`);
let referenceAfter = await oraclePrice();
for (let attempt = 0; !referenceAfter.usd && attempt < 30; attempt += 1) { await sleep(2_000); referenceAfter = await oraclePrice(); }
await log('reference-refresh', {transaction: refresh.hash, cache_after: referenceAfter});
if (!referenceAfter.usd) throw new Error('The oracle reference is still unavailable after the paid refresh');
await snapshotBalances('after-reference-refresh');

// 2. Live forecast through the same service code the browser uses.
const modelId = process.env.NEAR_AI_MODEL;
const modelKey = process.env.NEAR_AI_API_KEY;
const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
if (!modelId || !modelKey || !blobToken) throw new Error('Live providers need NEAR_AI_MODEL, NEAR_AI_API_KEY and BLOB_READ_WRITE_TOKEN in .env');
await bump('model-calls.json', MODEL_CALL_LIMIT, 'Model call');
const forecast = new ForecastService(chain.predictionChain(), {
  mode: 'live',
  evidenceDirectory: '.local/evidence',
  publishEvidence: (hash, canonical) => publishBlobEvidence(hash, canonical, blobToken),
  budgetPath: '.local/runtime/forecast-budget.json',
  lockPath: '.local/runtime/forecast.lock',
  modelApiKey: modelKey,
  modelId,
});
const forecastStartedAt = Date.now();
const forecastResult = await forecast.request();
await log('forecast', {status: forecastResult.status, elapsed_ms: Date.now() - forecastStartedAt, ...('reason' in forecastResult ? {reason: forecastResult.reason} : {}), ...('justification' in forecastResult ? {justification: forecastResult.justification} : {})});
evidence.forecast_status = forecastResult.status;
if (forecastResult.status !== 'published') {
  evidence.steps = steps;
  evidence.costs = costs;
  await writeFile(`${stateDirectory}/round-${roundId}.json`, JSON.stringify(evidence, null, 2), {mode: 0o600});
  console.log('No prediction was published; stopping without a challenge.');
  process.exit(0);
}
const published = forecastResult.prediction;
await log('published', {id: published.id, decision: published.decision, confidence_ppm: published.confidence_ppm, agent_stake: published.agent_stake, challenger_stake: published.challenger_stake, evidence_url: published.evidence_url, evidence_hash: published.evidence_hash, published_at_ns: published.published_at_ns, challenge_deadline_ns: published.challenge_deadline_ns, deadline_ns: published.deadline_ns, model_id: forecastResult.model_id});
await snapshotBalances('after-publication');

// 3. Challenge from the challenger account inside the thirty-second window.
const stake = BigInt(published.challenger_stake);
const challengerBefore = await account(CHALLENGER);
if (challengerBefore.amount < stake + NEAR / 20n) throw new Error('The challenger cannot cover the stake and gas');
const now = await chain.optimisticBlockTimestampNs();
const windowLeftMs = Number((BigInt(published.challenge_deadline_ns) - now) / 1_000_000n);
await log('challenge-window', {remaining_ms: windowLeftMs});
if (windowLeftMs < 8_000) throw new Error('Too little of the challenge window remains to submit a challenge safely');
const challenge = await cli([
  'contract', 'call-function', 'as-transaction', AGENT, 'challenge_prediction',
  'json-args', JSON.stringify({prediction_id: published.id}),
  'prepaid-gas', '30 Tgas', 'attached-deposit', formatNear(stake),
  'sign-as', CHALLENGER, 'network-config', 'testnet', 'sign-with-legacy-keychain', 'send',
]);
await recordCost('challenge_prediction', challenge.hash, CHALLENGER);
let challenged = await chain.view<OnChainPrediction>('get_prediction', {id: published.id});
for (let attempt = 0; challenged.challenger_account_id === null && attempt < 8; attempt += 1) { await sleep(1_500); challenged = await chain.view<OnChainPrediction>('get_prediction', {id: published.id}); }
await log('challenged', {transaction: challenge.hash, challenger_account_id: challenged.challenger_account_id, challenged_at_ns: challenged.challenged_at_ns});
if (challenged.challenger_account_id !== CHALLENGER) throw new Error('The challenge was not accepted');
await snapshotBalances('after-challenge');
const lifeChallenged = await chain.view<Record<string, string | boolean>>('life');

// 4. Keeper settlement after the deadline.
const deadline = BigInt(published.deadline_ns);
while (await chain.optimisticBlockTimestampNs() < deadline) await sleep(2_000);
const requestStartedAt = Date.now();
const request = await chain.keeperCall('request_settlement', {prediction_id: published.id});
await log('settlement-request', {transaction: request.transactionHash, succeeded: request.succeeded, failure: request.failure, gas_burnt_by_transaction_tree: request.gasBurnt.toString()});
await recordCost('request_settlement (keeper key; includes 0.02 NEAR oracle deposit taken from the agent)', request.transactionHash, CHALLENGER);
if (!request.succeeded) throw new Error(`Settlement request failed: ${request.failure}`);
await bump('oracle-calls.json', PAID_ORACLE_LIMIT, 'Paid oracle call');

let settled = await chain.view<OnChainPrediction>('get_prediction', {id: published.id});
const cutoff = deadline + 120n * 1_000_000_000n;
while (settled.settlement_status === 'observing' || settled.settlement_status === 'waiting') {
  if (await chain.optimisticBlockTimestampNs() >= cutoff) {
    const voided = await chain.keeperCall('void_unsettled_prediction', {prediction_id: published.id});
    await log('void-request', {transaction: voided.transactionHash, succeeded: voided.succeeded, failure: voided.failure});
    await recordCost('void_unsettled_prediction', voided.transactionHash, CHALLENGER);
  }
  await sleep(2_000);
  settled = await chain.view<OnChainPrediction>('get_prediction', {id: published.id});
}
await log('settled', {status: settled.settlement_status, outcome: settled.outcome, settlement_price: settled.settlement_price, settled_at_ns: settled.settled_at_ns, callback_after_request_ms: Date.now() - requestStartedAt, payment: settled.payment});

// 5. Wait for any payout or refund to be confirmed, retrying a failed attempt once.
let retried = false;
for (let waited = 0; settled.payment?.status === 'pending' && waited < 180_000; waited += 3_000) {
  await sleep(3_000);
  settled = await chain.view<OnChainPrediction>('get_prediction', {id: published.id});
  if (settled.payment?.status === 'pending' && !settled.payment.transfer_in_flight && !retried) {
    retried = true;
    const retry = await chain.keeperCall('retry_payment', {prediction_id: published.id});
    await log('payment-retry', {transaction: retry.transactionHash, succeeded: retry.succeeded, failure: retry.failure});
    await recordCost('retry_payment', retry.transactionHash, CHALLENGER);
  }
}
await sleep(4_000);
const finalPrediction = await chain.view<OnChainPrediction>('get_prediction', {id: published.id});
const lifeFinal = await chain.view<Record<string, string | boolean>>('life');
const summary = await chain.view<Record<string, string>>('prediction_summary');
await snapshotBalances('end');

// 6. Verification against actual balances. Gas is measured from the transactions' burnt tokens,
// so balance comparisons allow a small tolerance for gas-price movement and refund penalties.
const TOLERANCE = 5n * 10n ** 20n; // 0.0005 NEAR
const checks: Array<{check: string; ok: boolean; detail: string}> = [];
const agentStake = BigInt(published.agent_stake);
const challengerBalance = (label: string) => BigInt(balances[label].challenger);
const gasOf = (include: (label: string) => boolean) => costs.filter(entry => entry.signer === CHALLENGER && include(entry.label)).reduce((sum, entry) => sum + BigInt(entry.tokens_burnt), 0n);
const challengeGas = gasOf(label => label.startsWith('challenge_prediction'));
const keeperGas = gasOf(label => !label.startsWith('reference refresh') && !label.startsWith('challenge_prediction'));
const near = (value: bigint) => `${value} yocto (${formatNear(value < 0n ? -value : value)}${value < 0n ? ' debit' : ''})`;
const abs = (value: bigint) => (value < 0n ? -value : value);
const within = (actual: bigint, expected: bigint) => abs(actual - expected) <= TOLERANCE;
const challengerDelta = challengerBalance('end') - challengerBalance('after-publication');
const settledTotal = (life: Record<string, string | boolean>) => BigInt(life.spendable_bankroll as string) + BigInt(life.retired_bankroll as string);
if (finalPrediction.outcome === 'void') {
  const expected = -(challengeGas + keeperGas);
  checks.push({check: 'void: challenger stake refunded', ok: finalPrediction.payment?.status === 'paid' && within(challengerDelta, expected), detail: `challenger balance delta ${near(challengerDelta)}, expected only gas ${near(expected)}`});
} else if (finalPrediction.outcome === 'yes' || finalPrediction.outcome === 'no') {
  const challengerWon = finalPrediction.outcome !== finalPrediction.decision;
  if (challengerWon) {
    const expected = agentStake - challengeGas - keeperGas;
    checks.push({check: 'challenger won: received own stake plus the agent stake', ok: finalPrediction.payment?.status === 'paid' && within(challengerDelta, expected), detail: `challenger balance delta ${near(challengerDelta)}, expected agent stake less gas ${near(expected)}`});
    checks.push({check: 'challenger won: commitments and custody cleared, nothing pending', ok: lifeFinal.committed_bankroll === '0' && lifeFinal.challenger_custody === '0' && lifeFinal.pending_payment_liabilities === '0', detail: `committed ${lifeFinal.committed_bankroll} custody ${lifeFinal.challenger_custody} pending ${lifeFinal.pending_payment_liabilities}`});
  } else {
    const expected = -stake - challengeGas - keeperGas;
    checks.push({check: 'agent won: challenger lost exactly the stake plus gas', ok: within(challengerDelta, expected) && finalPrediction.payment === null, detail: `challenger balance delta ${near(challengerDelta)}, expected ${near(expected)}`});
    const expectedTotal = settledTotal(lifeChallenged) + agentStake + stake;
    checks.push({check: 'agent won: commitment released and challenger stake added to usable bankroll', ok: settledTotal(lifeFinal) === expectedTotal && lifeFinal.committed_bankroll === '0' && lifeFinal.challenger_custody === '0', detail: `spendable+retired after ${settledTotal(lifeFinal)} expected ${expectedTotal}; committed ${lifeFinal.committed_bankroll} custody ${lifeFinal.challenger_custody}`});
  }
}
const agentFinal = BigInt(balances.end.agent);
const claims = BigInt(lifeFinal.spendable_bankroll as string) + BigInt(lifeFinal.committed_bankroll as string) + BigInt(lifeFinal.challenger_custody as string) + BigInt(lifeFinal.pending_payment_liabilities as string) + BigInt(lifeFinal.retired_bankroll as string) + BigInt(lifeFinal.operational_reserve as string);
checks.push({check: 'agent account balance covers every recorded claim (spendable, committed, custody, pending, retired, reserve)', ok: agentFinal >= claims, detail: `balance ${agentFinal} claims ${claims} surplus ${agentFinal - claims}`});
await log('verification', {checks});

evidence.steps = steps;
evidence.costs = costs;
evidence.balances = balances;
evidence.final_prediction = finalPrediction;
evidence.life_start = startLife;
evidence.life_after_challenge = lifeChallenged;
evidence.life_final = lifeFinal;
evidence.prediction_summary = summary;
evidence.checks = checks;
await writeFile(`${stateDirectory}/round-${roundId}.json`, JSON.stringify(evidence, null, 2), {mode: 0o600});
console.log(`Round evidence written to ${stateDirectory}/round-${roundId}.json`);
