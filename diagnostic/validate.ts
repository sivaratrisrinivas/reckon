export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// This checks the oracle report's age; it cannot establish the external market observation time.
export function validateOracleReport(value: unknown, nowMs: number, maxAgeMs: number): Result<{ multiplier: string; decimals: number; reportTimestampNs: string; externalObservationTimeVerified: false }> {
  if (!object(value) || typeof value.timestamp !== 'string' || !/^\d+$/.test(value.timestamp) || typeof value.recency_duration_sec !== 'number' || !Number.isSafeInteger(value.recency_duration_sec) || value.recency_duration_sec <= 0 || !Array.isArray(value.prices) || value.prices.length !== 1) return { ok: false, reason: 'Malformed oracle response' };
  if (!Number.isSafeInteger(nowMs) || !Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) return { ok: false, reason: 'Invalid freshness limits' };
  const timestamp = BigInt(value.timestamp);
  const nowNs = BigInt(Math.trunc(nowMs)) * 1_000_000n;
  if (timestamp > nowNs || nowNs - timestamp > BigInt(Math.min(maxAgeMs, value.recency_duration_sec * 1000)) * 1_000_000n) return { ok: false, reason: 'Stale or future oracle report' };
  const entry: unknown = value.prices[0];
  if (!object(entry) || entry.asset_id !== 'wrap.near' || !object(entry.price)) return { ok: false, reason: 'Missing or unexpected asset price' };
  const { multiplier, decimals } = entry.price;
  if (typeof multiplier !== 'string' || !/^\d+$/.test(multiplier) || BigInt(multiplier) === 0n || typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 24) return { ok: false, reason: 'Invalid price or units' };
  return { ok: true, value: { multiplier, decimals, reportTimestampNs: value.timestamp, externalObservationTimeVerified: false } };
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
