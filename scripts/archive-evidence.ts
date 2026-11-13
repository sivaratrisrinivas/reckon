import {createHash} from 'node:crypto';
import {mkdir, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import type {OnChainPrediction} from '../forecast.js';

const [service, destination] = process.argv.slice(2);
if (!service || !destination) throw new Error('Usage: npm run archive:evidence -- SERVICE_URL NEW_OUTPUT_DIRECTORY');
const base = new URL(service);
if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Service URL must use HTTP or HTTPS');
const output = resolve(destination);
// Refuse an existing directory, so errors can only remove files created by this invocation.
await mkdir(output, {mode: 0o700});
try {
  const config = await getJson('/api/config');
  if (!config || typeof config !== 'object' || !('provider_mode' in config) || !['fixture', 'live'].includes(String(config.provider_mode))) throw new Error('Invalid service configuration');
  const manifest: {prediction_id: string; evidence_url: string; sha256: string; file: string}[] = [];
  let start = 1n;
  for (;;) {
    const page: unknown = await getJson(`/api/predictions?start_id=${start}`);
    if (!Array.isArray(page) || page.length > 50) throw new Error('Invalid on-chain prediction page');
    if (!page.length) break;
    for (const prediction of page as OnChainPrediction[]) {
      if (!/^[1-9]\d*$/.test(prediction.id) || BigInt(prediction.id) < start || !/^[0-9a-f]{64}$/.test(prediction.evidence_hash)) throw new Error('Invalid prediction record');
      start = BigInt(prediction.id) + 1n;
      const url = new URL(prediction.evidence_url);
      const fixture = config.provider_mode === 'fixture' && url.hostname === 'evidence.reckon.invalid';
      if (!fixture && (url.protocol !== 'https:' || !url.hostname.endsWith('.public.blob.vercel-storage.com') || url.username || url.password || url.search || url.hash)) throw new Error('Unexpected public evidence host');
      const response = await fetch(fixture ? new URL(`/api/evidence/${prediction.evidence_hash}`, base) : url, {signal: AbortSignal.timeout(15_000), cache: 'no-store'});
      if (!response.ok) throw new Error(`Evidence unavailable for prediction ${prediction.id}`);
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (!response.body) throw new Error('Evidence body is missing');
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > 262_144) throw new Error('Evidence exceeds the archive size bound');
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      if (createHash('sha256').update(bytes).digest('hex') !== prediction.evidence_hash) throw new Error(`Evidence fingerprint mismatch for prediction ${prediction.id}`);
      const file = `${prediction.evidence_hash}.json`;
      await writeFile(join(output, file), bytes, {flag: 'wx', mode: 0o444});
      manifest.push({prediction_id: prediction.id, evidence_url: prediction.evidence_url, sha256: prediction.evidence_hash, file});
    }
  }
  await writeFile(join(output, 'manifest.json'), JSON.stringify({schema_version: 1, source_service: base.origin, exported_at: new Date().toISOString(), network: 'network' in config ? config.network : null, contract_account_id: 'contract_account_id' in config ? config.contract_account_id : null, provider_mode: config.provider_mode, predictions: manifest}, null, 2), {flag: 'wx', mode: 0o444});
  console.log(`Exported ${manifest.length} verified snapshots to ${output}`);
} catch (error) {
  await rm(output, {recursive: true, force: true});
  throw error;
}

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(new URL(path, base), {signal: AbortSignal.timeout(15_000), cache: 'no-store'});
  if (!response.ok) throw new Error(`Archive source unavailable (${response.status})`);
  return response.json();
}
