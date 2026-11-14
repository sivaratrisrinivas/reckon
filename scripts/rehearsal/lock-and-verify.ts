// HUMAN-RUN ONLY. Read-only verification of a rehearsal account, and the rehearsal lock.
// `verify` audits the code the chain actually holds and the account's keys. `lock` deletes the owner's full-access key
// and is irreversible for that account; it needs the account name typed again as --confirm-delete-full-access-key.
//
//   tsx scripts/rehearsal/lock-and-verify.ts verify --confirm-disposable-testnet --network testnet --account <name> \
//       --prediction-public-key ed25519:... [--wasm <path>] [--expect locked|unlocked]
//   tsx scripts/rehearsal/lock-and-verify.ts lock --confirm-disposable-testnet --network testnet --account <name> \
//       --prediction-public-key ed25519:... --owner-key-file <path> --confirm-delete-full-access-key <name>
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {base_encode} from 'near-api-js/lib/utils/serialize.js';
import {deleteKey} from 'near-api-js/lib/transaction.js';
import {accessKeyList, rpc, signAndSend} from '../../rehearsal-rpc.js';
import {auditAccessKeys, auditExports} from '../../rehearsal-audit.js';
import {appendLog, readKeyFile, required, say} from './common.js';
import {RehearsalRefusal, requireRehearsalConfirmation} from './guards.js';

async function verify(rpcUrl: string, account: string, predictionPublicKey: string, wasmPath: string, expect: 'locked' | 'unlocked') {
  const local = await readFile(wasmPath);
  const localHash = base_encode(createHash('sha256').update(local).digest());
  const deployed = await rpc<{code_base64: string; hash: string}>(rpcUrl, 'query', {request_type: 'view_code', finality: 'final', account_id: account});
  const deployedBytes = Buffer.from(deployed.code_base64, 'base64');
  const keys = await accessKeyList(rpcUrl, account);
  const keyViolations = auditAccessKeys(keys, {contractId: account, predictionPublicKey, methods: ['publish_prediction']});
  const fullAccess = keyViolations.filter(violation => violation.includes('full-access'));
  const violations = [
    ...(deployed.hash === localHash ? [] : [`deployed code hash ${deployed.hash} differs from the local build ${localHash}`]),
    // The audit runs on the bytes the chain returns, not only on the local file.
    ...auditExports(deployedBytes),
    ...(expect === 'locked' ? keyViolations : keyViolations.filter(violation => !violation.includes('full-access') && !violation.includes('unexpected key'))),
    ...(expect === 'unlocked' && fullAccess.length === 0 ? ['expected the owner full-access key to still be present before the lock'] : []),
  ];
  const report = {
    step: `verify-${expect}`, account, code_hash_on_chain: deployed.hash, code_hash_local_build: localHash, code_bytes: deployedBytes.byteLength,
    keys: keys.map(key => ({public_key: key.public_key, permission: key.access_key.permission})), violations, passed: violations.length === 0,
  };
  await appendLog(account, report);
  say(report);
  return violations.length === 0;
}

async function main(): Promise<void> {
  const step = process.argv[2];
  const confirmed = requireRehearsalConfirmation(process.argv.slice(3), process.env, step === 'lock' ? {irreversible: 'delete-full-access-key'} : {});
  const {account, rpcUrl, options} = confirmed;
  const predictionPublicKey = required(options, '--prediction-public-key');
  const wasmPath = typeof options.get('--wasm') === 'string' ? options.get('--wasm') as string : 'contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm';
  if (step === 'verify') {
    const expect = options.get('--expect') === 'unlocked' ? 'unlocked' : 'locked';
    process.exitCode = (await verify(rpcUrl, account, predictionPublicKey, wasmPath, expect)) ? 0 : 1;
    return;
  }
  if (step === 'lock') {
    // Never lock an account that has not passed the pre-lock verification.
    if (!(await verify(rpcUrl, account, predictionPublicKey, wasmPath, 'unlocked'))) throw new RehearsalRefusal('Pre-lock verification failed; not deleting the full-access key.');
    const owner = await readKeyFile(required(options, '--owner-key-file'));
    const ownerPublicKey = owner.getPublicKey().toString();
    const keys = await accessKeyList(rpcUrl, account);
    if (!keys.some(key => key.public_key === ownerPublicKey && key.access_key.permission === 'FullAccess')) throw new RehearsalRefusal('The owner key file is not a full-access key on this account.');
    const fullAccessKeys = keys.filter(key => key.access_key.permission === 'FullAccess');
    if (fullAccessKeys.length !== 1) throw new RehearsalRefusal('Expected exactly one full-access key before the lock.');
    const outcome = await signAndSend(rpcUrl, account, owner, account, [deleteKey(owner.getPublicKey())]);
    if (!outcome.accepted) throw new RehearsalRefusal(`The lock transaction was rejected: ${JSON.stringify(outcome.error.data ?? outcome.error.message)}`);
    await new Promise(resolve => setTimeout(resolve, 10_000));
    process.exitCode = (await verify(rpcUrl, account, predictionPublicKey, wasmPath, 'locked')) ? 0 : 1;
    return;
  }
  throw new RehearsalRefusal('Use the step verify or lock.');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(error instanceof RehearsalRefusal ? error.message : 'Rehearsal step failed; check the account before retrying.');
    process.exitCode = 1;
  });
}
