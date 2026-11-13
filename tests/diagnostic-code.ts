import assert from 'node:assert/strict';
import { assertScratchCode, assertScratchProvider } from '../diagnostic/code.js';

const local = Buffer.from('verified contract');
assert.doesNotThrow(() => assertScratchCode(local, {result: {code_base64: local.toString('base64')}}));
assert.throws(() => assertScratchCode(local, {result: {code_base64: Buffer.from('other contract').toString('base64')}}), /does not match/);
assert.throws(() => assertScratchCode(local, {error: {name: 'UNKNOWN_ACCOUNT'}}), /unavailable/);
const provider = (id: string) => ({result: {result: [...Buffer.from(JSON.stringify(id))]}});
assert.doesNotThrow(() => assertScratchProvider(provider('price-oracle.testnet')));
assert.throws(() => assertScratchProvider(provider('other.testnet')), /provider/);
console.log('Scratch code verification rejects missing or different deployed code');
