// HUMAN-RUN ONLY. Deploys the production Wasm to a disposable testnet account and initializes it with `new_live`
// in the same transaction (so nobody can initialize it first), then adds the restricted publication key.
// It spends testnet NEAR. It refuses to run without --confirm-disposable-testnet and a reckon-rehearsal-*.testnet account.
//
//   tsx scripts/rehearsal/deploy-and-init.ts --confirm-disposable-testnet --network testnet \
//     --account reckon-rehearsal-<suffix>.testnet --owner-key-file <path, chmod 600> \
//     --bankroll-near <n> --reserve-near <n> --allowance-near <n> [--wasm <path>] [--rpc-url https://...]
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {KeyPair} from 'near-api-js/lib/utils/key_pair.js';
import {base_encode} from 'near-api-js/lib/utils/serialize.js';
import {addKey, deployContract, functionCall, functionCallAccessKey} from 'near-api-js/lib/transaction.js';
import {rpc, signAndSend, TGAS} from '../../rehearsal-rpc.js';
import {auditExports} from '../../rehearsal-audit.js';
import {appendLog, parseNear, readKeyFile, required, say, stateDirectory, viewAccount, writeNewSecretFile} from './common.js';
import {RehearsalRefusal, requireRehearsalConfirmation} from './guards.js';

async function main(): Promise<void> {
  const {account, rpcUrl, options} = requireRehearsalConfirmation(process.argv.slice(2), process.env);
  const wasmPath = typeof options.get('--wasm') === 'string' ? options.get('--wasm') as string : 'contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm';
  const bankroll = parseNear(required(options, '--bankroll-near'));
  const reserve = parseNear(required(options, '--reserve-near'));
  const allowance = parseNear(required(options, '--allowance-near'));
  const ownerKey = await readKeyFile(required(options, '--owner-key-file'));
  const wasm = await readFile(wasmPath);

  // The deployed artifact must be the audited production build, never the callback-fault test build.
  const violations = auditExports(wasm);
  if (violations.length > 0) throw new RehearsalRefusal(`The Wasm fails the export audit: ${violations.join('; ')}`);
  const codeHash = base_encode(createHash('sha256').update(wasm).digest());

  const before = await viewAccount(rpcUrl, account);
  if (before.code_hash !== '11111111111111111111111111111111') throw new RehearsalRefusal('The account already has contract code; use a fresh disposable account.');
  const amount = BigInt(before.amount);
  if (amount < bankroll + reserve) throw new RehearsalRefusal(`The account holds ${amount} yoctoNEAR; new_live needs at least bankroll plus reserve (${bankroll + reserve}). Fund it first.`);
  const codeStorage = BigInt(wasm.byteLength) * 10n ** 19n;
  if (amount - codeStorage < bankroll + reserve) {
    say({warning: 'After the code storage stake the free funds are below bankroll plus reserve; the reserve will be smaller than configured.', code_storage_stake_yocto: codeStorage});
  }

  const predictionKey = KeyPair.fromRandom('ed25519');
  const keyPath = `${stateDirectory(account)}/prediction-key.json`;
  await writeNewSecretFile(keyPath, JSON.stringify({account_id: account, public_key: predictionKey.getPublicKey().toString(), secret_key: predictionKey.toString()}));

  // One transaction: deploy then initialize, so the initializer cannot be front-run.
  const initArgs = {initial_bankroll: bankroll.toString(), operational_reserve: reserve.toString(), prediction_public_key: predictionKey.getPublicKey().toString()};
  const deployed = await signAndSend(rpcUrl, account, ownerKey, account, [deployContract(wasm), functionCall('new_live', initArgs, 100n * TGAS, 0n)]);
  if (!deployed.accepted) throw new RehearsalRefusal(`The deploy transaction was rejected: ${JSON.stringify(deployed.error.data ?? deployed.error.message)}`);
  const initialized = typeof deployed.result.status === 'object' && deployed.result.status !== null && 'SuccessValue' in deployed.result.status;
  if (!initialized) throw new RehearsalRefusal('Deployment executed but initialization failed. Do not reuse this account; create a new disposable one.');

  const keyAdded = await signAndSend(rpcUrl, account, ownerKey, account, [addKey(predictionKey.getPublicKey(), functionCallAccessKey(account, ['publish_prediction'], allowance))]);
  if (!keyAdded.accepted) throw new RehearsalRefusal(`The restricted key was not added: ${JSON.stringify(keyAdded.error.data ?? keyAdded.error.message)}`);

  const after = await viewAccount(rpcUrl, account);
  const summary = {
    step: 'deploy-and-init', account, rpc_url: rpcUrl, code_hash_local_wasm: codeHash, code_hash_on_chain: after.code_hash, code_hash_matches: after.code_hash === codeHash,
    wasm_bytes: wasm.byteLength, prediction_public_key: predictionKey.getPublicKey().toString(), prediction_key_file: keyPath,
    initial_bankroll_yocto: bankroll, operational_reserve_yocto: reserve, allowance_yocto: allowance,
    storage_usage_bytes: after.storage_usage, amount_after_yocto: after.amount,
    idle_life_note: 'new_live fixes fifteen days of idle life: upkeep starts now',
    chain_id: await rpc<{chain_id: string}>(rpcUrl, 'status', []).then(status => status.chain_id),
  };
  await appendLog(account, summary);
  say(summary);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(error instanceof RehearsalRefusal ? error.message : 'Rehearsal step failed; check the account before retrying.');
    process.exitCode = 1;
  });
}
