export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

function decimal(value: bigint, places: number): string {
  const sign = value < 0n ? '-' : '';
  const digits = (value < 0n ? -value : value).toString().padStart(places + 1, '0');
  return places ? `${sign}${digits.slice(0, -places)}.${digits.slice(-places)}` : `${sign}${digits}`;
}

export function comparePrices(multiplier: string, decimals: number, candleClose: string) {
  if (!/^\d+(\.\d+)?$/.test(candleClose)) throw new Error('Invalid candle close');
  const [whole, fraction = ''] = candleClose.split('.');
  if (fraction.length > 24 || BigInt(whole + fraction) === 0n) throw new Error('Invalid candle close');
  const places = Math.max(decimals, fraction.length);
  const reference = BigInt(multiplier) * 10n ** BigInt(places - decimals);
  const candle = BigInt(whole + fraction) * 10n ** BigInt(places - fraction.length);
  return {reference_usd: decimal(reference, places), latest_candle_close_usd: decimal(candle, places), reference_minus_candle_usd: decimal(reference - candle, places)};
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The response timestamp is the oracle's execution time, not a report or market-observation time.
export function validateOracleReport(value: unknown, nowMs: number, maxAgeMs: number): Result<{ multiplier: string; decimals: number; responseTimestampNs: string; providerRecencySeconds: number; externalObservationTimeVerified: false }> {
  if (!object(value) || typeof value.timestamp !== 'string' || !/^\d+$/.test(value.timestamp) || typeof value.recency_duration_sec !== 'number' || !Number.isSafeInteger(value.recency_duration_sec) || value.recency_duration_sec <= 0 || !Array.isArray(value.prices) || value.prices.length !== 1) return { ok: false, reason: 'Malformed oracle response' };
  if (!Number.isSafeInteger(nowMs) || !Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) return { ok: false, reason: 'Invalid freshness limits' };
  const timestamp = BigInt(value.timestamp);
  const nowNs = BigInt(Math.trunc(nowMs)) * 1_000_000n;
  if (timestamp > nowNs || nowNs - timestamp + BigInt(value.recency_duration_sec) * 1_000_000_000n > BigInt(maxAgeMs) * 1_000_000n) return { ok: false, reason: 'Oracle response or provider recency exceeds configured limit' };
  const entry: unknown = value.prices[0];
  if (!object(entry) || entry.asset_id !== 'wrap.near' || !object(entry.price)) return { ok: false, reason: 'Missing or unexpected asset price' };
  const { multiplier, decimals } = entry.price;
  if (typeof multiplier !== 'string' || !/^\d+$/.test(multiplier) || BigInt(multiplier) === 0n || typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 24) return { ok: false, reason: 'Invalid price or units' };
  return { ok: true, value: { multiplier, decimals, responseTimestampNs: value.timestamp, providerRecencySeconds: value.recency_duration_sec, externalObservationTimeVerified: false } };
}

export type ModelDecision = { decision: 'yes' | 'no'; confidence: number; justification: string } | { decision: 'abstain'; confidence: null; justification: string };
export function validateModel(content: unknown): Result<ModelDecision> {
  if (typeof content !== 'string') return { ok: false, reason: 'Missing structured response' };
  let value: unknown;
  try { value = JSON.parse(content); } catch { return { ok: false, reason: 'Invalid JSON' }; }
  if (!object(value) || Object.keys(value).sort().join(',') !== 'confidence,decision,justification' || typeof value.justification !== 'string' || !value.justification.trim()) return { ok: false, reason: 'Invalid response shape' };
  if (value.decision === 'abstain' && value.confidence === null) return { ok: true, value: { decision: 'abstain', confidence: null, justification: value.justification } };
  if ((value.decision === 'yes' || value.decision === 'no') && typeof value.confidence === 'number' && Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1) return { ok: true, value: { decision: value.decision, confidence: value.confidence, justification: value.justification } };
  return { ok: false, reason: 'Invalid decision or confidence' };
}
