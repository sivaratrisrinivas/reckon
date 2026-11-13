import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { comparePrices, validateModel, validateOracleReport } from './validate.js';
import { waitForCallback } from './callback.js';
import { assertScratchCode, assertScratchProvider } from './code.js';

const exec = promisify(execFile);
const RPC = 'https://rpc.testnet.near.org';
const QUESTION = 'Will the NEAR/USD settlement price be strictly above the reference price? The prediction deadline is five minutes after publication. Settlement uses the first successful valid oracle request initiated after the deadline and completed within a bounded settlement window. Caller timing and provider caching affect the observation; it is not an exact historical expiry price. Equal prices resolve to no. If no valid result arrives in the window, the prediction is void.';
const SYSTEM = 'Return a structured judgment using only the supplied evidence. Confidence is probability that your selected side is correct. You may abstain with null confidence when the evidence is insufficient.';
const FORMAT = {type: 'json_schema', json_schema: {name: 'forecast', strict: true, schema: {type: 'object', properties: {decision: {type: 'string', enum: ['yes', 'no', 'abstain']}, confidence: {type: ['number', 'null']}, justification: {type: 'string'}}, required: ['decision', 'confidence', 'justification'], additionalProperties: false}}};

function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
async function json(url: string, body?: unknown, headers: Record<string, string> = {}, timeoutMs = 30_000, onResponse?: (response: Response) => void): Promise<unknown> {
  const response = await fetch(url, {method: body === undefined ? 'GET' : 'POST', headers: {'Content-Type': 'application/json', ...headers}, ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: AbortSignal.timeout(timeoutMs)});
  onResponse?.(response);
  if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
  return response.json();
}

async function main() {
  process.loadEnvFile();
  const account = process.env.NEAR_ACCOUNT_ID;
  const key = process.env.NEAR_AI_API_KEY;
  const model = process.env.NEAR_AI_MODEL;
  if (!account || !/^[a-z0-9._-]+\.testnet$/.test(account) || !key || !model) throw new Error('Set NEAR_ACCOUNT_ID, NEAR_AI_API_KEY and NEAR_AI_MODEL in .env');
  const started = Date.now();
  const nonce = randomUUID();
  await mkdir('.local/diagnostic-runs', {recursive: true, mode: 0o700});
  const lockPath = '.local/diagnostic-runs/probe.lock';
  const lock = await open(lockPath, 'wx', 0o600);
  const outcome: Record<string, unknown> = {kind: 'technical-diagnostic', started_at: new Date(started).toISOString(), status: 'unavailable', observation_time_verified: false};
  let modelStarted: number | undefined;
  try {
    const localCode = await readFile('diagnostic-contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm');
    const deployedCode = await json(RPC, {jsonrpc: '2.0', id: 'diagnostic', method: 'query', params: {request_type: 'view_code', finality: 'final', account_id: account}});
    assertScratchCode(localCode, deployedCode);
    const deployedProvider = await json(RPC, {jsonrpc: '2.0', id: 'diagnostic', method: 'query', params: {request_type: 'call_function', finality: 'final', account_id: account, method_name: 'oracle_id', args_base64: 'e30='}});
    assertScratchProvider(deployedProvider);
    const cli = './.local/near-cli/node_modules/.bin/near';
    let output: string;
    const oracleStarted = performance.now();
    try {
      const result = await exec(cli, ['contract', 'call-function', 'as-transaction', account, 'request', 'json-args', JSON.stringify({nonce}), 'prepaid-gas', '250 Tgas', 'attached-deposit', '0 NEAR', 'sign-as', account, 'network-config', 'testnet', 'sign-with-legacy-keychain', 'send'], {timeout: 120_000, maxBuffer: 2_000_000});
      output = result.stdout + result.stderr;
    } catch {
      throw new Error('Oracle transaction failed or timed out; inspect the account before retrying');
    }
    output = output.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '');
    const transaction = /Transaction ID:\s*([1-9A-HJ-NP-Za-km-z]+)/.exec(output)?.[1];
    if (!transaction) throw new Error('Oracle transaction did not report an ID');
    outcome.oracle_transaction = transaction;
    outcome.oracle_elapsed_ms = Math.round(performance.now() - oracleStarted);
    outcome.oracle_fee_near = /Transaction fee:\s*([0-9.]+) NEAR/.exec(output)?.[1] ?? null;
    for (const line of output.split('\n')) {
      if (!line.includes('EVENT_JSON:')) continue;
      try {
        const event: unknown = JSON.parse(line.slice(line.indexOf('EVENT_JSON:') + 'EVENT_JSON:'.length));
        if (object(event) && event.event === 'execution_completed' && Array.isArray(event.data) && object(event.data[0])) {
          const entry = event.data[0];
          outcome.oracle_worker = {success: entry.success, payment_charged: entry.payment_charged, payment_refunded: entry.payment_refunded, resources_used: entry.resources_used};
        }
      } catch { /* A malformed event does not establish a cost. */ }
    }
    const deadline = oracleStarted + 120_000;
    const callback = await waitForCallback({nonce, deadlineMs: deadline, now: () => performance.now(), read: async remainingMs => {
      const rpc = await json(RPC, {jsonrpc: '2.0', id: 'diagnostic', method: 'query', params: {request_type: 'call_function', finality: 'final', account_id: account, method_name: 'callback', args_base64: 'e30='}}, {}, Math.max(1, Math.min(30_000, remainingMs)));
      if (!object(rpc) || !object(rpc.result) || !Array.isArray(rpc.result.result) || !rpc.result.result.every((v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 255)) throw new Error('Oracle callback unavailable');
      const encoded: unknown = JSON.parse(Buffer.from(rpc.result.result).toString('utf8'));
      return typeof encoded === 'string' ? JSON.parse(encoded) : null;
    }});
    if (typeof callback.callback_block_timestamp_ns !== 'string' || !/^\d+$/.test(callback.callback_block_timestamp_ns) || BigInt(callback.callback_block_timestamp_ns) === 0n) throw new Error('Oracle callback timestamp malformed');
    outcome.callback_observed_elapsed_ms = Math.round(performance.now() - oracleStarted);
    // Diagnostic-only bound: provider cache allowance plus elapsed time since its response.
    const report = validateOracleReport(callback.data, Date.now(), 600_000);
    if (!report.ok) throw new Error(report.reason);
    const now = Math.floor(Date.now() / 1000);
    const candles = await json(`https://api.coinbase.com/api/v3/brokerage/market/products/NEAR-USD/candles?start=${now - 600}&end=${now}&granularity=ONE_MINUTE&limit=10`);
    if (!object(candles) || !Array.isArray(candles.candles)) throw new Error('Candle response malformed');
    const completed = candles.candles.filter((v: unknown) => {
      if (!object(v) || typeof v.start !== 'string' || !/^\d+$/.test(v.start) || !Number.isSafeInteger(Number(v.start)) || Number(v.start) % 60 !== 0 || Number(v.start) + 60 > now) return false;
      if (!['open', 'high', 'low', 'close', 'volume'].every(k => typeof v[k] === 'string' && /^\d+(\.\d+)?$/.test(v[k]) && Number.isFinite(Number(v[k])))) return false;
      const open = Number(v.open), high = Number(v.high), low = Number(v.low), close = Number(v.close);
      return low > 0 && low <= open && open <= high && low <= close && close <= high;
    });
    completed.sort((a: {start: string}, b: {start: string}) => Number(b.start) - Number(a.start));
    if (!completed.length || Math.floor(Date.now() / 1000) - (Number(completed[0].start) + 60) > 180) throw new Error('Completed candles unavailable or stale');
    const reportAtInference = validateOracleReport(callback.data, Date.now(), 600_000);
    if (!reportAtInference.ok) throw new Error(reportAtInference.reason);
    const comparison = comparePrices(report.value.multiplier, report.value.decimals, completed[0].close);
    const evidence = {candles_provider: 'Coinbase NEAR-USD ONE_MINUTE', candles_fetched_at: new Date().toISOString(), completed_candles: completed, oracle_provider: 'price-oracle.testnet', oracle_callback: callback, oracle_report_validation: reportAtInference.value, diagnostic_max_provider_report_age_ms: 600_000, comparison, question_and_rules: QUESTION};
    outcome.evidence = evidence;
    const requestStarted = performance.now();
    modelStarted = requestStarted;
    outcome.model_request = {model, system_prompt: SYSTEM, response_format: FORMAT, max_tokens: 512};
    const modelResult = await json('https://cloud-api.near.ai/v1/chat/completions', {model, messages: [{role: 'system', content: SYSTEM}, {role: 'user', content: JSON.stringify(evidence)}], response_format: FORMAT, max_tokens: 512}, {Authorization: `Bearer ${key}`}, 30_000, response => { outcome.model_request_id = response.headers.get('x-request-id'); });
    outcome.model_latency_ms = Math.round(performance.now() - requestStarted);
    if (object(modelResult)) {
      outcome.model_returned = modelResult.model ?? null;
      outcome.model_usage = modelResult.usage ?? null;
      if (Array.isArray(modelResult.choices) && object(modelResult.choices[0])) {
        outcome.model_finish_reason = modelResult.choices[0].finish_reason ?? null;
        if (object(modelResult.choices[0].message)) outcome.model_content = modelResult.choices[0].message.content ?? null;
      }
    }
    if (!object(modelResult) || modelResult.model !== model || !Array.isArray(modelResult.choices) || !object(modelResult.choices[0]) || !object(modelResult.choices[0].message) || modelResult.choices[0].finish_reason !== 'stop') throw new Error('Model response incomplete or model identity differs');
    const validated = validateModel(modelResult.choices[0].message.content);
    if (!validated.ok) throw new Error(validated.reason);
    const reportAtCompletion = validateOracleReport(callback.data, Date.now(), 600_000);
    if (!reportAtCompletion.ok) throw new Error(reportAtCompletion.reason);
    if (Math.floor(Date.now() / 1000) - (Number(completed[0].start) + 60) > 180) throw new Error('Completed candles became stale during inference');
    outcome.oracle_report_validation_at_completion = reportAtCompletion.value;
    outcome.model = model;
    outcome.model_usage = modelResult.usage ?? null;
    outcome.model_response = validated.value;
    outcome.status = 'observed';
  } catch (error) {
    if (modelStarted !== undefined && outcome.model_latency_ms === undefined) outcome.model_latency_ms = Math.round(performance.now() - modelStarted);
    outcome.reason = error instanceof Error && error.name === 'TimeoutError' ? 'Provider timed out' : error instanceof Error ? error.message : 'Unknown diagnostic failure';
  }
  const path = `.local/diagnostic-runs/${started}-${nonce}.json`;
  const partial = `.local/diagnostic-runs/.partial-${nonce}`;
  try {
    await writeFile(partial, JSON.stringify(outcome, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
    await rename(partial, path);
  } finally {
    await unlink(partial).catch(() => {});
    await lock.close();
    await unlink(lockPath);
  }
  console.log(`Diagnostic ${outcome.status}; evidence: ${path}`);
  if (outcome.status !== 'observed') { console.error(`Unavailable: ${outcome.reason}`); process.exitCode = 1; }
}
await main();
