function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function assertScratchCode(localCode: Uint8Array, response: unknown): void {
  if (!localCode.length || !object(response) || !object(response.result) || typeof response.result.code_base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(response.result.code_base64)) throw new Error('Deployed scratch contract code unavailable');
  if (!Buffer.from(response.result.code_base64, 'base64').equals(Buffer.from(localCode))) throw new Error('Deployed contract does not match the locally built scratch contract');
}

export function assertScratchProvider(response: unknown): void {
  if (!object(response) || !object(response.result) || !Array.isArray(response.result.result) || !response.result.result.every((v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 255)) throw new Error('Scratch provider unavailable');
  let provider: unknown;
  try { provider = JSON.parse(Buffer.from(response.result.result).toString('utf8')); } catch { throw new Error('Scratch provider unavailable'); }
  if (provider !== 'price-oracle.testnet') throw new Error('Scratch provider does not match price-oracle.testnet');
}
