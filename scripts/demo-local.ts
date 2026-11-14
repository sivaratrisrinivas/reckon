import {spawn, spawnSync, type ChildProcess} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {createServer, connect} from 'node:net';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {KeyPairEd25519} from 'near-workspaces';
import {addKey, createAccount, deleteKey, deployContract, fullAccessKey, functionCall, transfer, type Action} from 'near-api-js/lib/transaction.js';
import type {OnChainPrediction} from '../forecast.js';
import {localSigner} from '../local-signers.js';
import {describeStatus, NEAR, RpcError, SandboxChain, wasmExports, type ChainTransaction, type Signer, type TransactionOutcome} from './demo-local-chain.js';

// ---------------------------------------------------------------------------
// Fixed parameters of the simulation. Every value here is simulated or accelerated.
// ---------------------------------------------------------------------------
const repositoryRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const PRODUCTION_WASM = 'contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm';
const FAULT_WASM = 'contract/target/wasm32-unknown-unknown/release/reckon_contract_callback_fault.wasm';
const ORACLE_FIXTURE_WASM ='contract/target/wasm32-unknown-unknown/release/reckon_oracle_fixture.wasm';
// 100 NEAR of play money lasts 2,400 simulated seconds of idle upkeep instead of fifteen days.
const IDLE_LIFE_SECONDS = 2_400;
// The environment variable can only shorten the budget (used by the failure-path test), never extend it.
const requestedBudget = Number(process.env.RECKON_DEMO_BUDGET_SECONDS ?? 600);
const HARD_BUDGET_SECONDS = Number.isFinite(requestedBudget) && requestedBudget > 0 ? Math.min(600, requestedBudget) : 600;
const SECONDS_BEFORE_DEATH_AT_PUBLICATION = 100;
const ORACLE_REQUEST_DEPOSIT = NEAR / 50n;
const PREDICTION_HORIZON_SECONDS = 300;
const SETTLEMENT_CUTOFF_SECONDS = 120;
const GAS_30_TGAS = 30n * 10n ** 12n;
const BUDGET_EXCEEDED = 'The hard time budget was exceeded';

class DemoFailure extends Error {}

type Life = {
  initial_bankroll: string;
  spendable_bankroll: string;
  committed_bankroll: string;
  challenger_custody: string;
  retired_bankroll: string;
  operational_reserve: string;
  pending_payment_liabilities: string;
  remaining_life_ns: string;
  idle_life_ns: string;
  dead: boolean;
  death_at_ns: string;
};
type Summary = {published: string; valid_outcomes: string; correct_outcomes: string};
type ForecastResponse = {status: string; prediction?: OnChainPrediction; model_id?: string; evidence_url?: string; reason?: string};
type Snapshot = {life: Life; contractTotal: bigint; contractAvailable: bigint; challenger: bigint | null; lateTaker: bigint; height: number; stable: boolean};

// ---------------------------------------------------------------------------
// Narration and assertions
// ---------------------------------------------------------------------------
const startedAt = Date.now();
let assertionCount = 0;
let abortReason: string | null = null;
let holding = false;
const elapsed = () => Math.round((Date.now() - startedAt) / 1000);
const log = (line = '') => console.log(line);
const heading = (line: string) => log(`\n== ${line}  (t+${elapsed()}s)`);

// Assertions never stop the run: every failure is listed at the end and the command exits 1.
const failures: string[] = [];
function expect(condition: unknown, description: string, evidence?: string): void {
  const detail = evidence ? `  [${evidence}]` : '';
  if (!condition) {
    failures.push(`${description}${detail}`);
    log(`  FAIL ${description}${detail}`);
    return;
  }
  assertionCount += 1;
  log(`  PASS ${description}${detail}`);
}

function near(yocto: bigint): string {
  const sign = yocto < 0n ? '-' : '';
  const magnitude = yocto < 0n ? -yocto : yocto;
  return `${sign}${magnitude / NEAR}.${(magnitude % NEAR).toString().padStart(24, '0').slice(0, 6)} NEAR`;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise(done => setTimeout(done, milliseconds));
}

async function waitFor<T>(description: string, probe: () => Promise<T | null | undefined | false>, timeoutMs = 120_000, intervalMs = 500): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    if (abortReason) throw new DemoFailure(abortReason);
    const value = await probe();
    if (value) return value;
    if (Date.now() > until) throw new DemoFailure(`Timed out waiting for ${description}`);
    await sleep(intervalMs);
  }
}

// ---------------------------------------------------------------------------
// Process lifecycle: everything this command starts, it also stops and removes.
// ---------------------------------------------------------------------------
let workDirectory: string | null = null;
let service: ChildProcess | null = null;
let servicePort = 0;
let serviceLog = '';

function preflightFailure(message: string): never {
  throw new DemoFailure(message);
}

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => (typeof address === 'object' && address ? done(address.port) : fail(new Error('No free port'))));
    });
  });
}

function portIsOpen(port: number): Promise<boolean> {
  return new Promise(done => {
    const socket = connect({host: '127.0.0.1', port});
    socket.once('connect', () => { socket.destroy(); done(true); });
    socket.once('error', () => done(false));
  });
}

function processesReferencing(directory: string): number[] {
  const matches: number[] = [];
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
    try {
      if (readFileSync(`/proc/${entry}/cmdline`, 'utf8').includes(directory)) matches.push(Number(entry));
    } catch { /* the process ended while it was inspected */ }
  }
  return matches;
}

async function stopEverything(): Promise<void> {
  const child = service;
  service = null;
  if (child?.pid && child.exitCode === null) {
    const exited = new Promise<void>(done => child.once('exit', () => done()));
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
    const timedOut = await Promise.race([exited.then(() => false), sleep(25_000).then(() => true)]);
    if (timedOut) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
      await Promise.race([exited, sleep(5_000)]);
    }
  }
  if (workDirectory) {
    // Only processes whose command line names this run's private directory can be ours.
    for (const pid of processesReferencing(workDirectory)) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    }
    await sleep(300);
    const survivors = processesReferencing(workDirectory);
    await rm(workDirectory, {recursive: true, force: true});
    const portClosed = servicePort === 0 || !(await portIsOpen(servicePort));
    log('\n== Cleanup');
    log(`  ${survivors.length === 0 ? 'OK ' : 'FAIL'} no process started by this run is still running`);
    log(`  ${portClosed ? 'OK ' : 'FAIL'} service port ${servicePort || '(none)'} is closed`);
    log(`  ${existsSync(workDirectory) ? 'FAIL' : 'OK '} temporary data removed: ${workDirectory}`);
    if (survivors.length > 0 || !portClosed || existsSync(workDirectory)) process.exitCode = 1;
  }
}

function startServiceEnvironment(port: number, directory: string): NodeJS.ProcessEnv {
  // Whitelist the environment so no personal credential from the caller can reach the service.
  const passthrough = ['PATH', 'HOME', 'LD_LIBRARY_PATH', 'NEAR_SANDBOX_BIN_PATH', 'NEAR_SANDBOX_BINARY_PATH', 'LANG', 'CARGO_HOME', 'RUSTUP_HOME'];
  const environment: NodeJS.ProcessEnv = {};
  for (const name of passthrough) if (process.env[name] !== undefined) environment[name] = process.env[name];
  return {
    ...environment,
    TMPDIR: directory,
    PORT: String(port),
    RECKON_DEMO_LOCAL: '1',
    RECKON_TEST: '1',
    RECKON_PROVIDER_MODE: 'fixture',
    RECKON_LOCAL_IDLE_LIFE_NS: String(BigInt(IDLE_LIFE_SECONDS) * 1_000_000_000n),
    RECKON_STATE_DIR: join(directory, 'state'),
  };
}

async function startService(): Promise<{serviceUrl: string; sandboxRpc: string}> {
  servicePort = await freePort();
  const directory = workDirectory!;
  service = spawn('sh', ['scripts/with-archive-sandbox.sh', process.execPath, '--import', 'tsx', 'service.ts'], {
    cwd: repositoryRoot,
    env: startServiceEnvironment(servicePort, directory),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const child = service;
  let exited: number | null = null;
  child.once('exit', code => { exited = code ?? 1; });
  let serviceUrl = '';
  let sandboxRpc = '';
  const onData = (chunk: Buffer) => {
    serviceLog = (serviceLog + chunk.toString()).slice(-20_000);
    serviceUrl ||= /Reckon local sandbox .*: (http:\/\/127\.0\.0\.1:\d+)/.exec(serviceLog)?.[1] ?? '';
    sandboxRpc ||= /RECKON_DEMO_SANDBOX_RPC=(\S+)/.exec(serviceLog)?.[1] ?? '';
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  await waitFor('the real service and sandbox to start', async () => {
    if (exited !== null) throw new DemoFailure(`The service exited with code ${exited} during startup:\n${serviceLog.trim()}`);
    return serviceUrl && sandboxRpc ? true : null;
  }, 150_000, 250);
  return {serviceUrl, sandboxRpc};
}

// ---------------------------------------------------------------------------
// The simulated life
// ---------------------------------------------------------------------------
async function run(): Promise<void> {
  log('RECKON LOCAL SIMULATION: a complete life, real contract payments, verified death');
  log('  SIMULATED PRICES: a scripted NEAR/USD market and a fixture oracle replace live market data and the paid oracle.');
  log('  SCRIPTED FORECASTS: a deterministic model fixture always answers NO at 85% confidence; no inference runs.');
  log('  ACCELERATED TIMING: the sandbox clock is fast-forwarded and upkeep spends the bankroll in 2,400 simulated seconds.');
  log('  PLAY MONEY: sandbox NEAR on a disposable local chain; there are no live accounts, personal keys or funds.');
  log('  This run verifies lifecycle, payments, permissions and death. It does NOT demonstrate live forecasting skill.');
  log(`  Hard time budget: ${HARD_BUDGET_SECONDS} seconds; the run is stopped and fails if it is exceeded.`);

  if (process.env.RECKON_PROVIDER_MODE === 'live') {
    preflightFailure('npm run demo:local never runs live provider mode. Unset RECKON_PROVIDER_MODE and try again.');
  }
  workDirectory = await mkdtemp(join(tmpdir(), 'rkd-'));
  log(`  Private work directory (removed on exit): ${workDirectory}`);
  log(`  Orchestrator process id (SIGINT stops a --hold run cleanly): ${process.pid}`);
  log('  No .env file is read and credentials in your environment are not passed to the service.');

  heading('Preflight and build');
  const check = spawnSync('sh', ['scripts/check-local.sh'], {cwd: repositoryRoot, encoding: 'utf8', env: process.env});
  if (check.status !== 0) preflightFailure(`Local prerequisites are not ready:\n${(check.stderr || check.stdout).trim()}`);
  log('  PASS sandbox 2.14.0 and freshly compiled contract artifacts are present');
  const bundle = spawnSync('sh', ['scripts/build-browser.sh'], {cwd: repositoryRoot, encoding: 'utf8', env: process.env});
  if (bundle.status !== 0) preflightFailure(`The browser bundle did not build:\n${(bundle.stderr || bundle.stdout).trim()}`);
  log('  PASS browser bundle built at .local/browser/app.js');

  heading('Starting the real service, a real NEAR sandbox and the compiled agent contract');
  const {serviceUrl, sandboxRpc} = await startService();
  log(`  Local UI: ${serviceUrl}   (play money, simulated inputs)`);
  const direct = new SandboxChain(sandboxRpc);
  const proxied = new SandboxChain(`${serviceUrl}/api/rpc`);

  async function api<T>(method: 'GET' | 'POST', path: string, body?: object): Promise<{status: number; body: T}> {
    const response = await fetch(`${serviceUrl}${path}`, {
      method,
      headers: body ? {'Content-Type': 'application/json'} : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(180_000),
    });
    const text = await response.text();
    return {status: response.status, body: (text ? JSON.parse(text) : null) as T};
  }
  async function sandboxControl(path: string, body: object = {}): Promise<void> {
    const response = await api<unknown>('POST', path, body);
    if (response.status !== 204) throw new DemoFailure(`Local simulation control ${path} failed with HTTP ${response.status}`);
  }

  const config = (await api<{contract_account_id: string; provider_mode: string; settlement_oracle: string; evidence_hosting: string; network: string}>('GET', '/api/config')).body;
  const wallet = (await api<{account_id: string; secret_key: string; public_key: string}>('GET', '/api/wallet')).body;
  const agentId = config.contract_account_id;
  const oracleId = config.settlement_oracle;
  const lateTakerId = `late-taker.${wallet.account_id}`;
  const agentFullAccess: Signer = {accountId: agentId, key: localSigner('agent-full-access')};
  const predictionKey = localSigner('prediction');
  const challenger: Signer = {accountId: wallet.account_id, key: new KeyPairEd25519(wallet.secret_key.slice('ed25519:'.length))};
  const lateTaker: Signer = {accountId: lateTakerId, key: localSigner('late-taker')};
  const predictionPublicKey = predictionKey.getPublicKey().toString();

  heading('Simulation disclosures shipped by the real service and UI');
  expect(config.provider_mode === 'fixture', 'the service reports fixture provider mode, never live', config.provider_mode);
  expect(config.network.includes('test money'), 'the service labels the network as local sandbox test money', config.network);
  expect(config.evidence_hosting.includes('fixture'), 'evidence hosting is a labelled local fixture', config.evidence_hosting);
  const page = await (await fetch(`${serviceUrl}/`)).text();
  const appBundle = await (await fetch(`${serviceUrl}/app.js`)).text();
  for (const label of ['SCRIPTED LOCAL FIXTURES', 'SIMULATED PRICES', 'ACCELERATED TIMING', 'NOT LIVE FORECASTING SKILL']) {
    expect(appBundle.includes(label), `the UI bundle discloses "${label}" for fixture mode`);
  }
  expect(page.includes('LOCAL SANDBOX · TEST MONEY') && page.includes('NO LIVE WAGERING'), 'the UI page labels test money and no live wagering');
  expect(page.includes('accelerated upkeep'), 'the UI page states that upkeep is accelerated');
  expect(
    new KeyPairEd25519(wallet.secret_key.slice('ed25519:'.length)).getPublicKey().toString() === localSigner('challenger').getPublicKey().toString(),
    'the challenger signer is the deterministic public local key', wallet.public_key,
  );

  async function lifeNow(): Promise<Life> { return direct.view<Life>(agentId, 'life'); }
  async function activePrediction(): Promise<OnChainPrediction | null> { return direct.view<OnChainPrediction | null>(agentId, 'active_prediction'); }
  async function record(id: string): Promise<OnChainPrediction> {
    const prediction = await direct.view<OnChainPrediction | null>(agentId, 'get_prediction', {id});
    if (!prediction) throw new DemoFailure(`Prediction ${id} is missing`);
    return prediction;
  }
  async function summaryNow(): Promise<Summary> { return direct.view<Summary>(agentId, 'prediction_summary'); }
  async function totalOf(accountId: string): Promise<bigint | null> {
    try { return (await direct.accountState(accountId)).total; } catch (error) {
      if (error instanceof RpcError) return null;
      throw error;
    }
  }
  async function waitBlocks(count: number): Promise<void> {
    const target = (await direct.latest()).height + count;
    await waitFor(`${count} more blocks`, async () => (await direct.latest()).height >= target);
  }
  // Payment attempts by the keeper move money for a few blocks. Wait until none is in flight and no new
  // attempt starts, so a balance is never read in the middle of a transfer.
  async function paymentActivity(): Promise<{inFlight: bigint; signature: string}> {
    const records = await direct.view<OnChainPrediction[]>(agentId, 'list_predictions', {start_id: '1', limit: '50'});
    const flying = records.filter(prediction => prediction.payment?.status === 'pending' && prediction.payment.transfer_in_flight);
    return {
      inFlight: flying.reduce((total, prediction) => total + BigInt(prediction.payment!.amount), 0n),
      signature: records.map(prediction => `${prediction.id}:${prediction.payment?.attempt_id}:${prediction.payment?.status}:${prediction.payment?.transfer_in_flight}`).join('|'),
    };
  }
  async function settleBalances(): Promise<void> {
    for (let pass = 0; pass < 25; pass += 1) {
      const first = await paymentActivity();
      await waitBlocks(2); // let gas-refund and transfer-refund receipts land
      const second = await paymentActivity();
      if (first.inFlight === 0n && second.inFlight === 0n && first.signature === second.signature) return;
    }
  }
  // quick=true only waits three blocks, for use inside the 30-second challenge window; the result says
  // whether a keeper payment attempt was in flight, in which case exact balance deltas are not claimed.
  async function snapshot(quick = false): Promise<Snapshot> {
    if (quick) await waitBlocks(3); else await settleBalances();
    const before = await paymentActivity();
    const [life, state, challengerTotal, lateTakerTotal, latest] = await Promise.all([lifeNow(), direct.accountState(agentId), totalOf(challenger.accountId), totalOf(lateTaker.accountId), direct.latest()]);
    const after = await paymentActivity();
    const stable = before.inFlight === 0n && after.inFlight === 0n && before.signature === after.signature;
    return {life, contractTotal: state.total, contractAvailable: state.available, challenger: challengerTotal, lateTaker: lateTakerTotal ?? 0n, height: latest.height, stable};
  }
  const obligationsOf = (life: Life) => BigInt(life.spendable_bankroll) + BigInt(life.committed_bankroll) + BigInt(life.challenger_custody) + BigInt(life.retired_bankroll) + BigInt(life.pending_payment_liabilities);
  let unsolicitedFunds = 0n;
  // Compare recorded obligations with the contract account's actual funds.
  async function assertConserved(label: string): Promise<void> {
    await settleBalances();
    const life = await lifeNow();
    const state = await direct.accountState(agentId);
    const inFlight = (await paymentActivity()).inFlight;
    const obligations = obligationsOf(life);
    const reserve = BigInt(life.operational_reserve);
    const reserveUsed = obligations + reserve - state.total + unsolicitedFunds;
    expect(
      state.total <= obligations + reserve + unsolicitedFunds,
      `${label}: the account holds nothing beyond recorded obligations, reserve and unsolicited funds`,
      `held ${near(state.total)} <= obligations ${near(obligations)} + reserve ${near(reserve)} + unsolicited ${near(unsolicitedFunds)}`,
    );
    expect(
      obligations - inFlight <= state.available,
      `${label}: every recorded obligation (including ${near(BigInt(life.pending_payment_liabilities))} pending) is backed by available funds`,
      `obligations ${near(obligations)}${inFlight > 0n ? ` less ${near(inFlight)} mid-transfer` : ''} <= available ${near(state.available)}`,
    );
    log(`       operational reserve consumed so far by gas, storage and oracle fees: ${near(reserveUsed)} of ${near(reserve)}`);
  }
  function describeLife(life: Life): string {
    return `spendable ${near(BigInt(life.spendable_bankroll))}, committed ${near(BigInt(life.committed_bankroll))}, custody ${near(BigInt(life.challenger_custody))}, retired ${near(BigInt(life.retired_bankroll))}, pending liabilities ${near(BigInt(life.pending_payment_liabilities))}, dead ${life.dead}`;
  }
  async function attempt(signer: Signer, receiver: string, actions: Action[], expected: string, description: string, options: {nonce?: number} = {}): Promise<string> {
    let verdict: string;
    try {
      const outcome = await direct.send(signer, receiver, actions, options);
      verdict = outcome.succeeded ? `UNEXPECTEDLY SUCCEEDED (tx ${outcome.hash})` : `tx ${outcome.hash}: ${explain(outcome)}`;
    } catch (error) {
      if (!(error instanceof RpcError)) throw error;
      verdict = error.message;
    }
    expect(verdict.includes(expected), description, `rejected by the chain: ${expected}`);
    return verdict;
  }
  // A rejected contract call reports its reason in the failure status or the receipt logs.
  function explain(outcome: TransactionOutcome): string {
    return `${describeStatus(outcome.status)} | ${outcome.raw}`;
  }
  function because(outcome: TransactionOutcome): string {
    const reason = outcome.receipts.flatMap(receipt => receipt.outcome.logs).find(line => line.length > 0);
    return reason ?? describeStatus(outcome.status).slice(0, 160);
  }
  let rawResponseShown = false;
  // The call was accepted by the chain and then failed inside the contract. The contract's own message is
  // asserted when the node returns it; if the node only reports a generic WebAssembly trap, the rejection is
  // still asserted and the reason is attributed by the stated control, which succeeds when the condition holds.
  function expectRejected(outcome: TransactionOutcome, message: string, description: string, control: string): void {
    const text = explain(outcome);
    const named = text.includes(message);
    const generic = !named && /unreachable|panicked/i.test(text);
    if (generic && !rawResponseShown) {
      rawResponseShown = true;
      log(`       node response for the first generic rejection: ${outcome.raw.slice(0, 900)}`);
    }
    expect(
      !outcome.succeeded && (named || generic),
      description,
      `tx ${outcome.hash}: ${named ? `contract said "${message}"` : generic ? `the node reports a generic contract trap without the panic text; control: ${control}` : because(outcome)}`,
    );
  }
  async function evidenceTransactions(fromHeight: number, accept: (transaction: ChainTransaction) => boolean): Promise<ChainTransaction[]> {
    const latest = await direct.latest();
    return direct.transactions(fromHeight, latest.height, accept);
  }
  function printReceipts(outcome: TransactionOutcome, beneficiary?: string): void {
    for (const receipt of outcome.receipts) {
      const executor = receipt.outcome.executor_id;
      if (executor === beneficiary || receipt.outcome.status !== undefined && describeStatus(receipt.outcome.status).startsWith('Failure')) {
        log(`       receipt ${receipt.id.slice(0, 10)}... executed on ${executor}: ${describeStatus(receipt.outcome.status)}`);
      }
    }
  }

  // -------------------------------------------------------------------------
  heading('Baseline: the compiled contract, its keys and its funds');
  const wasmBytes = await readFile(join(repositoryRoot, PRODUCTION_WASM));
  const faultWasmBytes = await readFile(join(repositoryRoot, FAULT_WASM));
  const deployedCode = await direct.code(agentId);
  const baselineState = await direct.accountState(agentId);
  const deployedExports = wasmExports(deployedCode);
  const productionExports = wasmExports(wasmBytes);
  log(`       deployed on ${agentId}: ${deployedCode.length} bytes, chain code hash ${baselineState.codeHash} (the sandbox stores a normalised copy, so this is not the file's SHA-256)`);
  log(`       repository production Wasm: ${wasmBytes.length} bytes, SHA-256 ${createHash('sha256').update(wasmBytes).digest('hex')}`);
  expect(
    deployedExports.length > 0 && deployedExports.join() === productionExports.join(),
    `the deployed contract exports exactly the ${productionExports.length} functions of the repository production Wasm`,
    deployedExports.join(', '),
  );
  expect(
    wasmExports(faultWasmBytes).includes('set_payment_callback_fault') && !deployedExports.includes('set_payment_callback_fault'),
    'the test-only callback-fault build would add set_payment_callback_fault; the deployed contract does not export it',
  );
  const adminLike = deployedExports.filter(name => /withdraw|upgrade|owner|admin|migrate|add_key|delete_key|deploy/i.test(name));
  expect(adminLike.length === 0, 'the deployed contract exports no withdrawal, upgrade, owner, administrative or key-management method', adminLike.join(', ') || 'none');
  const deployedCodeHash = baselineState.codeHash;
  const baselineKeys = await direct.accessKeys(agentId);
  const fullAccessEntry = baselineKeys.find(entry => entry.permission === 'FullAccess');
  const restrictedEntry = baselineKeys.find(entry => typeof entry.permission === 'object');
  expect(baselineKeys.length === 2 && fullAccessEntry?.publicKey === agentFullAccess.key.getPublicKey().toString(), 'the rehearsal account starts with exactly one full-access key (the deterministic local key) and one restricted key');
  const restrictedPermission = typeof restrictedEntry?.permission === 'object' ? restrictedEntry.permission.FunctionCall : null;
  expect(
    restrictedEntry?.publicKey === predictionPublicKey && restrictedPermission?.method_names.length === 1 && restrictedPermission.method_names[0] === 'publish_prediction' && restrictedPermission.receiver_id === agentId,
    'the prediction key is a function-call key limited to publish_prediction on the agent account',
    `${predictionPublicKey}, allowance ${near(BigInt(restrictedPermission?.allowance ?? '0'))} (finite)`,
  );
  const initialLife = await lifeNow();
  expect(BigInt(initialLife.idle_life_ns) === BigInt(IDLE_LIFE_SECONDS) * 1_000_000_000n && !initialLife.dead, `accelerated upkeep is active: ${IDLE_LIFE_SECONDS} simulated seconds of idle life`, describeLife(initialLife));
  await assertConserved('at start');

  // Bystander and challenger accounts, funded with play money by the challenger wallet.
  const lateTakerCreation = await proxied.send(challenger, lateTaker.accountId, [createAccount(), transfer(5n * NEAR), addKey(lateTaker.key.getPublicKey(), fullAccessKey())]);
  expect(lateTakerCreation.succeeded, `the challenger wallet created and funded a second play-money account ${lateTaker.accountId}`, `tx ${lateTakerCreation.hash}`);

  heading('Restricted-key rehearsal in the disposable sandbox (before any lock)');
  log('  The sandbox account still has its full-access key. These checks use only the restricted prediction key.');
  const keysBefore = JSON.stringify(await direct.accessKeys(agentId));
  const totalBefore = (await direct.accountState(agentId)).total;
  const probeSigner: Signer = {accountId: agentId, key: predictionKey};
  await attempt(probeSigner, agentId, [transfer(NEAR)], 'RequiresFullAccess', 'the prediction key cannot transfer funds out of the agent account');
  await attempt(probeSigner, agentId, [deployContract(await readFile(join(repositoryRoot, ORACLE_FIXTURE_WASM)))], 'RequiresFullAccess', 'the prediction key cannot deploy or replace contract code');
  await attempt(probeSigner, agentId, [addKey(lateTaker.key.getPublicKey(), fullAccessKey())], 'RequiresFullAccess', 'the prediction key cannot add a full-access key');
  await attempt(probeSigner, agentId, [deleteKey(agentFullAccess.key.getPublicKey())], 'RequiresFullAccess', 'the prediction key cannot delete other keys');
  await attempt(probeSigner, agentId, [functionCall('accrue', {}, GAS_30_TGAS, 0n)], 'MethodNameMismatch', 'the prediction key cannot call any other contract method');
  await attempt(probeSigner, oracleId, [functionCall('publish_prediction', {}, GAS_30_TGAS, 0n)], 'ReceiverMismatch', 'the prediction key cannot call any other account');
  expect(JSON.stringify(await direct.accessKeys(agentId)) === keysBefore, 'rejected attempts changed no keys');
  expect((await direct.accountState(agentId)).total === totalBefore || (await direct.accountState(agentId)).total >= totalBefore - NEAR / 100n, 'rejected attempts moved no funds', near(totalBefore));
  const wrongKey = await direct.send(agentFullAccess, agentId, [functionCall('publish_prediction', {
    reference_multiplier: '340823333', reference_decimals: 8, decision: 'no', confidence_ppm: 850_000, evidence_hash: 'f'.repeat(64), evidence_url: 'https://evidence.reckon.invalid/not-a-real-snapshot.json',
  }, GAS_30_TGAS, 0n)]);
  expectRejected(wrongKey, 'Prediction key is not authorized', 'even the full-access key cannot publish: the contract checks the configured prediction key', 'the same call signed by the prediction key is accepted in scenario 1');
  const outsider = await direct.send(lateTaker, agentId, [functionCall('publish_prediction', {
    reference_multiplier: '340823333', reference_decimals: 8, decision: 'no', confidence_ppm: 850_000, evidence_hash: 'f'.repeat(64), evidence_url: 'https://evidence.reckon.invalid/not-a-real-snapshot.json',
  }, GAS_30_TGAS, 0n)]);
  expectRejected(outsider, 'Prediction key must call the agent account directly', 'an unauthorized account cannot publish a prediction', 'the prediction key publishes in scenario 1');
  const faultSetter = await direct.send(agentFullAccess, agentId, [functionCall('set_payment_callback_fault', {enabled: true}, GAS_30_TGAS, 0n)]);
  expect(!faultSetter.succeeded && explain(faultSetter).includes('MethodNotFound'), 'the production Wasm has no test-only fault method', `tx ${faultSetter.hash}: ${because(faultSetter)}`);
  expect(await activePrediction() === null && (await summaryNow()).published === '0', 'none of the unauthorized publications created a prediction');

  // -------------------------------------------------------------------------
  type RoundOptions = {
    number: number;
    title: string;
    oracle: 'below' | 'above' | 'stalled';
    taker: Signer;
  };
  type Round = {prediction: OnChainPrediction; afterTake: Snapshot; heightBefore: number};

  async function publishAndTake(options: RoundOptions): Promise<Round> {
    const heightBefore = (await direct.latest()).height;
    await sandboxControl('/test/settlement-scenario', {scenario: options.oracle});
    await sandboxControl('/test/reset-forecast-limits');
    const beforePublication = await lifeNow();
    const forecast = await api<ForecastResponse>('POST', '/api/forecast');
    expect(forecast.body.status === 'published' && forecast.body.prediction !== undefined, `the real service published prediction #${options.number} through its scripted model and simulated market`, `HTTP ${forecast.status} ${forecast.body.status}${forecast.body.reason ? `: ${forecast.body.reason}` : ''}`);
    if (forecast.body.status !== 'published' || !forecast.body.prediction) {
      throw new DemoFailure(`The service did not publish prediction #${options.number}: HTTP ${forecast.status} ${forecast.body.status} ${forecast.body.reason ?? ''}`);
    }
    const prediction = forecast.body.prediction;
    // The challenge window is only thirty seconds of chain time, so take the position before the other checks.
    const beforeTake = await snapshot(true);
    const take = await proxied.send(options.taker, agentId, [functionCall('challenge_prediction', {prediction_id: prediction.id}, GAS_30_TGAS, BigInt(prediction.challenger_stake))]);
    const afterTake = await snapshot(true);
    expect(forecast.body.model_id ==='fixture:reckon-test-forecast-v1', 'the model is the scripted fixture, not live inference', forecast.body.model_id);
    expect(prediction.decision === 'no' && prediction.confidence_ppm === 850_000, 'the scripted forecast is NO at 85%', `${prediction.decision} ${prediction.confidence_ppm / 10_000}%`);
    const cap = BigInt(beforePublication.spendable_bankroll) * 2n / 100n;
    expect(BigInt(prediction.agent_stake) <= cap, 'the agent stake respects the 2% spendable bankroll cap', `${near(BigInt(prediction.agent_stake))} <= ${near(cap)}`);
    expect(BigInt(prediction.challenger_stake) === (BigInt(prediction.agent_stake) * 150_000n + 425_000n) / 850_000n, 'the opposing stake is the fair-odds quote', near(BigInt(prediction.challenger_stake)));
    const evidence = await (await fetch(`${serviceUrl}/api/evidence/${prediction.evidence_hash}`)).text();
    expect(createHash('sha256').update(evidence).digest('hex') === prediction.evidence_hash, 'the downloadable evidence matches the on-chain fingerprint', prediction.evidence_hash);
    expect(evidence.includes('scripted deterministic providers for local sandbox only') && evidence.includes('not live forecasts'), 'the evidence snapshot labels itself as simulated and not a live forecast');
    const published = (await evidenceTransactions(heightBefore, transaction => transaction.methods.includes('publish_prediction') && transaction.receiverId === agentId))[0];
    expect(published?.signerId === agentId && published.publicKey === predictionPublicKey, 'the publication transaction was signed by the restricted prediction key', `tx ${published?.hash}`);

    expect(take.succeeded, `${options.taker.accountId} took the opposing side through the service RPC proxy, as the browser wallet does`, `tx ${take.hash}`);
    const stake = BigInt(prediction.challenger_stake);
    if (beforeTake.stable && afterTake.stable) {
      expect(afterTake.contractTotal - beforeTake.contractTotal === stake, 'the contract account received exactly the quoted challenger stake', near(stake));
    } else {
      log('       (exact deposit delta not claimed: a keeper payment retry was mid-transfer while balances were read; custody below still proves the stake)');
    }
    expect(BigInt(afterTake.life.challenger_custody) === stake && BigInt(afterTake.life.committed_bankroll) === BigInt(prediction.agent_stake), 'custody and commitment match the stakes', describeLife(afterTake.life));
    expect((await record(prediction.id)).challenger_account_id === options.taker.accountId, 'the contract recorded the real challenger account', options.taker.accountId);
    await assertConserved(`prediction #${options.number} after the challenge`);
    return {prediction, afterTake, heightBefore};
  }

  async function advance(seconds: number): Promise<void> {
    log(`  ... fast-forwarding the sandbox clock by ${seconds} simulated seconds (simulated time, not wall time)`);
    await sandboxControl('/test/advance', {seconds});
  }

  async function settle(round: Round, until: (prediction: OnChainPrediction) => boolean): Promise<OnChainPrediction> {
    return waitFor(`prediction #${round.prediction.id} to settle`, async () => {
      const current = await record(round.prediction.id);
      return until(current) ? current : null;
    }, 150_000);
  }

  // Round 1: agent win -------------------------------------------------------
  heading('Scenario 1 of 5: agent win (simulated price below the reference, scripted NO is correct)');
  const summary0 = await summaryNow();
  const round1 = await publishAndTake({number: 1, title: 'agent win', oracle: 'below', taker: challenger});
  await advance(PREDICTION_HORIZON_SECONDS);
  const settled1 = await settle(round1, prediction => prediction.outcome !== null);
  const after1 = await snapshot();
  expect(settled1.outcome === 'no' && settled1.payment === null, 'the agent won: outcome NO, no outgoing payment required', `settlement price ${settled1.settlement_price?.multiplier}e-${settled1.settlement_price?.decimals}`);
  expect(after1.contractTotal === round1.afterTake.contractTotal, 'no money left the contract account (conservation across an agent win)', near(after1.contractTotal));
  expect(after1.challenger === round1.afterTake.challenger, 'the losing challenger was paid nothing', near(after1.challenger ?? 0n));
  expect(obligationsOf(after1.life) === obligationsOf(round1.afterTake.life), 'recorded obligations are unchanged: custody moved into the agent bankroll', describeLife(after1.life));
  expect(BigInt(after1.life.challenger_custody) === 0n && BigInt(after1.life.committed_bankroll) === 0n, 'the commitment and custody were released');
  const summary1 = await summaryNow();
  expect(BigInt(summary1.valid_outcomes) === BigInt(summary0.valid_outcomes) + 1n && BigInt(summary1.correct_outcomes) === BigInt(summary0.correct_outcomes) + 1n, 'the correct forecast counts in the public accuracy record', JSON.stringify(summary1));
  const settlementTx1 = await evidenceTransactions(round1.afterTake.height, transaction => transaction.methods.includes('request_settlement') && transaction.receiverId === agentId);
  expect(settlementTx1.length === 1, 'exactly one settlement request transaction exists on chain', `tx ${settlementTx1[0]?.hash} by ${settlementTx1[0]?.signerId}`);
  await assertConserved('after the agent win');

  // Round 2: challenger win -------------------------------------------------
  heading('Scenario 2 of 5: challenger win (simulated price above the reference, scripted NO is wrong)');
  const round2 = await publishAndTake({number: 2, title: 'challenger win', oracle: 'above', taker: challenger});
  await advance(PREDICTION_HORIZON_SECONDS);
  const settled2 = await settle(round2, prediction => prediction.outcome !== null && prediction.payment?.status === 'paid');
  const after2 = await snapshot();
  const payout2 = BigInt(round2.prediction.agent_stake) + BigInt(round2.prediction.challenger_stake);
  expect(settled2.outcome === 'yes', 'the challenger won: outcome YES', `settlement price ${settled2.settlement_price?.multiplier}e-${settled2.settlement_price?.decimals}`);
  expect(settled2.payment?.beneficiary_account_id === challenger.accountId && BigInt(settled2.payment.amount) === payout2, 'the liability names the challenger and both stakes', `${near(payout2)} to ${settled2.payment?.beneficiary_account_id}`);
  expect(after2.challenger! - round2.afterTake.challenger! === payout2, 'the challenger account balance rose by exactly both stakes', `+${payout2} yocto`);
  expect(round2.afterTake.contractTotal - after2.contractTotal === payout2, 'the contract account balance fell by exactly the payout', `-${payout2} yocto`);
  expect(after2.lateTaker === round2.afterTake.lateTaker, 'an unrelated bystander account received nothing', near(after2.lateTaker));
  expect(BigInt(after2.life.pending_payment_liabilities) === 0n, 'no payment liability remains once the transfer receipt succeeded');
  const summary2 = await summaryNow();
  expect(BigInt(summary2.valid_outcomes) === BigInt(summary1.valid_outcomes) + 1n && summary2.correct_outcomes === summary1.correct_outcomes, 'the missed forecast counts as a valid, incorrect outcome', JSON.stringify(summary2));
  const settlementTx2 = await evidenceTransactions(round2.afterTake.height, transaction => transaction.methods.includes('request_settlement') && transaction.receiverId === agentId);
  expect(settlementTx2.length === 1, 'the settlement transaction and its payout receipts are on chain', `tx ${settlementTx2[0]?.hash} by ${settlementTx2[0]?.signerId}`);
  if (settlementTx2[0]) printReceipts(await direct.outcome(settlementTx2[0].hash, settlementTx2[0].signerId), challenger.accountId);
  await assertConserved('after the challenger win');

  // Round 3: void refund ---------------------------------------------------------
  heading('Scenario 3 of 5: void refund (the simulated oracle never answers)');
  const round3 = await publishAndTake({number: 3, title: 'void refund', oracle: 'stalled', taker: challenger});
  await advance(PREDICTION_HORIZON_SECONDS);
  const observing = await settle(round3, prediction => prediction.settlement_status === 'observing');
  expect(observing.outcome === null, 'the keeper asked the oracle and the round remains unresolved while it waits', `request ${observing.settlement_request_id}`);
  const early = await direct.send(lateTaker, agentId, [functionCall('void_unsettled_prediction', {prediction_id: round3.prediction.id}, GAS_30_TGAS, 0n)]);
  expectRejected(early, 'Settlement window is still open', 'nobody can void before the 120-second settlement window closes', 'the keeper voids the same round after the window closes');
  await advance(SETTLEMENT_CUTOFF_SECONDS + 5);
  const settled3 = await settle(round3, prediction => prediction.outcome === 'void' && prediction.payment?.status === 'paid');
  const after3 = await snapshot();
  const refund3 = BigInt(round3.prediction.challenger_stake);
  expect(settled3.outcome === 'void' && settled3.payment?.beneficiary_account_id === challenger.accountId && BigInt(settled3.payment.amount) === refund3, 'the round is void and the refund names the challenger', `${near(refund3)} to ${settled3.payment?.beneficiary_account_id}`);
  expect(after3.challenger! - round3.afterTake.challenger! === refund3, 'the challenger account balance rose by exactly the original stake', `+${refund3} yocto`);
  expect(round3.afterTake.contractTotal - after3.contractTotal === refund3 + ORACLE_REQUEST_DEPOSIT, 'the contract paid the refund plus the simulated oracle request fee, which came from its operational reserve', `-${refund3 + ORACLE_REQUEST_DEPOSIT} yocto`);
  expect(BigInt(after3.life.committed_bankroll) === 0n && BigInt(after3.life.challenger_custody) === 0n, 'the agent commitment was released and custody cleared');
  const summary3 = await summaryNow();
  expect(summary3.valid_outcomes === summary2.valid_outcomes && summary3.correct_outcomes === summary2.correct_outcomes, 'the void is excluded from accuracy', JSON.stringify(summary3));
  const voidTx = await evidenceTransactions(round3.afterTake.height, transaction => transaction.methods.includes('void_unsettled_prediction') && transaction.receiverId === agentId && transaction.signerId !== lateTaker.accountId);
  expect(voidTx.length === 1, 'the void transaction and refund receipt are on chain', `tx ${voidTx[0]?.hash} by ${voidTx[0]?.signerId}`);
  if (voidTx[0]) printReceipts(await direct.outcome(voidTx[0].hash, voidTx[0].signerId), challenger.accountId);
  await assertConserved('after the void refund');

  // Round 4: recoverable payment failure ---------------------------------------------------
  heading('Scenario 4 of 5: recoverable payment failure (the winning challenger account is deleted before payout)');
  const round4 = await publishAndTake({number: 4, title: 'payment failure', oracle: 'above', taker: challenger});
  await sandboxControl('/test/payment-scenario', {scenario: 'fail'});
  expect(await totalOf(challenger.accountId) === null, 'the beneficiary account no longer exists, so the payout transfer must fail');
  const challengerRemovedFromChain = await direct.accessKeys(lateTaker.accountId);
  expect(challengerRemovedFromChain.length === 1, 'the bystander account is unaffected');
  await advance(PREDICTION_HORIZON_SECONDS);
  const failed4 = await settle(round4, prediction => prediction.outcome !== null && prediction.payment !== null && !prediction.payment.transfer_in_flight);
  const after4 = await snapshot();
  const payout4 = BigInt(round4.prediction.agent_stake) + BigInt(round4.prediction.challenger_stake);
  expect(failed4.outcome === 'yes' && failed4.payment?.status === 'pending' && failed4.payment.beneficiary_account_id === challenger.accountId && BigInt(failed4.payment.amount) === payout4, 'the result stands and the failed payment stays a pending liability to the original beneficiary', `${near(payout4)} owed to ${failed4.payment?.beneficiary_account_id}, attempt ${failed4.payment?.attempt_id}`);
  expect(BigInt(after4.life.pending_payment_liabilities) >= payout4 && after4.contractTotal >= round4.afterTake.contractTotal - NEAR / 1000n, 'the failed transfer returned the funds to the contract, still recorded as a liability', describeLife(after4.life));
  await assertConserved('while the payment failure is outstanding');
  const retryTransactions = await evidenceTransactions(round4.afterTake.height, transaction => transaction.methods.includes('retry_payment') && transaction.receiverId === agentId);
  log(`       the keeper has submitted ${retryTransactions.length} retry_payment attempt(s) so far; each is rejected while the beneficiary is absent`);
  const liability4 = BigInt(failed4.payment!.amount);

  // Round 5: permanent death -------------------------------------------------------
  heading('Scenario 5 of 5: permanent death (upkeep exhausts the bankroll in the middle of a challenged round)');
  const lifeBeforeDeathRound = await lifeNow();
  const remainingSeconds = Number(BigInt(lifeBeforeDeathRound.remaining_life_ns) / 1_000_000_000n);
  const jump = remainingSeconds - SECONDS_BEFORE_DEATH_AT_PUBLICATION;
  expect(jump >= 1 && jump <= 10_000, `the agent is still alive with ${remainingSeconds} simulated seconds of life; skipping idle time to leave ${SECONDS_BEFORE_DEATH_AT_PUBLICATION}`, describeLife(lifeBeforeDeathRound));
  await advance(jump);
  const round5 = await publishAndTake({number: 5, title: 'death', oracle: 'below', taker: lateTaker});
  const lifeAtTake = await lifeNow();
  expect(!lifeAtTake.dead, 'the agent is alive when it publishes and accepts its last challenge', `${Number(BigInt(lifeAtTake.remaining_life_ns) / 1_000_000_000n)} simulated seconds of life left`);
  await advance(PREDICTION_HORIZON_SECONDS);
  const settled5 = await settle(round5, prediction => prediction.outcome !== null);
  const dead = await snapshot();
  expect(dead.life.dead, 'the contract reports the agent permanently dead', describeLife(dead.life));
  expect(BigInt(dead.life.death_at_ns) > 0n && BigInt(dead.life.death_at_ns) < BigInt(settled5.deadline_ns), 'death was recorded at the exact depletion instant, before the round ended', `death_at_ns ${dead.life.death_at_ns}`);
  expect(settled5.outcome === 'no' && settled5.payment === null, 'the correct late forecast still resolved normally after death', `outcome ${settled5.outcome}`);
  expect(BigInt(dead.life.spendable_bankroll) === 0n, 'the late win did not revive the agent: spendable bankroll is zero');
  expect(BigInt(dead.life.retired_bankroll) >= BigInt(lifeAtTake.retired_bankroll) + BigInt(round5.prediction.agent_stake) + BigInt(round5.prediction.challenger_stake), 'both late stakes were retired rather than returned to usable bankroll', near(BigInt(dead.life.retired_bankroll)));
  expect(BigInt(dead.life.committed_bankroll) === 0n && BigInt(dead.life.challenger_custody) === 0n, 'the commitment and custody were released after the late result');
  const stillPending = await record(round4.prediction.id);
  expect(stillPending.payment?.status === 'pending' && BigInt(dead.life.pending_payment_liabilities) === liability4, 'the earlier failed payment is still an outstanding liability, preserved through death', describeLife(dead.life));
  await assertConserved('after death');

  heading('Death is irreversible: blocked publication, blocked takes and unsolicited funds');
  const publishedBeforeBlocked = (await summaryNow()).published;
  await sandboxControl('/test/reset-forecast-limits');
  const blocked = await api<ForecastResponse>('POST', '/api/forecast');
  expect(blocked.body.status !== 'published', 'the real service cannot publish a new prediction for the dead agent', `HTTP ${blocked.status} ${blocked.body.status}: ${blocked.body.reason ?? ''}`);
  const restrictedAfterDeath = await direct.send({accountId: agentId, key: predictionKey}, agentId, [functionCall('publish_prediction', {
    reference_multiplier: '340823333', reference_decimals: 8, decision: 'no', confidence_ppm: 850_000, evidence_hash: 'e'.repeat(64), evidence_url: 'https://evidence.reckon.invalid/after-death.json',
  }, GAS_30_TGAS, 0n)]);
  expectRejected(restrictedAfterDeath, 'permanently dead', 'the restricted prediction key is still valid, but the contract refuses to publish after death', 'the same key published five predictions while the agent was alive, and no prediction is active');
  expect(await activePrediction() === null && (await summaryNow()).published === publishedBeforeBlocked, 'no prediction exists or was created after death', `published ${publishedBeforeBlocked}`);
  const takerBefore = await totalOf(lateTaker.accountId);
  const contractBeforeTake = (await direct.accountState(agentId)).total;
  const lateTake = await direct.send(lateTaker, agentId, [functionCall('challenge_prediction', {prediction_id: round5.prediction.id}, GAS_30_TGAS, NEAR)]);
  expectRejected(lateTake, 'not the active challenge', 'a take after death is rejected by the contract', 'the same account took the position in scenario 5 while the agent was alive');
  const nextTake = await direct.send(lateTaker, agentId, [functionCall('challenge_prediction', {prediction_id: String(Number(round5.prediction.id) + 1)}, GAS_30_TGAS, NEAR)]);
  expect(!nextTake.succeeded, 'a take on a would-be next prediction is rejected too', `tx ${nextTake.hash}: ${because(nextTake)}`);
  await waitBlocks(5);
  const takerAfter = await totalOf(lateTaker.accountId);
  expect((await direct.accountState(agentId)).total === contractBeforeTake, 'the rejected 1 NEAR deposits were refunded: the contract account balance did not change', near(contractBeforeTake));
  expect(takerBefore !== null && takerAfter !== null && takerBefore - takerAfter < NEAR / 50n, 'the rejected taker lost only gas, not the deposits', `lost ${near((takerBefore ?? 0n) - (takerAfter ?? 0n))}`);
  const deadLife = await lifeNow();
  const donation = await direct.send(lateTaker, agentId, [transfer(NEAR)]);
  unsolicitedFunds += NEAR;
  const lifeAfterDonation = await lifeNow();
  expect(donation.succeeded && lifeAfterDonation.dead && BigInt(lifeAfterDonation.spendable_bankroll) === 0n && lifeAfterDonation.retired_bankroll === deadLife.retired_bankroll, 'an unsolicited 1 NEAR transfer cannot revive the agent or change its bankroll', `tx ${donation.hash}`);
  await assertConserved('after a plain transfer to the dead agent');

  heading('Rehearsing the lock in the disposable sandbox: remove the full-access key');
  log('  REHEARSAL ONLY. This removes the key of a throwaway sandbox account. The final live lock is a separate,');
  log('  approval-gated action that this command does not perform and does not simulate as real.');
  const keysPreLock = await direct.accessKeys(agentId);
  const oldKeyNonce = keysPreLock.find(entry => entry.publicKey === agentFullAccess.key.getPublicKey().toString())!.nonce;
  const removal = await direct.send(agentFullAccess, agentId, [deleteKey(agentFullAccess.key.getPublicKey())]);
  expect(removal.succeeded, 'the full-access key removed itself in the sandbox', `tx ${removal.hash}`);
  const keysAfterLock = await direct.accessKeys(agentId);
  const remaining = keysAfterLock[0];
  expect(
    keysAfterLock.length === 1 && remaining.publicKey === predictionPublicKey && typeof remaining.permission === 'object' && remaining.permission.FunctionCall.method_names.join() === 'publish_prediction',
    'afterwards the account has exactly one key: the function-call key limited to publish_prediction', JSON.stringify(remaining.permission),
  );
  const totalAfterLock = (await direct.accountState(agentId)).total;
  await attempt(agentFullAccess, agentId, [transfer(NEAR)], 'AccessKeyNotFound', 'the old authority can no longer transfer funds', {nonce: oldKeyNonce + 10});
  await attempt(agentFullAccess, agentId, [deployContract(await readFile(join(repositoryRoot, ORACLE_FIXTURE_WASM)))], 'AccessKeyNotFound', 'the old authority can no longer deploy or replace the contract', {nonce: oldKeyNonce + 11});
  await attempt(agentFullAccess, agentId, [addKey(lateTaker.key.getPublicKey(), fullAccessKey())], 'AccessKeyNotFound', 'the old authority can no longer add keys', {nonce: oldKeyNonce + 12});
  expect(JSON.stringify(await direct.accessKeys(agentId)) === JSON.stringify(keysAfterLock) && (await direct.accountState(agentId)).total === totalAfterLock, 'the failed old-authority attempts changed no keys, code or funds');
  expect((await direct.accountState(agentId)).codeHash === deployedCodeHash, 'the deployed code is unchanged by the lock', deployedCodeHash);
  await attempt({accountId: agentId, key: predictionKey}, agentId, [transfer(NEAR)], 'RequiresFullAccess', 'the remaining restricted key still cannot transfer');

  heading('Existing obligations are recovered after death and after the lock');
  const liabilityBefore = await record(round4.prediction.id);
  expect(liabilityBefore.payment?.status === 'pending', 'the failed payment is still owed to the original beneficiary', `${near(liability4)} to ${liabilityBefore.payment?.beneficiary_account_id}`);
  await sandboxControl('/test/payment-scenario', {scenario: 'restore'});
  expect(await totalOf(challenger.accountId) !== null, 'the beneficiary account was restored (it is the same account and key)');
  const retry = await waitFor('the payment liability to be recovered', async () => {
    const response = await api<{prediction?: OnChainPrediction; error?: string}>('POST', '/api/payments/retry', {prediction_id: round4.prediction.id});
    const current = await record(round4.prediction.id);
    if (current.payment?.status === 'paid') return current;
    if (response.status === 409) await sleep(1_500);
    return null;
  }, 120_000, 500);
  await waitBlocks(5);
  const challengerFinal = await totalOf(challenger.accountId);
  expect(retry.payment?.beneficiary_account_id === challenger.accountId && BigInt(retry.payment.amount) === liability4, 'recovery paid the original beneficiary and the original amount', `${near(liability4)} to ${retry.payment?.beneficiary_account_id}`);
  expect(challengerFinal === NEAR + liability4, 'the beneficiary balance equals its 1 NEAR restore balance plus exactly one payout', `${challengerFinal} yocto`);
  const recovered = await snapshot();
  expect(BigInt(recovered.life.pending_payment_liabilities) === 0n && recovered.life.dead && BigInt(recovered.life.spendable_bankroll) === 0n, 'the liability is cleared while the agent stays dead with zero spendable bankroll', describeLife(recovered.life));
  const duplicate = await direct.send(lateTaker, agentId, [functionCall('retry_payment', {prediction_id: round4.prediction.id}, GAS_30_TGAS, 0n)]);
  expectRejected(duplicate, 'already confirmed', 'a third party cannot trigger a second payment of a confirmed liability', 'the first retry paid the liability exactly once');
  await waitBlocks(5);
  expect(await totalOf(challenger.accountId) === challengerFinal, 'the beneficiary balance did not change after the duplicate retry');
  const paidTransactions = await evidenceTransactions(round4.afterTake.height, transaction => transaction.methods.includes('retry_payment') && transaction.receiverId === agentId && transaction.signerId !== lateTaker.accountId);
  const paidAttempt = await Promise.all(paidTransactions.map(async transaction => ({transaction, outcome: await direct.outcome(transaction.hash, transaction.signerId)})));
  const successful = paidAttempt.filter(entry => entry.outcome.receipts.some(receipt => receipt.outcome.executor_id === challenger.accountId && describeStatus(receipt.outcome.status) === 'Success'));
  log(`       ${paidAttempt.length} retry_payment transaction(s) in total; ${successful.length} delivered the payout`);
  expect(successful.length === 1, 'exactly one retry transaction delivered the payout (never twice)', `tx ${successful[0]?.transaction.hash} by ${successful[0]?.transaction.signerId}`);
  if (successful[0]) printReceipts(successful[0].outcome, challenger.accountId);
  await assertConserved('after every liability was confirmed');
  const finalLife = await lifeNow();
  expect(finalLife.dead && BigInt(finalLife.remaining_life_ns) === 0n, 'the agent is permanently dead at the end of the life', describeLife(finalLife));
  const finalSummary = await summaryNow();
  expect(finalSummary.published === '5' && finalSummary.valid_outcomes === '4' && finalSummary.correct_outcomes === '2', 'the permanent record: 5 published, 4 valid outcomes, 2 correct, 1 void', JSON.stringify(finalSummary));

  if (failures.length > 0) throw new DemoFailure(`${failures.length} assertion(s) failed; ${assertionCount} passed.`);

  heading('Summary');
  log('  1. agent win        prediction #1 outcome NO,   no payment');
  log(`  2. challenger win    prediction #2 outcome YES,  ${near(payout2)} paid to ${challenger.accountId}`);
  log(`  3. void refund       prediction #3 void,         ${near(refund3)} refunded to ${challenger.accountId}`);
  log(`  4. payment failure   prediction #4 outcome YES,  ${near(liability4)} failed, stayed owed, recovered after death`);
  log('  5. permanent death   prediction #5 outcome NO,   both late stakes retired, agent dead and irreversible');
  log(`  Restricted-key permissions and the sandbox lock rehearsal verified; final live locking was NOT performed.`);

  log(`\nASSERTIONS PASSED: ${assertionCount}`);
  log(`DEMO RESULT: PASS in ${elapsed()}s of the ${HARD_BUDGET_SECONDS}s hard budget`);
  if (process.argv.includes('--hold')) {
    log(`\nHOLDING: the final state is live at ${serviceUrl}. Press Ctrl-C to stop the service and clean up.`);
    holding = true;
    await new Promise<void>(done => {
      process.once('SIGINT', () => done());
      process.once('SIGTERM', () => done());
    });
  }
}

// ---------------------------------------------------------------------------
async function main(): Promise<number> {
  const budget = setTimeout(() => {
    abortReason = `${BUDGET_EXCEEDED}: ${HARD_BUDGET_SECONDS} seconds`;
    console.error(`\nDEMO RESULT: FAIL after ${elapsed()}s. ${abortReason}.`);
    void stopEverything().finally(() => process.exit(1));
  }, HARD_BUDGET_SECONDS * 1000);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      if (holding) return; // the hold prompt handles this signal
      abortReason = `Interrupted by ${signal}`;
      void stopEverything().finally(() => process.exit(130));
    });
  }
  let code = 0;
  try {
    await run();
  } catch (error) {
    code = 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n${message}`);
    if (!(error instanceof DemoFailure) && error instanceof Error && error.stack) console.error(error.stack);
    if (failures.length > 0) console.error(`\nFailed assertions:\n${failures.map(failure => `  - ${failure}`).join('\n')}`);
    if (serviceLog && service) console.error(`\nLast service output:\n${serviceLog.trim().split('\n').slice(-15).join('\n')}`);
    console.error(`DEMO RESULT: FAIL after ${elapsed()}s (${assertionCount} assertions had passed)`);
  } finally {
    clearTimeout(budget);
    await stopEverything();
  }
  return code || (process.exitCode as number | undefined) || 0;
}

process.exit(await main());
