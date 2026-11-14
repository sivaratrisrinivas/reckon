import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import {readFile} from 'node:fs/promises';
import {PAYMENT_TRANSFER_TIMEOUT_SECONDS, SETTLEMENT_WINDOW_SECONDS, type ForecastService, type OnChainPrediction, type PredictionQuote, type ProviderMode} from './forecast.js';
import type {NearChain} from './testnet-chain.js';

// Testnet mode: the service never creates a chain, a wallet or a test control. It reads the public
// contract, runs the forecast pipeline, and submits transactions only with the two restricted
// keys held by NearChain (publication, and settlement/void/payment retry). Visitors bring their own
// wallet; no key of any account is ever sent to a browser.

export type UiLabels = Record<string, string>;
export type TestnetServiceConfig = {
  networkId: string;
  networkName: string;
  rpcUrl: string;
  agentAccountId: string;
  providerMode: ProviderMode;
  evidenceHosting: string;
  modelCallsPerUtcDay: number | null;
  settlementOracle: string;
  labels: UiLabels;
};

export type KeeperStatus = {
  running: boolean;
  last_tick_at: string | null;
  last_error: string | null;
  last_action: string | null;
  payments_needing_manual_recovery: string[];
};

const STATIC_FILES: Record<string, [string, string]> = {
  '/': ['public/index.html', 'text/html; charset=utf-8'],
  '/app.js': ['.local/browser/app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['public/style.css', 'text/css; charset=utf-8'],
};
const CHUNK = /^\/chunks\/([A-Za-z0-9_-]{1,64}\.js)$/;
const ACCOUNT_ID = /^(?=.{2,64}$)[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;
const PAYMENT_RETRY_INITIAL_DELAY_MS = 5_000;
const PAYMENT_RETRY_MAX_DELAY_MS = 120_000;
const SUBMISSION_GUARD_MS = 180_000;
const PAYMENT_SCAN_INTERVAL_MS = 15_000;

export function createTestnetService(deps: {
  chain: NearChain;
  forecast: ForecastService;
  config: TestnetServiceConfig;
  keeperPollMs?: number;
}): {server: Server; keeper: {start(): void; stop(): void; tick(): Promise<void>; status(): KeeperStatus}} {
  const {chain, forecast, config} = deps;
  const keeper = createKeeper(chain, deps.keeperPollMs ?? 2_000);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
      const route = `${req.method} ${url.pathname}`;
      if (route === 'GET /api/life') return json(res, 200, await chain.view('life'), noStore);
      if (route === 'GET /api/config') {
        return json(res, 200, {
          chain_mode: 'testnet',
          network: config.networkName,
          network_id: config.networkId,
          rpc_url: config.rpcUrl,
          contract_account_id: config.agentAccountId,
          provider_mode: config.providerMode,
          evidence_hosting: config.evidenceHosting,
          model_calls_per_utc_day: config.modelCallsPerUtcDay,
          settlement_window_seconds: SETTLEMENT_WINDOW_SECONDS,
          payment_transfer_timeout_seconds: PAYMENT_TRANSFER_TIMEOUT_SECONDS,
          settlement_oracle: config.settlementOracle,
          labels: config.labels,
        }, noStore);
      }
      if (route === 'GET /api/health') {
        const active = await chain.view<OnChainPrediction | null>('active_prediction');
        return json(res, 200, {chain_mode: 'testnet', agent_account_id: config.agentAccountId, active_prediction_id: active?.id ?? null, keeper: keeper.status()}, noStore);
      }
      if (route === 'GET /api/wallet/readiness') {
        const accountId = url.searchParams.get('account_id') ?? '';
        if (!ACCOUNT_ID.test(accountId)) return json(res, 400, {error: 'Invalid account id'});
        const [balance, maximumQuote] = await Promise.all([
          chain.availableBalance(accountId),
          chain.view<PredictionQuote>('quote_prediction', {confidence_ppm: 100_000}),
        ]);
        return json(res, 200, {
          network_id: config.networkId,
          account_id: accountId,
          account_exists: balance !== null,
          available_balance: (balance ?? 0n).toString(),
          required_challenge_balance: (BigInt(maximumQuote.challenger_stake) + 10n ** 23n).toString(),
        }, noStore);
      }
      if (route === 'GET /api/predictions/active') return json(res, 200, {prediction: await forecast.activePrediction()}, noStore);
      if (route === 'GET /api/predictions') {
        const start = url.searchParams.get('start_id') ?? '1';
        const limit = url.searchParams.get('limit') ?? '50';
        if (!validPredictionCursor(start) || !/^(?:[1-9]|[1-4]\d|50)$/.test(limit)) return json(res, 400, {error: 'Invalid prediction page'});
        return json(res, 200, await chain.view('list_predictions', {start_id: start, limit}), noStore);
      }
      if (route === 'GET /api/predictions/summary') return json(res, 200, await chain.view('prediction_summary'), noStore);
      if (route === 'POST /api/forecast') {
        const result = await forecast.request();
        const status = result.status === 'published' ? 201
          : result.status === 'busy' ? 409
            : result.status === 'cooldown' || result.status === 'rate_limited' ? 429
              : result.status === 'unavailable' ? 503 : 200;
        return json(res, status, result, noStore);
      }
      if (route === 'POST /api/payments/retry') {
        const body = await readJsonBody(req);
        const predictionId = body.prediction_id;
        if (typeof predictionId !== 'string' || !validPredictionCursor(predictionId)) return json(res, 400, {error: 'Invalid prediction id'});
        const outcome = await keeper.retryPayment(predictionId);
        return json(res, outcome.status, outcome.body, noStore);
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
      const chunk = CHUNK.exec(url.pathname);
      const file = chunk ? [`.local/browser/chunks/${chunk[1]}`, 'text/javascript; charset=utf-8'] : STATIC_FILES[url.pathname];
      if (!file || req.method !== 'GET') { res.writeHead(404).end(); return; }
      const body = await readFile(file[0]);
      res.writeHead(200, {'Content-Type': file[1], 'X-Content-Type-Options': 'nosniff'});
      res.end(body);
    } catch (error) {
      const status = error instanceof Error && error.message === 'Evidence snapshot was not found' ? 404
        : error instanceof Error && error.message === 'Evidence fingerprint does not match this snapshot' ? 409 : 503;
      const message = status === 404 ? 'Evidence snapshot was not found'
        : status === 409 ? 'Evidence fingerprint does not match this snapshot' : 'Chain or forecast provider unavailable';
      json(res, status, {error: message});
    }
  });

  return {server, keeper};
}

const noStore = {'Cache-Control': 'no-store'};

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', ...headers});
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage, maximumLength = 1_024): Promise<Record<string, unknown>> {
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

function createKeeper(chain: NearChain, pollMs: number) {
  const guards = new Map<string, number>();
  const paymentRetrySchedule = new Map<string, {nextAttemptAtMs: number; delayMs: number}>();
  const manualRecovery = new Set<string>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let ticking = false;
  let lastTickAt: string | null = null;
  let lastError: string | null = null;
  let lastAction: string | null = null;
  let paymentCursor = 1n;
  let lastPaymentScanMs = 0;

  function guarded(key: string): boolean {
    const until = guards.get(key);
    if (until !== undefined && until > Date.now()) return true;
    guards.set(key, Date.now() + SUBMISSION_GUARD_MS);
    return false;
  }

  async function submit(method: 'request_settlement' | 'void_unsettled_prediction' | 'retry_payment', predictionId: string): Promise<{succeeded: boolean; failure: string | null}> {
    const key = `${method}:${predictionId}`;
    if (guarded(key)) return {succeeded: false, failure: 'A submission for this prediction is already in flight'};
    try {
      const result = await chain.keeperCall(method, {prediction_id: predictionId});
      lastAction = `${method} ${predictionId} ${result.succeeded ? 'accepted' : 'rejected'} (${result.transactionHash})`;
      if (!result.succeeded) guards.delete(key);
      return result;
    } catch (error) {
      guards.delete(key);
      throw error;
    }
  }

  async function settleActive(): Promise<void> {
    const prediction = await chain.view<OnChainPrediction | null>('active_prediction');
    if (!prediction) return;
    const now = await chain.optimisticBlockTimestampNs();
    const deadline = BigInt(prediction.deadline_ns);
    const cutoff = deadline + BigInt(SETTLEMENT_WINDOW_SECONDS) * 1_000_000_000n;
    if (now >= cutoff) {
      // At or after the cutoff the contract gives voiding precedence over a late callback.
      void submit('void_unsettled_prediction', prediction.id).catch(recordError);
    } else if (now >= deadline && prediction.settlement_status === 'waiting') {
      // This block-time read only schedules a transaction; the contract checks its own execution time.
      void submit('request_settlement', prediction.id).catch(recordError);
    }
  }

  async function scanPayments(): Promise<void> {
    if (Date.now() - lastPaymentScanMs < PAYMENT_SCAN_INTERVAL_MS) return;
    lastPaymentScanMs = Date.now();
    const summary = await chain.view<{published: string}>('prediction_summary');
    const published = BigInt(summary.published);
    if (published === 0n) return;
    if (paymentCursor > published) paymentCursor = 1n;
    const predictions = await chain.view<OnChainPrediction[]>('list_predictions', {start_id: paymentCursor.toString(), limit: '50'});
    for (const prediction of predictions) {
      paymentCursor = BigInt(prediction.id) + 1n;
      const payment = prediction.payment;
      if (payment?.status !== 'pending') {
        paymentRetrySchedule.delete(prediction.id);
        manualRecovery.delete(prediction.id);
        continue;
      }
      if (payment.transfer_in_flight) {
        // Testnet has no receipt-proof verifier, so an unconfirmed transfer cannot be reconciled
        // by this keeper; it is surfaced for manual recovery instead of being guessed at.
        const startedAt = BigInt(payment.attempt_started_at_ns ?? '0');
        if (await chain.optimisticBlockTimestampNs() >= startedAt + BigInt(PAYMENT_TRANSFER_TIMEOUT_SECONDS) * 1_000_000_000n) manualRecovery.add(prediction.id);
        continue;
      }
      const schedule = paymentRetrySchedule.get(prediction.id);
      const now = Date.now();
      if (schedule && now < schedule.nextAttemptAtMs) continue;
      const delayMs = schedule?.delayMs ?? PAYMENT_RETRY_INITIAL_DELAY_MS;
      paymentRetrySchedule.set(prediction.id, {nextAttemptAtMs: now + delayMs, delayMs: Math.min(delayMs * 2, PAYMENT_RETRY_MAX_DELAY_MS)});
      guards.delete(`retry_payment:${prediction.id}`);
      await submit('retry_payment', prediction.id);
      break; // At most one recovery transaction per scan.
    }
  }

  function recordError(error: unknown): void {
    lastError = error instanceof Error ? error.message.slice(0, 200) : 'Keeper action failed';
  }

  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      await settleActive();
      await scanPayments();
      lastError = null;
    } catch (error) {
      recordError(error);
    } finally {
      lastTickAt = new Date().toISOString();
      ticking = false;
    }
  }

  return {
    start(): void {
      if (timer) return;
      timer = setInterval(() => { void tick(); }, pollMs);
      void tick();
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
    },
    tick,
    status(): KeeperStatus {
      return {running: timer !== null, last_tick_at: lastTickAt, last_error: lastError, last_action: lastAction, payments_needing_manual_recovery: [...manualRecovery]};
    },
    async retryPayment(predictionId: string): Promise<{status: number; body: unknown}> {
      const prediction = await chain.view<OnChainPrediction | null>('get_prediction', {id: predictionId});
      if (!prediction?.payment || prediction.payment.status !== 'pending') return {status: 409, body: {error: 'No pending payment for this prediction', prediction}};
      if (prediction.payment.transfer_in_flight) {
        return {status: 409, body: {error: 'A transfer attempt is still in flight; the contract refuses another until its callback arrives', prediction}};
      }
      guards.delete(`retry_payment:${predictionId}`);
      const result = await submit('retry_payment', predictionId);
      const updated = await chain.view<OnChainPrediction | null>('get_prediction', {id: predictionId});
      return result.succeeded ? {status: 200, body: {prediction: updated}} : {status: 409, body: {error: 'Payment retry was not accepted', prediction: updated}};
    },
  };
}
