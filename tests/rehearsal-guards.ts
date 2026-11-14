import assert from 'node:assert/strict';
import {RehearsalRefusal, redact, requireRehearsalConfirmation} from '../scripts/rehearsal/guards.js';

// The live rehearsal scripts call this before reading any key or opening any connection. The scripts themselves are
// never run here; only the guard that every one of them starts with is exercised.
const good = ['--confirm-disposable-testnet', '--network', 'testnet', '--account', 'reckon-rehearsal-a1.testnet'];
const accepted = requireRehearsalConfirmation(good, {});
assert.equal(accepted.account, 'reckon-rehearsal-a1.testnet');
assert.equal(accepted.network, 'testnet');
assert.equal(accepted.rpcUrl, 'https://rpc.testnet.near.org');

function refused(argv: string[], pattern: RegExp, env: NodeJS.ProcessEnv = {}) {
  assert.throws(() => requireRehearsalConfirmation(argv, env), (error: unknown) => error instanceof RehearsalRefusal && pattern.test(error.message), `expected a refusal matching ${pattern} for ${argv.join(' ')}`);
}
refused(['--network', 'testnet', '--account', 'reckon-rehearsal-a1.testnet'], /--confirm-disposable-testnet/);
refused(['--confirm-disposable-testnet', '--network', 'testnet'], /--account/);
refused(['--confirm-disposable-testnet', '--account', 'reckon-rehearsal-a1.testnet'], /--network testnet/);
refused(['--confirm-disposable-testnet', '--network', 'mainnet', '--account', 'reckon-rehearsal-a1.near'], /testnet/);
refused(['--confirm-disposable-testnet', '--network', 'testnet', '--account', 'srinivas.testnet'], /disposable/);
refused(['--confirm-disposable-testnet', '--network', 'testnet', '--account', 'reckon-rehearsal-a1.near'], /disposable/);
refused(['--confirm-disposable-testnet', '--network', 'testnet', '--account', 'reckon-rehearsal-.testnet'], /disposable/);
refused(['--confirm-disposable-testnet', '--network', 'testnet', '--account', 'sub.reckon-rehearsal-a1.testnet'], /disposable/);
refused([...good, '--rpc-url', 'http://rpc.testnet.near.org'], /https/);
refused([...good, '--rpc-url', 'https://rpc.mainnet.near.org'], /mainnet/);
refused(good, /mainnet/, {NEAR_ENV: 'mainnet'});
// A flag value that is itself the confirmation flag does not count as confirmation.
refused(['--network', 'testnet', '--account', '--confirm-disposable-testnet'], /--account/);

// Irreversible steps need the account name typed again.
const withLock = [...good, '--confirm-delete-full-access-key', 'reckon-rehearsal-a1.testnet'];
assert.equal(requireRehearsalConfirmation(withLock, {}, {irreversible: 'delete-full-access-key'}).account, 'reckon-rehearsal-a1.testnet');
assert.throws(() => requireRehearsalConfirmation(good, {}, {irreversible: 'delete-full-access-key'}), /confirm-delete-full-access-key/);
assert.throws(() => requireRehearsalConfirmation([...good, '--confirm-delete-full-access-key', 'reckon-rehearsal-other.testnet'], {}, {irreversible: 'delete-full-access-key'}), /confirm-delete-full-access-key/);

// Secrets never reach output: a 64-byte ed25519 secret key is 88 base58 characters, a public key 44.
const secret = `ed25519:${'5'.repeat(88)}`;
const publicKey = `ed25519:${'6'.repeat(44)}`;
assert.equal(redact(`key ${secret} and ${publicKey}`), `key ed25519:<redacted secret key> and ${publicKey}`);
assert.equal(redact(JSON.stringify({account_id: 'a.testnet', private_key: 'abc', secret_key: 'def', nested: {privateKey: 'ghi'}})), '{"account_id":"a.testnet","private_key":"<redacted>","secret_key":"<redacted>","nested":{"privateKey":"<redacted>"}}');
assert.equal(redact('vercel_blob_rw_abc123_xyz'), '<redacted token>');
assert.equal(redact('nothing secret here'), 'nothing secret here');
console.log('Rehearsal scripts refuse without confirmation, a disposable testnet account, and never print secrets');
