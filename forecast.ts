import {createHash} from 'node:crypto';
import {mkdir, open, readFile, rename, stat, unlink, writeFile, type FileHandle} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {validateModel, validateOracleReport} from './diagnostic/validate.js';

const QUESTION = 'Will the NEAR/USD settlement price be strictly above the reference price?';
const RULES = `${QUESTION} The prediction deadline is five minutes after publication. The challenge window is thirty seconds after publication. Settlement uses the first successful valid oracle request initiated after the deadline and completed within a bounded settlement window. Caller timing and provider caching affect the observation; it is not an exact historical expiry price. Equal prices resolve to no. If no valid result arrives in the window, the prediction is void.`;
const SYSTEM_PROMPT = 'Return a structured judgment using only the supplied evidence. Confidence is the probability that your selected side is correct. You may abstain with null confidence when the evidence is insufficient.';
const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'forecast',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        decision: {type: 'string', enum: ['yes', 'no', 'abstain']},
        confidence: {type: ['number', 'null']},
        justification: {type: 'string'},
      },
      required: ['decision', 'confidence', 'justification'],
      additionalProperties: false,
    },
  },
};
const ORACLE_RPC = 'https://rpc.testnet.near.org';
const ORACLE_ACCOUNT = 'price-oracle.testnet';
const ORACLE_ASSET = 'wrap.near';
const CANDLES_URL = 'https://api.coinbase.com/api/v3/brokerage/market/products/NEAR-USD/candles';
const CANDLE_MAX_AGE_SECONDS = 180;
const REFERENCE_MAX_AGE_MS = 600_000;
const MODEL_TIMEOUT_MS = 30_000;
const PROVIDER_TIMEOUT_MS = 12_000;
const REQUEST_COOLDOWN_MS = 30_000;
const MAX_MODEL_ATTEMPTS_PER_UTC_DAY = 12;
const STALE_OPERATION_LOCK_MS = 180_000;
const CONFIDENCE_SCALE = 1_000_000;
const MIN_CONFIDENCE_PPM = 100_000;
const MAX_CONFIDENCE_PPM = 900_000;

type Decision = 'yes' | 'no';
export type FixtureScenario = 'publish' | 'abstain' | 'invalid-output' | 'unsupported-confidence' | 'stale-market' | 'invalid-reference' | 'unavailable-model' | 'slow-publish';
export type ProviderMode = 'fixture' | 'live';

export type OnChainPrediction = {
  id: string;
  question: string;
  reference_multiplier: string;
  reference_decimals: number;
  decision: Decision;
  confidence_ppm: number;
  agent_stake: string;
  challenger_stake: string;
  evidence_hash: string;
  published_at_ns: string;
  challenge_deadline_ns: string;
  deadline_ns: string;
};

export type PredictionQuote = {
  confidence_ppm: number;
  agent_stake: string;
  challenger_stake: string;
  minimum_agent_stake: string;
  minimum_challenger_stake: string;
  confidence_scale: number;
};

export type PredictionChain = {
  activePrediction(): Promise<OnChainPrediction | null>;
  quotePrediction(confidencePpm: number): Promise<PredictionQuote>;
  publishPrediction(input: {
    reference_multiplier: string;
    reference_decimals: number;
    decision: Decision;
    confidence_ppm: number;
    evidence_hash: string;
  }): Promise<OnChainPrediction>;
};

export type ForecastResult =
  | {status: 'published'; prediction: OnChainPrediction; evidence_url: string; provider_mode: ProviderMode; model_id: string}
  | {status: 'abstained'; justification: string; provider_mode: ProviderMode; model_id: string}
  | {status: 'unavailable'; reason: string; provider_mode: ProviderMode}
  | {status: 'busy'; prediction?: OnChainPrediction | null}
  | {status: 'cooldown'; retry_after_ms: number}
  | {status: 'rate_limited'; retry_after_ms: number};

type Candle = {start: string; open: string; high: string; low: string; close: string; volume: string};
type CollectedEvidence = {
  provider_mode: ProviderMode;
  collected_at: string;
  market: {
    provider: string;
    product: string;
    fetched_at: string;
    maximum_completed_candle_age_seconds: number;
    completed_candles: Candle[];
  };
  reference: {
    provider: string;
    account: string;
    asset_id: string;
    block_height: number | null;
    fetched_at: string;
    multiplier: string;
    decimals: number;
    usd: string;
    response_timestamp_ns: string;
    provider_recency_seconds: number;
    response_age_ns: string;
    provider_report_age_upper_bound_ns: string;
    validated_at: string;
    external_observation_time_verified: false;
  };
  question_and_rules: string;
};

type StoredBudget = {utc_day: string; last_request_at_ms: number; model_attempts: number};
type PublicationValidation = {
  checked_at: string;
  completed_candle_age_seconds: number;
  reference_response_age_ns: string;
  provider_report_age_upper_bound_ns: string;
  reference_maximum_age_ms: number;
};

export class ForecastService {
  private operation: Promise<ForecastResult> | null = null;
  private fixtureScenario: FixtureScenario = 'publish';
  private fixtureModelCalls = 0;
  private bypassCooldownForTest = false;

  constructor(
    private readonly chain: PredictionChain,
    private readonly options: {
      mode: ProviderMode;
      evidenceDirectory: string;
      budgetPath: string;
      lockPath: string;
      modelApiKey?: string;
      modelId?: string;
      cooldownMs?: number;
      now?: () => number;
      testMode?: boolean;
    },
  ) {
    if (options.mode === 'live' && (!options.modelApiKey || !options.modelId)) {
      throw new Error('Live mode requires NEAR_AI_API_KEY and NEAR_AI_MODEL; scripted forecasts are disabled.');
    }
  }

  async activePrediction(): Promise<OnChainPrediction | null> {
    return this.chain.activePrediction();
  }

  async request(): Promise<ForecastResult> {
    if (this.operation) return this.operation;
    const operation = Promise.resolve().then(() => this.run());
    this.operation = operation;
    try {
      return await operation;
    } finally {
      if (this.operation === operation) this.operation = null;
    }
  }

  setTestScenario(scenario: FixtureScenario): void {
    if (!this.options.testMode) throw new Error('Test controls are unavailable');
    this.fixtureScenario = scenario;
  }

  resetTestLimits(): void {
    if (!this.options.testMode) throw new Error('Test controls are unavailable');
    this.bypassCooldownForTest = true;
  }

  testStats(): {fixture_model_calls: number} {
    return {fixture_model_calls: this.fixtureModelCalls};
  }

  async readEvidence(hash: string): Promise<string> {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('Evidence snapshot was not found');
    let contents: string;
    try {
      contents = await readFile(join(this.options.evidenceDirectory, `${hash}.json`), 'utf8');
    } catch (error) {
      if (isCode(error, 'ENOENT')) throw new Error('Evidence snapshot was not found');
      throw error;
    }
    if (createHash('sha256').update(contents).digest('hex') !== hash) {
      throw new Error('Evidence fingerprint does not match this snapshot');
    }
    return contents;
  }

  private async run(): Promise<ForecastResult> {
    let release: (() => Promise<void>) | undefined;
    try {
      release = await this.acquireLock();
      if (!release) return {status: 'busy'};

      const active = await this.chain.activePrediction();
      if (active) return {status: 'busy', prediction: active};

      const now = (this.options.now ?? Date.now)();
      const budget = await this.readBudget(now);
      const cooldownMs = this.options.cooldownMs ?? REQUEST_COOLDOWN_MS;
      const retryAfter = budget.last_request_at_ms + cooldownMs - now;
      if (retryAfter > 0 && !this.bypassCooldownForTest) return {status: 'cooldown', retry_after_ms: retryAfter};
      this.bypassCooldownForTest = false;
      if (this.options.mode === 'live' && budget.model_attempts >= MAX_MODEL_ATTEMPTS_PER_UTC_DAY) {
        return {status: 'rate_limited', retry_after_ms: millisecondsUntilUtcDayEnds(now)};
      }
      budget.last_request_at_ms = now;
      await this.writeBudget(budget);

      const scenario = this.fixtureScenario;
      const evidence = await this.collectEvidence(scenario);
      if (this.options.mode === 'live') {
        budget.model_attempts += 1;
        await this.writeBudget(budget);
      }

      const modelStartedAt = (this.options.now ?? Date.now)();
      const model = await this.callModel(evidence, scenario);
      const modelFinishedAt = (this.options.now ?? Date.now)();
      if (!model.result.ok) return {status: 'unavailable', reason: model.result.reason, provider_mode: this.options.mode};
      const decision = model.result.value;
      if (decision.decision === 'abstain') {
        return {
          status: 'abstained',
          justification: decision.justification,
          provider_mode: this.options.mode,
          model_id: model.modelId,
        };
      }

      if (modelFinishedAt < modelStartedAt) {
        return {status: 'unavailable', reason: 'Provider time validation failed', provider_mode: this.options.mode};
      }
      if (decision.confidence < MIN_CONFIDENCE_PPM / CONFIDENCE_SCALE || decision.confidence > MAX_CONFIDENCE_PPM / CONFIDENCE_SCALE) {
        return {
          status: 'unavailable',
          reason: 'Model confidence is outside the supported 10%–90% fair-odds range.',
          provider_mode: this.options.mode,
        };
      }
      const confidencePpm = Math.round(decision.confidence * CONFIDENCE_SCALE);

      const publicationCheck = await this.revalidateEvidence(evidence);
      if (!publicationCheck.ok) return {status: 'unavailable', reason: publicationCheck.reason, provider_mode: this.options.mode};
      const quote = await this.chain.quotePrediction(confidencePpm);
      const snapshot = {
        schema_version: 1,
        generated_at: new Date((this.options.now ?? Date.now)()).toISOString(),
        provider_mode: this.options.mode === 'fixture' ? 'scripted deterministic providers for local sandbox only' : 'live provider adapters',
        evidence,
        publication_validation: publicationCheck.value,
        forecast: {
          model_provider: model.provider,
          model_id: model.modelId,
          prompt_version: 'reckon-binary-v1',
          system_prompt: SYSTEM_PROMPT,
          response_format: 'strict JSON schema: decision, confidence, justification',
          response: decision,
          confidence_representation: {
            scale: CONFIDENCE_SCALE,
            model_probability: decision.confidence,
            on_chain_confidence_ppm: confidencePpm,
            rounding: 'nearest one millionth; ties round upward',
            supported_range_ppm: [MIN_CONFIDENCE_PPM, MAX_CONFIDENCE_PPM],
          },
          quote_rules: {
            confidence_scale: quote.confidence_scale,
            supported_range_ppm: [MIN_CONFIDENCE_PPM, MAX_CONFIDENCE_PPM],
            minimum_agent_stake: quote.minimum_agent_stake,
            minimum_challenger_stake: quote.minimum_challenger_stake,
            agent_risk_cap_bps: 200,
            challenger_rounding: 'fair odds rounded to nearest yoctoNEAR, ties upward',
          },
          usage: model.usage,
          request_id: model.requestId,
          latency_ms: modelFinishedAt - modelStartedAt,
        },
        limitations: [
          'The model inference is off-chain and this fingerprint does not prove that the recorded model response was executed.',
          'The fingerprint detects changes to these bytes but does not prove source truth or guarantee hosting availability.',
          'The oracle response timestamp and recency bound do not establish the external market observation time.',
          ...(this.options.mode === 'fixture' ? ['All market, reference, and forecast values in this local run are deterministic fixtures, not live forecasts.'] : []),
        ],
      };
      const canonical = canonicalJson(snapshot);
      const evidenceHash = createHash('sha256').update(canonical).digest('hex');
      await this.writeSnapshot(evidenceHash, canonical);

      // Recheck on-chain exclusivity after inference and evidence publication; the contract checks it again.
      if (await this.chain.activePrediction()) {
        return {status: 'busy', prediction: await this.chain.activePrediction()};
      }
      const prediction = await this.chain.publishPrediction({
        reference_multiplier: evidence.reference.multiplier,
        reference_decimals: evidence.reference.decimals,
        decision: decision.decision,
        confidence_ppm: confidencePpm,
        evidence_hash: evidenceHash,
      });
      return {
        status: 'published',
        prediction,
        evidence_url: `/api/evidence/${evidenceHash}`,
        provider_mode: this.options.mode,
        model_id: model.modelId,
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'FORECAST_BUSY') return {status: 'busy'};
      if (error instanceof Error && error.message.startsWith('FORECAST_COOLDOWN:')) {
        return {status: 'cooldown', retry_after_ms: Number(error.message.slice('FORECAST_COOLDOWN:'.length))};
      }
      const reason = safeFailureReason(error);
      return {status: 'unavailable', reason, provider_mode: this.options.mode};
    } finally {
      if (release) await release().catch(() => {});
    }
  }

  private async collectEvidence(scenario: FixtureScenario): Promise<CollectedEvidence> {
    if (this.options.mode === 'fixture') return fixtureEvidence(scenario, (this.options.now ?? Date.now)());
    const candles = await fetchCompletedCandles((this.options.now ?? Date.now)());
    const marketFetchedAt = (this.options.now ?? Date.now)();
    const referenceResponse = await fetchOracleReference();
    const referenceFetchedAt = (this.options.now ?? Date.now)();
    const validatedReference = validateOracleReport(referenceResponse.report, referenceFetchedAt, REFERENCE_MAX_AGE_MS);
    if (!validatedReference.ok) throw new Error(`Reference unavailable: ${validatedReference.reason}`);
    return {
      provider_mode: 'live',
      collected_at: new Date((this.options.now ?? Date.now)()).toISOString(),
      market: {
        provider: 'Coinbase public market data',
        product: 'NEAR-USD',
        fetched_at: new Date(marketFetchedAt).toISOString(),
        maximum_completed_candle_age_seconds: CANDLE_MAX_AGE_SECONDS,
        completed_candles: candles,
      },
      reference: {
        provider: ORACLE_ACCOUNT,
        account: ORACLE_ACCOUNT,
        asset_id: ORACLE_ASSET,
        block_height: referenceResponse.blockHeight,
        fetched_at: new Date(referenceFetchedAt).toISOString(),
        multiplier: validatedReference.value.multiplier,
        decimals: validatedReference.value.decimals,
        usd: decimalString(validatedReference.value.multiplier, validatedReference.value.decimals),
        response_timestamp_ns: validatedReference.value.responseTimestampNs,
        provider_recency_seconds: validatedReference.value.providerRecencySeconds,
        response_age_ns: validatedReference.value.responseAgeNs,
        provider_report_age_upper_bound_ns: validatedReference.value.providerReportAgeUpperBoundNs,
        validated_at: new Date(validatedReference.value.validatedAtMs).toISOString(),
        external_observation_time_verified: false,
      },
      question_and_rules: RULES,
    };
  }

  private async callModel(evidence: CollectedEvidence, scenario: FixtureScenario): Promise<{
    provider: string;
    modelId: string;
    result: ReturnType<typeof validateModel>;
    usage: unknown;
    requestId: string | null;
  }> {
    if (this.options.mode === 'fixture') {
      this.fixtureModelCalls += 1;
      if (scenario === 'unavailable-model') throw new Error('Model provider unavailable');
      if (scenario === 'slow-publish') await new Promise(resolve => setTimeout(resolve, 125));
      const content = scenario === 'invalid-output'
        ? '{"decision":"yes","confidence":1.2,"justification":"invalid fixture"}'
        : scenario === 'unsupported-confidence'
          ? JSON.stringify({decision: 'yes', confidence: 0.9000001, justification: 'This fixture is outside the supported quote range.'})
        : scenario === 'abstain'
          ? JSON.stringify({decision: 'abstain', confidence: null, justification: 'The local fixture is abstaining for this scenario.'})
          : JSON.stringify({decision: 'no', confidence: 0.85, justification: 'The deterministic local fixture selects no.'});
      return {
        provider: 'Local deterministic model fixture',
        modelId: 'fixture:reckon-test-forecast-v1',
        result: validateModel(content),
        usage: null,
        requestId: null,
      };
    }

    const modelId = this.options.modelId!;
    const response = await fetch('https://cloud-api.near.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.modelApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          {role: 'system', content: SYSTEM_PROMPT},
          {role: 'user', content: canonicalJson({question_and_rules: RULES, evidence})},
        ],
        response_format: RESPONSE_FORMAT,
        max_tokens: 512,
      }),
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    });
    const requestId = response.headers.get('x-request-id');
    if (!response.ok) throw new Error(`Model provider unavailable (HTTP ${response.status})`);
    const payload: unknown = await response.json();
    if (!isObject(payload) || payload.model !== modelId || !Array.isArray(payload.choices) || !isObject(payload.choices[0]) || payload.choices[0].finish_reason !== 'stop' || !isObject(payload.choices[0].message)) {
      throw new Error('Model response was incomplete or its identity did not match configuration');
    }
    return {
      provider: 'NEAR AI Cloud',
      modelId,
      result: validateModel(payload.choices[0].message.content),
      usage: payload.usage ?? null,
      requestId,
    };
  }

  private async revalidateEvidence(evidence: CollectedEvidence): Promise<{ok: true; value: PublicationValidation} | {ok: false; reason: string}> {
    const now = (this.options.now ?? Date.now)();
    const candleStart = Math.max(...evidence.market.completed_candles.map(candle => Number(candle.start)));
    const candleAgeSeconds = Math.floor(now / 1_000) - (candleStart + 60);
    if (!Number.isSafeInteger(candleStart) || candleAgeSeconds < 0 || candleAgeSeconds > CANDLE_MAX_AGE_SECONDS) {
      return {ok: false, reason: 'Market evidence became stale during inference'};
    }
    const reference = evidence.reference;
    const report = {
      timestamp: reference.response_timestamp_ns,
      recency_duration_sec: reference.provider_recency_seconds,
      prices: [{asset_id: reference.asset_id, price: {multiplier: reference.multiplier, decimals: reference.decimals}}],
    };
    const validated = validateOracleReport(report, now, REFERENCE_MAX_AGE_MS);
    if (!validated.ok) return {ok: false, reason: `Reference became stale during inference: ${validated.reason}`};
    return {
      ok: true,
      value: {
        checked_at: new Date(now).toISOString(),
        completed_candle_age_seconds: candleAgeSeconds,
        reference_response_age_ns: validated.value.responseAgeNs,
        provider_report_age_upper_bound_ns: validated.value.providerReportAgeUpperBoundNs,
        reference_maximum_age_ms: REFERENCE_MAX_AGE_MS,
      },
    };
  }

  private async acquireLock(): Promise<(() => Promise<void>) | null> {
    await mkdir(dirname(this.options.lockPath), {recursive: true, mode: 0o700});
    let handle: FileHandle;
    try {
      handle = await open(this.options.lockPath, 'wx', 0o600);
    } catch (error) {
      if (!isCode(error, 'EEXIST')) throw error;
      const lockStat = await stat(this.options.lockPath).catch(() => null);
      if (lockStat && Date.now() - lockStat.mtimeMs > STALE_OPERATION_LOCK_MS) {
        await unlink(this.options.lockPath).catch(() => {});
        try {
          handle = await open(this.options.lockPath, 'wx', 0o600);
        } catch (retryError) {
          if (isCode(retryError, 'EEXIST')) return null;
          throw retryError;
        }
      } else {
        return null;
      }
    }
    await handle.writeFile(JSON.stringify({pid: process.pid, acquired_at: new Date().toISOString()}));
    return async () => {
      await handle.close();
      await unlink(this.options.lockPath).catch(() => {});
    };
  }

  private async readBudget(now: number): Promise<StoredBudget> {
    const utcDay = new Date(now).toISOString().slice(0, 10);
    let contents: string;
    try {
      contents = await readFile(this.options.budgetPath, 'utf8');
    } catch (error) {
      if (!isCode(error, 'ENOENT')) throw error;
      return {utc_day: utcDay, last_request_at_ms: 0, model_attempts: 0};
    }
    let value: unknown;
    try {
      value = JSON.parse(contents);
    } catch {
      throw new Error('Forecast request budget state is invalid');
    }
    if (!isObject(value)
      || typeof value.utc_day !== 'string'
      || !/^\d{4}-\d{2}-\d{2}$/.test(value.utc_day)
      || !Number.isSafeInteger(value.model_attempts)
      || (value.model_attempts as number) < 0
      || !Number.isSafeInteger(value.last_request_at_ms)
      || (value.last_request_at_ms as number) < 0) {
      throw new Error('Forecast request budget state is invalid');
    }
    if (value.utc_day !== utcDay) return {utc_day: utcDay, last_request_at_ms: 0, model_attempts: 0};
    return value as StoredBudget;
  }

  private async writeBudget(budget: StoredBudget): Promise<void> {
    await mkdir(dirname(this.options.budgetPath), {recursive: true, mode: 0o700});
    const temporary = `${this.options.budgetPath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(budget), {mode: 0o600});
    await rename(temporary, this.options.budgetPath);
  }

  private async writeSnapshot(hash: string, canonical: string): Promise<void> {
    await mkdir(this.options.evidenceDirectory, {recursive: true, mode: 0o700});
    const path = join(this.options.evidenceDirectory, `${hash}.json`);
    try {
      await writeFile(path, canonical, {mode: 0o444, flag: 'wx'});
    } catch (error) {
      if (!isCode(error, 'EEXIST')) throw error;
      await this.readEvidence(hash);
    }
  }
}

function fixtureEvidence(scenario: FixtureScenario, now: number): CollectedEvidence {
  const nowSeconds = Math.floor(now / 1_000);
  const latestCompletedStart = Math.floor(nowSeconds / 60) * 60 - 60;
  const latestStart = scenario === 'stale-market' ? latestCompletedStart - 240 : latestCompletedStart;
  const completedCandles = [
    {start: String(latestStart - 120), open: '3.3900', high: '3.4100', low: '3.3800', close: '3.4050', volume: '1000.00'},
    {start: String(latestStart - 60), open: '3.4050', high: '3.4200', low: '3.4000', close: '3.4100', volume: '1200.00'},
    {start: String(latestStart), open: '3.4100', high: '3.4300', low: '3.4050', close: '3.4200', volume: '900.00'},
  ];
  const responseTimestampNs = BigInt(now) * 1_000_000n - 5_000_000_000n;
  const reference = scenario === 'invalid-reference'
    ? null
    : {multiplier: '340823333', decimals: 8};
  const report = validateOracleReport({
    timestamp: responseTimestampNs.toString(),
    recency_duration_sec: 300,
    prices: [{asset_id: ORACLE_ASSET, price: reference}],
  }, now, REFERENCE_MAX_AGE_MS);
  if (!report.ok) throw new Error(`Reference unavailable: ${report.reason}`);
  const latestCandleAge = nowSeconds - (Number(completedCandles[2].start) + 60);
  if (latestCandleAge > CANDLE_MAX_AGE_SECONDS) throw new Error('Completed market candles are stale');
  return {
    provider_mode: 'fixture',
    collected_at: new Date(now).toISOString(),
    market: {
      provider: 'Local deterministic market fixture',
      product: 'NEAR-USD (simulated)',
      fetched_at: new Date(now).toISOString(),
      maximum_completed_candle_age_seconds: CANDLE_MAX_AGE_SECONDS,
      completed_candles: completedCandles,
    },
    reference: {
      provider: 'Local deterministic oracle fixture',
      account: 'local-fixture',
      asset_id: ORACLE_ASSET,
      block_height: null,
      fetched_at: new Date(now).toISOString(),
      multiplier: report.value.multiplier,
      decimals: report.value.decimals,
      usd: decimalString(report.value.multiplier, report.value.decimals),
      response_timestamp_ns: report.value.responseTimestampNs,
      provider_recency_seconds: report.value.providerRecencySeconds,
      response_age_ns: report.value.responseAgeNs,
      provider_report_age_upper_bound_ns: report.value.providerReportAgeUpperBoundNs,
      validated_at: new Date(report.value.validatedAtMs).toISOString(),
      external_observation_time_verified: false,
    },
    question_and_rules: RULES,
  };
}

async function fetchCompletedCandles(nowMs: number): Promise<Candle[]> {
  const nowSeconds = Math.floor(nowMs / 1_000);
  const url = new URL(CANDLES_URL);
  url.search = new URLSearchParams({
    start: String(nowSeconds - 600),
    end: String(nowSeconds),
    granularity: 'ONE_MINUTE',
    limit: '10',
  }).toString();
  const response = await fetch(url, {signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)});
  if (!response.ok) throw new Error(`Market provider unavailable (HTTP ${response.status})`);
  const payload: unknown = await response.json();
  if (!isObject(payload) || !Array.isArray(payload.candles)) throw new Error('Market candle response was malformed');
  const completed = payload.candles.filter(isValidCandle).filter(candle => {
    const start = Number(candle.start);
    return start % 60 === 0 && start + 60 <= nowSeconds && nowSeconds - (start + 60) <= CANDLE_MAX_AGE_SECONDS;
  }).sort((left, right) => Number(right.start) - Number(left.start)).slice(0, 10);
  if (completed.length === 0) throw new Error('No recent completed market candles are available');
  return completed;
}

async function fetchOracleReference(): Promise<{report: unknown; blockHeight: number}> {
  const response = await fetch(ORACLE_RPC, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'reckon-reference',
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'final',
        account_id: ORACLE_ACCOUNT,
        method_name: 'get_price_data',
        args_base64: Buffer.from(JSON.stringify({asset_ids: [ORACLE_ASSET]})).toString('base64'),
      },
    }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Reference provider unavailable (HTTP ${response.status})`);
  const payload: unknown = await response.json();
  if (!isObject(payload) || !isObject(payload.result) || !Array.isArray(payload.result.result) || !payload.result.result.every((byte: unknown) => typeof byte === 'number' && Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    throw new Error('Reference provider returned a malformed RPC response');
  }
  const parsed: unknown = JSON.parse(Buffer.from(payload.result.result).toString('utf8'));
  if (!Number.isSafeInteger(payload.result.block_height)) throw new Error('Reference provider omitted its final block height');
  return {report: parsed, blockHeight: payload.result.block_height as number};
}

function isValidCandle(value: unknown): value is Candle {
  if (!isObject(value) || typeof value.start !== 'string' || !/^\d+$/.test(value.start) || !Number.isSafeInteger(Number(value.start))) return false;
  const values = ['open', 'high', 'low', 'close', 'volume'].map(key => value[key]);
  if (!values.every(item => typeof item === 'string' && /^\d+(\.\d+)?$/.test(item) && Number.isFinite(Number(item)))) return false;
  const [open, high, low, close, volume] = values.map(Number);
  return volume >= 0 && low > 0 && low <= open && open <= high && low <= close && close <= high;
}

function canonicalJson(value: unknown): string {
  const encoded = JSON.stringify(sortKeys(value));
  if (encoded === undefined) throw new Error('Evidence snapshot could not be canonicalized');
  return encoded;
}

function decimalString(multiplier: string, decimals: number): string {
  const digits = BigInt(multiplier).toString().padStart(decimals + 1, '0');
  if (decimals === 0) return digits;
  return `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeys(value[key])]));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCode(error: unknown, code: string): boolean {
  return isObject(error) && error.code === code;
}

function millisecondsUntilUtcDayEnds(now: number): number {
  const nextDay = new Date(now);
  nextDay.setUTCHours(24, 0, 0, 0);
  return Math.max(1, nextDay.getTime() - now);
}

function safeFailureReason(error: unknown): string {
  if (!(error instanceof Error)) return 'Forecast could not be completed';
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'A required provider timed out';
  if (error.message.includes('deadline') || error.message.includes('expired')) return 'Evidence was stale before publication';
  if (error.message.includes('Prediction key')) return 'Prediction publication key is unavailable';
  if (error.message.includes('unresolved prediction')) return 'Another prediction is already active';
  if (error.message.includes('confidence')) return 'The model confidence cannot be quoted under the documented bounds';
  if (error.message.includes('minimum')) return 'The remaining bankroll is below the minimum supported quote';
  if (error.message.includes('Reference')) return 'The settlement reference is unavailable or stale';
  if (error.message.includes('candle') || error.message.includes('market')) return 'Recent completed market evidence is unavailable or stale';
  if (error.message.includes('Model')) return 'Configured model inference is unavailable';
  return 'A required forecast step was unavailable';
}
