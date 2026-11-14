import {createServer} from 'node:http';
import {existsSync} from 'node:fs';
import {readFile, readdir} from 'node:fs/promises';
import {KeyPairEd25519, Worker} from 'near-workspaces';
import {functionCallAccessKey} from 'near-api-js/lib/transaction.js';
import {ForecastService, PAYMENT_TRANSFER_TIMEOUT_SECONDS, type FixtureScenario, type OnChainPrediction, type PredictionChain, type PredictionQuote, type ProviderMode} from './forecast.js';
import {SETTLEMENT_WINDOW_SECONDS} from './forecast.js';
import {publishBlobEvidence} from './evidence-store.js';
import {ReceiptProofRelay, sandboxReceiptGenesis} from './receipt-proofs.js';
import {localSigner} from './local-signers.js';

// The credential-free local simulation never reads .env and never leaves fixture mode.
const demoLocal = process.env.RECKON_DEMO_LOCAL === '1';
if (!demoLocal && existsSync('.env')) process.loadEnvFile('.env');
const stateDirectory = process.env.RECKON_STATE_DIR ?? '.local';

const chainMode = process.env.RECKON_CHAIN ?? 'sandbox';
if (chainMode === 'testnet') {
  // Testnet mode has its own entry: no sandbox, no service-held wallet and no test endpoints.
  await import('./testnet-main.js');
  await new Promise<never>(() => undefined);
} else if (chainMode !== 'sandbox') {
  throw new Error('RECKON_CHAIN must be sandbox or testnet');
}

const providerMode = (process.env.RECKON_PROVIDER_MODE ?? 'fixture') as ProviderMode;
if (providerMode !== 'fixture' && providerMode !== 'live') throw new Error('RECKON_PROVIDER_MODE must be fixture or live');
if (providerMode === 'live' && (!process.env.NEAR_AI_API_KEY || !process.env.NEAR_AI_MODEL)) {
  throw new Error('Live mode requires NEAR_AI_API_KEY and NEAR_AI_MODEL; scripted forecasts are disabled.');
}
if (providerMode === 'live' && !process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Live mode requires BLOB_READ_WRITE_TOKEN for public evidence storage.');
if (demoLocal && providerMode !== 'fixture') throw new Error('The credential-free local simulation only runs fixture providers.');
let fixtureStorageUnavailable = false;
let testWalletNetworkId: string | null = null;

const worker = await Worker.init();
const root = worker.rootAccount;
const sandboxRpcUrl = (worker.provider as unknown as {connection: {url: string}}).connection.url;
const receiptGenesis = await sandboxReceiptGenesis(sandboxRpcUrl);
const paymentKeeper = await root.createSubAccount('payment-keeper', {initialBalance: 5n * 10n ** 24n});
const challengerWallet = await root.createSubAccount('challenger', {
  initialBalance: 25n * 10n ** 24n,
  ...(demoLocal ? {keyPair: localSigner('challenger')} : {}),
});
const challengerKey = await challengerWallet.getKey();
if (!challengerKey) throw new Error('The sandbox challenger wallet key is unavailable');
const predictionKey = demoLocal ? localSigner('prediction') : KeyPairEd25519.fromRandom();
const oracleFixture = providerMode === 'fixture'
  ? await root.devDeploy('contract/target/wasm32-unknown-unknown/release/reckon_oracle_fixture.wasm', {
    initialBalance: 5n * 10n ** 24n,
    method: 'new',
    args: {owner_id: root.accountId},
  })
  : null;
// The local simulation keeps the test endpoints but deploys the production Wasm, without the test-only callback fault.
const contractWasm = process.env.RECKON_TEST === '1' && !demoLocal
  ? 'contract/target/wasm32-unknown-unknown/release/reckon_contract_callback_fault.wasm'
  : 'contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm';
const contract = await root.devDeploy(contractWasm, {
  initialBalance: 120n * 10n ** 24n,
  ...(demoLocal ? {keyPair: localSigner('agent-full-access')} : {}),
  method: 'new',
  args: {
    receipt_genesis: receiptGenesis,
    initial_bankroll: (100n * 10n ** 24n).toString(),
    operational_reserve: (20n * 10n ** 24n).toString(),
    idle_life_ns: process.env.RECKON_LOCAL_IDLE_LIFE_NS ?? '900000000000',
    prediction_public_key: predictionKey.getPublicKey().toString(),
    oracle_account_id: oracleFixture?.accountId ?? 'price-oracle.testnet',
  },
});
await contract.batch(contract).addKey(
  predictionKey.getPublicKey(),
  functionCallAccessKey(contract.accountId, ['publish_prediction'], 5n * 10n ** 24n),
).transact();

const receiptRelay = await ReceiptProofRelay.open(sandboxRpcUrl, contract, `${stateDirectory}/runtime/payment-receipts/${receiptGenesis.genesis_hash}/${contract.accountId}.json`, paymentKeeper);

function submitPaymentOperation(method: string, args: Record<string, string>) {
  return receiptRelay.submit(method, args);
}

const chain: PredictionChain = {
  activePrediction: () => contract.view<OnChainPrediction | null>('active_prediction', {}),
  quotePrediction: confidencePpm => contract.view<PredictionQuote>('quote_prediction', {confidence_ppm: confidencePpm}),
  publishPrediction: input => contract.call<OnChainPrediction>(contract, 'publish_prediction', input, {
    signWithKey: predictionKey,
    gas: 250n * 10n ** 12n,
  }),
};
const forecast = new ForecastService(chain, {
  mode: providerMode,
  evidenceDirectory: `${stateDirectory}/evidence`,
  publishEvidence: async (hash, canonical) => {
    if (providerMode === 'live') return publishBlobEvidence(hash, canonical, process.env.BLOB_READ_WRITE_TOKEN!);
    if (fixtureStorageUnavailable) throw new Error('Evidence hosting is unavailable');
    return `https://evidence.reckon.invalid/${hash}.json`;
  },
  budgetPath: `${stateDirectory}/runtime/forecast-budget.json`,
  lockPath: `${stateDirectory}/runtime/forecast.lock`,
  modelApiKey: process.env.NEAR_AI_API_KEY,
  modelId: process.env.NEAR_AI_MODEL,
  testMode: process.env.RECKON_TEST === '1',
});

const files: Record<string, [string, string]> = {
  '/': ['public/index.html', 'text/html; charset=utf-8'],
  '/app.js': ['.local/browser/app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['public/style.css', 'text/css; charset=utf-8'],
  '/diagnostic': ['public/diagnostic.html', 'text/html; charset=utf-8'],
  '/diagnostic-evidence.json': ['docs/evidence/model-attempt-1.json', 'application/json; charset=utf-8'],
  '/diagnostic-instruct-evidence.json': ['docs/evidence/model-attempt-instruct.json', 'application/json; charset=utf-8'],
  '/diagnostic.js': ['public/diagnostic.js', 'text/javascript; charset=utf-8'],
};

let settlementKeeperRunning = false;
let paymentRecoveryInFlight = false;
const settlementRequestsInFlight = new Set<string>();
let paymentScanCursor = 1n;
const paymentRetrySchedule = new Map<string, {nextAttemptAtMs: number; delayMs: number}>();
const PAYMENT_RETRY_INITIAL_DELAY_MS = 5_000;
const PAYMENT_RETRY_MAX_DELAY_MS = 120_000;
const SETTLEMENT_REQUEST_SUBMISSION_TIMEOUT_MS = 15_000;

function submitSettlementRequest(predictionId: string): void {
  if (settlementRequestsInFlight.has(predictionId)) return;
  settlementRequestsInFlight.add(predictionId);
  const timeout = setTimeout(() => settlementRequestsInFlight.delete(predictionId), SETTLEMENT_REQUEST_SUBMISSION_TIMEOUT_MS);
  void submitPaymentOperation('request_settlement', {prediction_id: predictionId})
    .catch(() => undefined)
    .finally(() => {
      clearTimeout(timeout);
      settlementRequestsInFlight.delete(predictionId);
    });
}

async function runSettlementKeeper(): Promise<void> {
  if (settlementKeeperRunning) return;
  settlementKeeperRunning = true;
  try {
    const prediction = await contract.view<OnChainPrediction | null>('active_prediction', {});
    if (prediction) {
      const now = await readSandboxBlockTimestamp();
      const deadline = BigInt(prediction.deadline_ns);
      const cutoff = deadline + BigInt(SETTLEMENT_WINDOW_SECONDS) * 1_000_000_000n;
      if (now >= cutoff) {
        await submitPaymentOperation('void_unsettled_prediction', {prediction_id: prediction.id});
      } else if (now >= deadline && prediction.settlement_status === 'waiting') {
        // This block-time read only schedules a transaction; the contract checks its execution time.
        // If the request arrives too late, the next keeper tick can void after the cutoff.
        submitSettlementRequest(prediction.id);
      }
    }
    void retryPendingPayments().catch(() => undefined);
  } catch {
    // Settlement state is authoritative on chain; the next keeper tick rechecks it.
  } finally {
    settlementKeeperRunning = false;
  }
}

async function retryPendingPayments(): Promise<void> {
  if (paymentRecoveryInFlight) return;
  paymentRecoveryInFlight = true;
  try {
    await receiptRelay.recoverSubmitted();
    const summary = await contract.view<{published: string}>('prediction_summary', {});
    const published = BigInt(summary.published);
    if (published === 0n) return;
    if (paymentScanCursor > published) paymentScanCursor = 1n;
    const predictions = await contract.view<OnChainPrediction[]>('list_predictions', {
      start_id: paymentScanCursor.toString(),
      limit: '50',
    });
    for (const prediction of predictions) {
      paymentScanCursor = BigInt(prediction.id) + 1n;
      const payment = prediction.payment;
      if (payment?.status !== 'pending') {
        paymentRetrySchedule.delete(prediction.id);
        await receiptRelay.forget(prediction.id);
        continue;
      }
      // Timeout schedules verification, never another unconfirmed transfer.
      if (payment.transfer_in_flight) {
        const startedAt = BigInt(payment.attempt_started_at_ns ?? '0');
        if (await readSandboxBlockTimestamp() < startedAt + BigInt(PAYMENT_TRANSFER_TIMEOUT_SECONDS) * 1_000_000_000n) continue;
      }
      const now = Date.now();
      const schedule = paymentRetrySchedule.get(prediction.id);
      if (schedule && now < schedule.nextAttemptAtMs) continue;
      const delayMs = schedule?.delayMs ?? PAYMENT_RETRY_INITIAL_DELAY_MS;
      paymentRetrySchedule.set(prediction.id, {
        nextAttemptAtMs: now + delayMs,
        delayMs: Math.min(delayMs * 2, PAYMENT_RETRY_MAX_DELAY_MS),
      });
      let receipt;
      try {
        receipt = payment.transfer_in_flight
          ? await receiptRelay.reconcile(prediction.id, payment)
          : await submitPaymentOperation('retry_payment', {prediction_id: prediction.id});
      } catch {
        break; // The next tick resumes at the next record, preserving its backoff.
      }
      const updated = await contract.view<OnChainPrediction | null>('get_prediction', {id: prediction.id});
      if (receipt.succeeded && updated?.payment?.status === 'paid') {
        paymentRetrySchedule.delete(prediction.id);
        await receiptRelay.forget(prediction.id);
      }
      break; // At most one recovery transaction per keeper tick.
    }
  } finally {
    paymentRecoveryInFlight = false;
  }
}

async function readSandboxBlock(): Promise<{height: number; timestamp: bigint}> {
  const response = await fetch(sandboxRpcUrl, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 'reckon-settlement-keeper', method: 'block', params: {finality: 'optimistic'}}),
  });
  if (!response.ok) throw new Error('Sandbox block read failed');
  const body = await response.json() as {result?: {header?: {height?: number; timestamp_nanosec?: string}}};
  const height = body.result?.header?.height;
  const timestamp = body.result?.header?.timestamp_nanosec;
  if (!Number.isSafeInteger(height) || !timestamp || !/^\d+$/.test(timestamp)) throw new Error('Sandbox block metadata is missing');
  return {height: height as number, timestamp: BigInt(timestamp)};
}

async function readSandboxBlockTimestamp(): Promise<bigint> {
  return (await readSandboxBlock()).timestamp;
}

async function fastForwardSandboxSeconds(seconds: number): Promise<bigint> {
  const targetNs = BigInt(seconds) * 1_000_000_000n;
  const before = await readSandboxBlock();
  const sampleHeightDelta = Math.min(100, Math.max(1, Math.floor(seconds / 10)));
  await worker.provider.fastForward(sampleHeightDelta);
  let current = await readSandboxBlock();
  for (let attempt = 0; current.timestamp - before.timestamp < targetNs && attempt < 5; attempt += 1) {
    const elapsedNs = current.timestamp - before.timestamp;
    const elapsedHeight = current.height - before.height;
    if (elapsedNs <= 0n || elapsedHeight <= 0) throw new Error('Sandbox fast-forward did not advance block time');
    const remainingNs = targetNs - elapsedNs;
    const estimatedHeight = Number((remainingNs * BigInt(elapsedHeight) + elapsedNs - 1n) / elapsedNs);
    if (!Number.isSafeInteger(estimatedHeight)) throw new Error('Sandbox fast-forward estimate exceeded the safe range');
    await worker.provider.fastForward(Math.max(1, estimatedHeight));
    current = await readSandboxBlock();
  }
  if (current.timestamp - before.timestamp < targetNs) throw new Error('Sandbox fast-forward did not reach the requested block time');
  return current.timestamp;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    if (req.method === 'POST' && url.pathname === '/api/rpc') {
      const body = await readJsonBody(req, 1_048_576);
      const method = body.method;
      const allowedRpcMethods = ['query', 'block', 'status', 'broadcast_tx_commit', 'send_tx', 'tx'];
      if (typeof method !== 'string' || !allowedRpcMethods.includes(method)) {
        json(res, 400, {error: 'Unsupported local sandbox RPC method'});
        return;
      }
      const response = await fetch(sandboxRpcUrl, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body),
      });
      res.writeHead(response.status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
      res.end(await response.text());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/diagnostic/latest') {
      const names = await readdir('.local/diagnostic-runs').catch(() => []);
      const latest = names.filter(name => /^\d+(?:-[0-9a-f-]+)?\.json$/.test(name)).sort().at(-1);
      if (!latest) { json(res, 404, {error: 'No diagnostic run is available'}); return; }
      const body = await readFile(`.local/diagnostic-runs/${latest}`);
      res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
      res.end(body);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/life') {
      json(res, 200, await contract.view('life', {}), {'Cache-Control': 'no-store'});
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/config') {
      json(res, 200, {
        network: 'local NEAR sandbox · test money',
        network_id: testWalletNetworkId ?? 'sandbox',
        rpc_url: '/api/rpc',
        contract_account_id: contract.accountId,
        provider_mode: providerMode,
        evidence_hosting: providerMode === 'live' ? 'Vercel Blob public storage' : 'local deterministic storage fixture',
        model_calls_per_utc_day: providerMode === 'live' ? 12 : null,
        settlement_window_seconds: SETTLEMENT_WINDOW_SECONDS,
        payment_transfer_timeout_seconds: PAYMENT_TRANSFER_TIMEOUT_SECONDS,
        settlement_oracle: oracleFixture ? oracleFixture.accountId : 'price-oracle.testnet',
      }, {'Cache-Control': 'no-store'});
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/wallet') {
      const balance = await challengerWallet.balance();
      json(res, 200, {
        account_id: challengerWallet.accountId,
        public_key: challengerKey.getPublicKey().toString(),
        secret_key: challengerKey.toString(),
        available_balance: balance.available,
      }, {'Cache-Control': 'no-store'});
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/wallet/balance') {
      const balance = await challengerWallet.balance();
      json(res, 200, {available_balance: balance.available}, {'Cache-Control': 'no-store'});
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/wallet/readiness') {
      const [balance, maximumQuote] = await Promise.all([
        challengerWallet.balance(),
        contract.view<PredictionQuote>('quote_prediction', {confidence_ppm: 100_000}),
      ]);
      const requiredBalance = BigInt(maximumQuote.challenger_stake) + 10n ** 23n;
      json(res, 200, {
        network_id: testWalletNetworkId ?? 'sandbox',
        account_id: challengerWallet.accountId,
        available_balance: balance.available,
        required_challenge_balance: requiredBalance.toString(),
      }, {'Cache-Control': 'no-store'});
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/wallet/fund') {
      const receipt = await root.transfer(challengerWallet, 25n * 10n ** 24n);
      if (!receipt.succeeded) { json(res, 503, {error: 'Local sandbox funding was not accepted'}); return; }
      const balance = await challengerWallet.balance();
      json(res, 200, {available_balance: balance.available, funded_amount: (25n * 10n ** 24n).toString()}, {'Cache-Control': 'no-store'});
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/predictions/active') {
      json(res, 200, {prediction: await forecast.activePrediction()}, {'Cache-Control': 'no-store'});
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/predictions') {
      const start = url.searchParams.get('start_id') ?? '1';
      const limit = url.searchParams.get('limit') ?? '50';
      if (!validPredictionCursor(start) || !/^(?:[1-9]|[1-4]\d|50)$/.test(limit)) { json(res, 400, {error: 'Invalid prediction page'}); return; }
      json(res, 200, await contract.view('list_predictions', {start_id: start, limit}), {'Cache-Control': 'no-store'});
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/predictions/summary') {
      json(res, 200, await contract.view('prediction_summary', {}), {'Cache-Control': 'no-store'});
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/payments/retry') {
      const body = await readJsonBody(req);
      const predictionId = body.prediction_id;
      if (typeof predictionId !== 'string' || !validPredictionCursor(predictionId)) {
        json(res, 400, {error: 'Invalid prediction id'});
        return;
      }
      if (paymentRecoveryInFlight) {
        json(res, 409, {error: 'Another payment recovery is already in progress'});
        return;
      }
      paymentRetrySchedule.delete(predictionId);
      paymentRecoveryInFlight = true;
      try {
        const prediction = await contract.view<OnChainPrediction>('get_prediction', {id: predictionId});
        const receipt = prediction?.payment?.transfer_in_flight
          ? await receiptRelay.reconcile(predictionId, prediction.payment)
          : await submitPaymentOperation('retry_payment', {prediction_id: predictionId});
        const updated = await contract.view<OnChainPrediction | null>('get_prediction', {id: predictionId});
        if (!receipt.succeeded) {
          json(res, 409, {error: 'Payment retry was not accepted', prediction: updated});
          return;
        }
        if (updated?.payment?.status === 'paid') await receiptRelay.forget(predictionId);
        json(res, 200, {prediction: updated}, {'Cache-Control': 'no-store'});
      } catch {
        json(res, 409, {error: 'A finalized payment receipt is not available yet. The original liability remains recorded.'});
      } finally {
        paymentRecoveryInFlight = false;
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/forecast') {
      const result = await forecast.request();
      const statusCode = result.status === 'published' ? 201
        : result.status === 'busy' ? 409
          : result.status === 'cooldown' || result.status === 'rate_limited' ? 429
            : result.status === 'unavailable' ? 503 : 200;
      json(res, statusCode, result, {'Cache-Control': 'no-store'});
      return;
    }
    const evidence = /^\/api\/evidence\/([0-9a-f]{64})$/.exec(url.pathname);
    if (req.method === 'GET' && evidence) {
      const body = await forecast.readEvidence(evidence[1]);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="reckon-evidence-${evidence[1]}.json"`,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(body);
      return;
    }
    if (process.env.RECKON_TEST === '1' && req.method === 'POST' && url.pathname === '/test/advance') {
      const body = await readJsonBody(req);
      const seconds = body.seconds === undefined ? 300 : Number(body.seconds);
      if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 10_000) { json(res, 400, {error: 'Advance must be between 1 and 10,000 seconds'}); return; }
      const blockTimestamp = await fastForwardSandboxSeconds(seconds);
      await runSettlementKeeper();
      res.writeHead(204, {'X-Test-Sandbox-Timestamp': blockTimestamp.toString()}).end();
      return;
    }
    if (process.env.RECKON_TEST === '1' && req.method === 'POST' && url.pathname === '/test/accrue') {
      const receipt = await contract.callRaw(contract, 'accrue', {}, {gas: 30n * 10n ** 12n});
      if (!receipt.succeeded) { json(res, 409, {error: 'Death transition was not accepted'}); return; }
      res.writeHead(204).end();
      return;
    }
    if (process.env.RECKON_TEST === '1' && req.method === 'POST' && url.pathname === '/test/settlement-scenario') {
      const body = await readJsonBody(req);
      const scenario = body.scenario;
      const allowed = ['below', 'above', 'equal', 'invalid', 'invalid_units', 'stale', 'wrong_asset', 'wrong_request_id', 'stalled'];
      if (!oracleFixture || typeof scenario !== 'string' || !allowed.includes(scenario)) { json(res, 400, {error: 'Unsupported settlement fixture'}); return; }
      await root.call(oracleFixture, 'set_scenario', {scenario});
      res.writeHead(204).end();
      return;
    }
    if (process.env.RECKON_TEST === '1' && req.method === 'POST' && url.pathname === '/test/payment-scenario') {
      const body = await readJsonBody(req);
      if (body.scenario === 'callback-fail' || body.scenario === 'callback-restore') {
        await contract.call(contract, 'set_payment_callback_fault', {enabled: body.scenario === 'callback-fail'});
      } else if (body.scenario === 'fail') {
        const receipt = await challengerWallet.delete(root.accountId);
        if (!receipt.succeeded) { json(res, 503, {error: 'Could not remove the fixture payout beneficiary'}); return; }
      } else if (body.scenario === 'restore') {
        await root.createAccount(challengerWallet.accountId, {initialBalance: 1n * 10n ** 24n, keyPair: challengerKey});
      } else {
        json(res, 400, {error: 'Unsupported payment fixture'});
        return;
      }
      res.writeHead(204).end();
      return;
    }
    if (process.env.RECKON_TEST === '1' && req.method === 'POST' && url.pathname === '/test/wallet-scenario') {
      const body = await readJsonBody(req);
      if (body.scenario === 'wrong-network') {
        testWalletNetworkId = 'testnet';
      } else if (body.scenario === 'sandbox') {
        testWalletNetworkId = null;
      } else if (body.scenario === 'insufficient') {
        testWalletNetworkId = null;
        const balance = await challengerWallet.balance();
        const targetBalance = 1n * 10n ** 24n;
        const amount = BigInt(balance.available) - targetBalance;
        if (amount > 0n) {
          const receipt = await challengerWallet.transfer(root, amount);
          if (!receipt.succeeded) { json(res, 503, {error: 'Could not prepare the insufficient-funds fixture'}); return; }
        }
      } else {
        json(res, 400, {error: 'Unsupported wallet fixture'});
        return;
      }
      res.writeHead(204).end();
      return;
    }
    if (process.env.RECKON_TEST === '1' && req.method === 'POST' && url.pathname === '/test/challenge-race') {
      const prediction = await forecast.activePrediction();
      if (!prediction || prediction.challenger_account_id) { json(res, 409, {error: 'No open challenge is available'}); return; }
      const racer = await root.createSubAccount(`race-${Date.now()}`, {initialBalance: 25n * 10n ** 24n});
      await racer.call(contract, 'challenge_prediction', {prediction_id: prediction.id}, {attachedDeposit: BigInt(prediction.challenger_stake)});
      res.writeHead(204).end();
      return;
    }
    if (process.env.RECKON_TEST === '1' && req.method === 'POST' && url.pathname === '/test/forecast-scenario') {
      const body = await readJsonBody(req);
      const scenario = body.scenario;
      const allowed: FixtureScenario[] = ['publish', 'abstain', 'invalid-output', 'unsupported-confidence', 'stale-market', 'invalid-reference', 'unavailable-model', 'slow-publish'];
      if (providerMode !== 'fixture' || typeof scenario !== 'string' || (scenario !== 'unavailable-storage' && !allowed.includes(scenario as FixtureScenario))) {
        json(res, 400, {error: 'Unsupported forecast fixture'});
        return;
      }
      fixtureStorageUnavailable = scenario === 'unavailable-storage';
      forecast.setTestScenario(fixtureStorageUnavailable ? 'publish' : scenario as FixtureScenario);
      res.writeHead(204).end();
      return;
    }
    if (process.env.RECKON_TEST === '1' && req.method === 'POST' && url.pathname === '/test/reset-forecast-limits') {
      await forecast.resetTestLimits();
      res.writeHead(204).end();
      return;
    }
    if (process.env.RECKON_TEST === '1' && req.method === 'GET' && url.pathname === '/test/forecast-stats') {
      json(res, 200, forecast.testStats(), {'Cache-Control': 'no-store'});
      return;
    }

    const file = files[url.pathname];
    if (!file || req.method !== 'GET') { res.writeHead(404).end(); return; }
    const body = await readFile(file[0]);
    res.writeHead(200, {'Content-Type': file[1], 'X-Content-Type-Options': 'nosniff'});
    res.end(body);
  } catch (error) {
    const status = error instanceof Error && error.message === 'Evidence snapshot was not found' ? 404
      : error instanceof Error && error.message === 'Evidence fingerprint does not match this snapshot' ? 409 : 503;
    const message = status === 404 ? 'Evidence snapshot was not found'
      : status === 409 ? 'Evidence fingerprint does not match this snapshot' : 'Sandbox or forecast provider unavailable';
    json(res, status, {error: message});
  }
});

function json(res: import('node:http').ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', ...headers});
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: import('node:http').IncomingMessage, maximumLength = 1_024): Promise<Record<string, unknown>> {
  let content = '';
  for await (const chunk of req) {
    content += chunk.toString();
    if (content.length > maximumLength) throw new Error('Request body too large');
  }
  const value: unknown = content ? JSON.parse(content) : {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid request body');
  return value as Record<string, unknown>;
}

function validPredictionCursor(value: string): boolean {
  if (!/^[1-9]\d{0,19}$/.test(value)) return false;
  return BigInt(value) <= 18_446_744_073_709_551_615n;
}

const port = Number(process.env.PORT ?? 4389);
server.listen(port, '127.0.0.1', () => {
  const providerLabel = providerMode === 'fixture' ? 'scripted external providers for local use' : 'live evidence and model providers';
  console.log(`Reckon local sandbox (${providerLabel}): http://127.0.0.1:${port}`);
  if (demoLocal) console.log(`RECKON_DEMO_SANDBOX_RPC=${sandboxRpcUrl}`);
});
const settlementKeeper = setInterval(() => { void runSettlementKeeper(); }, 1_000);
void runSettlementKeeper();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    clearInterval(settlementKeeper);
    server.close(() => { void worker.tearDown().finally(() => process.exit()); });
  });
}
