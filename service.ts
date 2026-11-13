import {createServer} from 'node:http';
import {existsSync} from 'node:fs';
import {readFile, readdir} from 'node:fs/promises';
import {KeyPairEd25519, Worker} from 'near-workspaces';
import {functionCallAccessKey} from 'near-api-js/lib/transaction.js';
import {ForecastService, type FixtureScenario, type OnChainPrediction, type PredictionChain, type PredictionQuote, type ProviderMode} from './forecast.js';
import {SETTLEMENT_WINDOW_SECONDS} from './forecast.js';
import {publishBlobEvidence} from './evidence-store.js';

if (existsSync('.env')) process.loadEnvFile('.env');

const providerMode = (process.env.RECKON_PROVIDER_MODE ?? 'fixture') as ProviderMode;
if (providerMode !== 'fixture' && providerMode !== 'live') throw new Error('RECKON_PROVIDER_MODE must be fixture or live');
if (providerMode === 'live' && (!process.env.NEAR_AI_API_KEY || !process.env.NEAR_AI_MODEL)) {
  throw new Error('Live mode requires NEAR_AI_API_KEY and NEAR_AI_MODEL; scripted forecasts are disabled.');
}
if (providerMode === 'live' && !process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Live mode requires BLOB_READ_WRITE_TOKEN for public evidence storage.');
let fixtureStorageUnavailable = false;

const worker = await Worker.init();
const root = worker.rootAccount;
const sandboxRpcUrl = (worker.provider as unknown as {connection: {url: string}}).connection.url;
const challengerWallet = await root.createSubAccount('challenger', {initialBalance: 25n * 10n ** 24n});
const challengerKey = await challengerWallet.getKey();
if (!challengerKey) throw new Error('The sandbox challenger wallet key is unavailable');
const predictionKey = KeyPairEd25519.fromRandom();
const oracleFixture = providerMode === 'fixture'
  ? await root.devDeploy('contract/target/wasm32-unknown-unknown/release/reckon_oracle_fixture.wasm', {
    initialBalance: 5n * 10n ** 24n,
    method: 'new',
    args: {owner_id: root.accountId},
  })
  : null;
const contract = await root.devDeploy('contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm', {
  initialBalance: 120n * 10n ** 24n,
  method: 'new',
  args: {
    initial_bankroll: (100n * 10n ** 24n).toString(),
    operational_reserve: (20n * 10n ** 24n).toString(),
    idle_life_ns: '900000000000',
    prediction_public_key: predictionKey.getPublicKey().toString(),
    oracle_account_id: oracleFixture?.accountId ?? 'price-oracle.testnet',
  },
});
await contract.batch(contract).addKey(
  predictionKey.getPublicKey(),
  functionCallAccessKey(contract.accountId, ['publish_prediction'], 5n * 10n ** 24n),
).transact();

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
  evidenceDirectory: '.local/evidence',
  publishEvidence: async (hash, canonical) => {
    if (providerMode === 'live') return publishBlobEvidence(hash, canonical, process.env.BLOB_READ_WRITE_TOKEN!);
    if (fixtureStorageUnavailable) throw new Error('Evidence hosting is unavailable');
    return `https://evidence.reckon.invalid/${hash}.json`;
  },
  budgetPath: '.local/runtime/forecast-budget.json',
  lockPath: '.local/runtime/forecast.lock',
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
async function runSettlementKeeper(): Promise<void> {
  if (settlementKeeperRunning) return;
  settlementKeeperRunning = true;
  try {
    const prediction = await contract.view<OnChainPrediction | null>('active_prediction', {});
    if (!prediction) return;
    const now = await readSandboxBlockTimestamp();
    const deadline = BigInt(prediction.deadline_ns);
    const cutoff = deadline + BigInt(SETTLEMENT_WINDOW_SECONDS) * 1_000_000_000n;
    if (now >= cutoff) {
      await contract.callRaw(contract, 'void_unsettled_prediction', {prediction_id: prediction.id}, {gas: 250n * 10n ** 12n});
    } else if (now >= deadline && prediction.settlement_status === 'waiting') {
      await contract.callRaw(contract, 'request_settlement', {prediction_id: prediction.id}, {gas: 250n * 10n ** 12n});
    }
  } catch {
    // Settlement state is authoritative on chain; the next keeper tick rechecks it.
  } finally {
    settlementKeeperRunning = false;
  }
}

async function readSandboxBlockTimestamp(): Promise<bigint> {
  const response = await fetch(sandboxRpcUrl, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 'reckon-settlement-keeper', method: 'block', params: {finality: 'optimistic'}}),
  });
  if (!response.ok) throw new Error('Sandbox block read failed');
  const body = await response.json() as {result?: {header?: {timestamp_nanosec?: string}}};
  const timestamp = body.result?.header?.timestamp_nanosec;
  if (!timestamp || !/^\d+$/.test(timestamp)) throw new Error('Sandbox block timestamp is missing');
  return BigInt(timestamp);
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
        network_id: 'sandbox',
        rpc_url: '/api/rpc',
        contract_account_id: contract.accountId,
        provider_mode: providerMode,
        evidence_hosting: providerMode === 'live' ? 'Vercel Blob public storage' : 'local deterministic storage fixture',
        model_calls_per_utc_day: providerMode === 'live' ? 12 : null,
        settlement_window_seconds: SETTLEMENT_WINDOW_SECONDS,
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
      if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 600) { json(res, 400, {error: 'Advance must be between 1 and 600 seconds'}); return; }
      await worker.provider.fastForward(seconds);
      await runSettlementKeeper();
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
});
const settlementKeeper = setInterval(() => { void runSettlementKeeper(); }, 1_000);
void runSettlementKeeper();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    clearInterval(settlementKeeper);
    server.close(() => { void worker.tearDown().finally(() => process.exit()); });
  });
}
