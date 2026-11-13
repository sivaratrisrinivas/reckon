import assert from 'node:assert/strict';
import { waitForCallback } from '../diagnostic/callback.js';

let now = 0;
const clock = () => now;
const sleep = async (milliseconds: number) => { now += milliseconds; };

await assert.rejects(waitForCallback({nonce: 'request', deadlineMs: 2_000, now: clock, sleep, read: async () => { throw new Error('Oracle RPC failed'); }}), /Oracle RPC failed/);

now = 0;
await assert.rejects(waitForCallback({nonce: 'request', deadlineMs: 2_000, now: clock, sleep, read: async () => now >= 2_000 ? {nonce: 'request'} : null}), /callback timed out/);

now = 0;
await assert.rejects(waitForCallback({nonce: 'request', deadlineMs: 2_000, now: clock, sleep, read: async () => { now = 2_000; return {nonce: 'request'}; }}), /callback timed out/);

now = 0;
const callback = await waitForCallback({nonce: 'request', deadlineMs: 2_000, now: clock, sleep, read: async () => now < 1_000 ? {nonce: 'older'} : {nonce: 'request', price: '3.4'}});
assert.equal(callback.price, '3.4');

now = 0;
const laterCallback = await waitForCallback({nonce: 'request', deadlineMs: 120_000, now: clock, sleep, read: async () => now < 70_000 ? null : {nonce: 'request', price: '3.5'}});
assert.equal(laterCallback.price, '3.5');
console.log('Oracle failure, timeout, delayed and mismatched callbacks were handled safely');
