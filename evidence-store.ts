import {createHash} from 'node:crypto';
import {put} from '@vercel/blob';

// The URL is public; the token is used only for the server-side upload.
export async function publishBlobEvidence(hash: string, canonical: string, token: string): Promise<string> {
  if (!/^[0-9a-f]{64}$/.test(hash) || createHash('sha256').update(canonical).digest('hex') !== hash) {
    throw new Error('Evidence fingerprint does not match this snapshot');
  }
  const blob = await put(`evidence/${hash}.json`, canonical, {
    access: 'public',
    token,
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: 'application/json',
    abortSignal: AbortSignal.timeout(12_000),
  });
  const url = new URL(blob.url);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.public.blob.vercel-storage.com') || url.username || url.password || url.search || url.hash) {
    throw new Error('Evidence hosting returned an invalid public URL');
  }
  const response = await fetch(url, {signal: AbortSignal.timeout(12_000), cache: 'no-store'});
  if (!response.ok) throw new Error('Evidence hosting did not make the snapshot publicly downloadable');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== hash) {
    throw new Error('Evidence fingerprint does not match the public snapshot');
  }
  return url.href;
}
