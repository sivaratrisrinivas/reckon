import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {auditAccessKeys, auditExports, auditSource, type KeyPolicy} from '../rehearsal-audit.js';

const releaseDirectory = 'contract/target/wasm32-unknown-unknown/release';
const production = await readFile(`${releaseDirectory}/reckon_contract.wasm`);
const faultArtifact = await readFile(`${releaseDirectory}/reckon_contract_callback_fault.wasm`);

// The production artifact exports only the reviewed public surface.
assert.deepEqual(auditExports(production), [], 'the production Wasm exports an unreviewed or administrative method');

// Negative controls: the audit must be able to fail.
const withFaultSetter = auditExports(faultArtifact);
assert(withFaultSetter.some(violation => violation.includes('set_payment_callback_fault')), `the test-only Wasm must be flagged: ${withFaultSetter.join('; ')}`);
// A hand-assembled module exporting `withdraw` and `upgrade`, which no reviewed allowlist contains.
function exportOnlyModule(names: string[]): Uint8Array {
  const text = new TextEncoder();
  const leb = (value: number) => [value];
  const entries = names.flatMap(name => [...leb(name.length), ...text.encode(name), 0x00, 0x00]);
  const typeSection = [0x01, 0x04, 0x01, 0x60, 0x00, 0x00];
  const functionSection = [0x03, ...leb(1 + names.length), ...leb(names.length), ...names.map(() => 0x00)];
  const exportBody = [...leb(names.length), ...entries];
  const exportSection = [0x07, ...leb(exportBody.length), ...exportBody];
  const codeBodies = names.flatMap(() => [0x02, 0x00, 0x0b]);
  const codeSection = [0x0a, ...leb(1 + codeBodies.length), ...leb(names.length), ...codeBodies];
  return new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, ...typeSection, ...functionSection, ...exportSection, ...codeSection]);
}
const handmade = auditExports(exportOnlyModule(['withdraw', 'upgrade']));
assert(handmade.some(violation => violation.includes('withdraw')) && handmade.some(violation => violation.includes('upgrade')), 'withdraw and upgrade exports are rejected');
assert(auditExports(exportOnlyModule(['publish_prediction'])).some(violation => violation.includes('missing')), 'a module lacking the reviewed methods is also flagged');

// The compiled imports cannot prove absence: the SDK links every promise action host function.
// The source is therefore audited for any scheduling of code, key, account or stake actions.
const sourceFiles = Object.fromEntries(await Promise.all(
  (await readdir('contract/src')).filter(name => name.endsWith('.rs')).map(async name => [name, await readFile(`contract/src/${name}`, 'utf8')] as const),
));
assert(Object.keys(sourceFiles).length >= 2, 'both contract source files are audited');
assert.deepEqual(auditSource(sourceFiles), [], 'the contract source schedules a forbidden promise action');
for (const [snippet, expected] of [
  ['fn drain() { Promise::new(a).deploy_contract(code); }', 'deploy_contract'],
  ['fn k() { Promise::new(a).add_full_access_key(pk); }', 'add_full_access_key'],
  ['fn k() { Promise::new(a).add_access_key_allowance(pk, a, r, m); }', 'add_access_key'],
  ['fn k() { Promise::new(a).delete_key(pk); }', 'delete_key'],
  ['fn k() { Promise::new(a).delete_account(b); }', 'delete_account'],
  ['fn k() { Promise::new(a).stake(1, pk); }', 'stake'],
  ['fn k() { Promise::new(a).create_account(); }', 'create_account'],
  ['fn k() { unsafe { sys::promise_batch_action_deploy_contract(1, 2, 3); } }', 'promise_batch_action_deploy_contract'],
  ['pub fn withdraw(&mut self) { Promise::new(owner).transfer(amount); }', '.transfer('],
  ['fn start_payment_transfer() { Promise::new(a).transfer(1); } fn extra() { Promise::new(b).transfer(2); }', '.transfer('],
] as const) {
  const flagged = auditSource({'injected.rs': snippet});
  assert(flagged.some(violation => violation.includes(expected)), `the source audit must flag ${expected}: ${flagged.join('; ')}`);
}
assert.deepEqual(auditSource({'ok.rs': 'fn start_payment_transfer() { Promise::new(b).transfer(NearToken::from_yoctonear(1)).then(x); }'}), [], 'the single payment transfer is accepted');

// A locked account has exactly one finite, publication-only function-call key.
const policy: KeyPolicy = {contractId: 'agent.testnet', predictionPublicKey: 'ed25519:PREDICTION', methods: ['publish_prediction']};
const restricted = {public_key: 'ed25519:PREDICTION', access_key: {permission: {FunctionCall: {allowance: '5000000000000000000000000', receiver_id: 'agent.testnet', method_names: ['publish_prediction']}}}};
assert.deepEqual(auditAccessKeys([restricted], policy), [], 'the intended locked key list passes');
const full = {public_key: 'ed25519:OWNER', access_key: {permission: 'FullAccess' as const}};
assert(auditAccessKeys([full, restricted], policy).some(violation => violation.includes('full-access')), 'a surviving full-access key is rejected');
assert(auditAccessKeys([], policy).some(violation => violation.includes('prediction key')), 'a missing prediction key is rejected');
const withAllowance = (allowance: string | null, receiver = 'agent.testnet', methods = ['publish_prediction']) => ({public_key: 'ed25519:PREDICTION', access_key: {permission: {FunctionCall: {allowance, receiver_id: receiver, method_names: methods}}}});
assert(auditAccessKeys([withAllowance(null)], policy).some(violation => violation.includes('unlimited')), 'an unlimited allowance is rejected');
assert(auditAccessKeys([withAllowance('0')], policy).some(violation => violation.includes('allowance')), 'an empty allowance is rejected');
assert(auditAccessKeys([withAllowance('1', 'other.testnet')], policy).some(violation => violation.includes('receiver')), 'a foreign receiver is rejected');
assert(auditAccessKeys([withAllowance('1', 'agent.testnet', [])], policy).some(violation => violation.includes('methods')), 'an unrestricted method list is rejected');
assert(auditAccessKeys([withAllowance('1', 'agent.testnet', ['publish_prediction', 'accrue'])], policy).some(violation => violation.includes('methods')), 'an extra permitted method is rejected');
assert(auditAccessKeys([restricted, {...restricted, public_key: 'ed25519:OTHER'}], policy).some(violation => violation.includes('unexpected')), 'a second key is rejected');
console.log('Compiled exports, contract source, and locked key-list audits pass and each audit rejects its negative controls');
