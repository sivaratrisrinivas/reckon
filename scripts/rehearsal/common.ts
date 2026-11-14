// Helpers for the live rehearsal scripts. These files are prepared for a human to run against a disposable testnet
// account. They are never run by the automated checks, and they print public information only.
import {mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {KeyPair} from 'near-api-js/lib/utils/key_pair.js';
import {rpc} from '../../rehearsal-rpc.js';
import {RehearsalRefusal, redact, type ParsedOptions} from './guards.js';

export const stateDirectory = (account: string) => `.local/rehearsal/${account}`;

export function say(value: unknown): void {
  console.log(redact(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item, 2)));
}

export function required(options: ParsedOptions, name: string): string {
  const value = options.get(name);
  if (typeof value !== 'string') throw new RehearsalRefusal(`Missing ${name} <value>.`);
  return value;
}

export function parseNear(text: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,24}))?$/.exec(text);
  if (!match) throw new RehearsalRefusal(`${text} is not an amount of NEAR such as 12.5.`);
  return BigInt(match[1]) * 10n ** 24n + BigInt((match[2] ?? '').padEnd(24, '0'));
}

/** Read a private key file, refusing any file that other users can read. The key is never printed. */
export async function readKeyFile(path: string): Promise<KeyPair> {
  const info = await stat(path);
  if ((info.mode & 0o077) !== 0) throw new RehearsalRefusal(`${path} is readable by other users; run chmod 600 on it first.`);
  const text = (await readFile(path, 'utf8')).trim();
  let secret = text;
  if (text.startsWith('{')) {
    const parsed = JSON.parse(text) as {secret_key?: string; private_key?: string};
    secret = parsed.secret_key ?? parsed.private_key ?? '';
  }
  if (!secret.startsWith('ed25519:')) throw new RehearsalRefusal(`${path} does not contain an ed25519 secret key.`);
  return KeyPair.fromString(secret as `ed25519:${string}`);
}

/** Create a new private file that nothing else can read, refusing to overwrite an existing one. */
export async function writeNewSecretFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), {recursive: true, mode: 0o700});
  await writeFile(path, content, {flag: 'wx', mode: 0o600});
}

export async function appendLog(account: string, entry: object): Promise<void> {
  const path = `${stateDirectory(account)}/log.json`;
  await mkdir(dirname(path), {recursive: true, mode: 0o700});
  let entries: object[] = [];
  try {
    entries = JSON.parse(await readFile(path, 'utf8')) as object[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  entries.push({recorded_at: new Date().toISOString(), ...entry});
  await writeFile(path, redact(JSON.stringify(entries, (_key, item) => typeof item === 'bigint' ? item.toString() : item, 2)), {mode: 0o600});
}

export async function viewCall<T>(url: string, account: string, method: string, args: object = {}): Promise<T> {
  const result = await rpc<{result: number[]}>(url, 'query', {
    request_type: 'call_function', finality: 'optimistic', account_id: account, method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
  });
  return JSON.parse(Buffer.from(result.result).toString('utf8')) as T;
}

export type AccountView = {amount: string; locked: string; storage_usage: number; code_hash: string};
export const viewAccount = (url: string, account: string) => rpc<AccountView>(url, 'query', {request_type: 'view_account', finality: 'optimistic', account_id: account});

export async function waitFor<T>(description: string, read: () => Promise<T>, done: (value: T) => boolean, timeoutMs: number, everyMs = 3_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new RehearsalRefusal(`Timed out waiting for ${description}; check the account on an explorer before retrying.`);
    await new Promise(resolve => setTimeout(resolve, everyMs));
  }
}
