// HUMAN-RUN ONLY. One step of a contract-level live rehearsal round on a disposable testnet account, with measurements.
// Every step refuses to run without --confirm-disposable-testnet and a reckon-rehearsal-*.testnet account, and appends a
// public-only record to .local/rehearsal/<account>/log.json. The browser, wallet and model journey are not covered here.
//
//   tsx scripts/rehearsal/round.ts <step> --confirm-disposable-testnet --network testnet --account <name> [step options]
//
// Steps and their options:
//   snapshot                                                  read-only: balances, storage, keys, allowance, life view
//   probe-allowance --owner-key-file <p>                      read the allowance the network requires, by prepaid gas (adds then deletes a probe key)
//   publish --prediction-key-file <p> --decision yes|no --confidence-ppm <n> --reference-multiplier <n> --reference-decimals <n>
//           --evidence-hash <64 hex> --evidence-url <https url> [--gas-tgas 250]
//   take --prediction-id <n> --challenger-account <name> --challenger-key-file <p>
//   request-settlement --prediction-id <n> --caller-account <name> --caller-key-file <p>   (attaches the paid oracle deposit from the agent)
//   void --prediction-id <n> --caller-account <name> --caller-key-file <p>                 (only at or after the settlement cutoff)
//   retry-payment --prediction-id <n> --caller-account <name> --caller-key-file <p>
//   wait-resolved --prediction-id <n> [--timeout-seconds 240]
import {pathToFileURL} from 'node:url';
import {KeyPair} from 'near-api-js/lib/utils/key_pair.js';
import {addKey, deleteKey, functionCall, functionCallAccessKey} from 'near-api-js/lib/transaction.js';
import {accessKeyList, keyAllowance, rpc, signAndSend, succeeded, totalBurnt, TGAS, type SignedOutcome} from '../../rehearsal-rpc.js';
import {appendLog, readKeyFile, required, say, viewAccount, viewCall, waitFor} from './common.js';
import {RehearsalRefusal, requireRehearsalConfirmation} from './guards.js';

const DISPOSABLE_NAME = /^reckon-rehearsal-[a-z0-9]+(?:-[a-z0-9]+)*\.testnet$/;
type Life = Record<string, string | boolean>;
type Prediction = {id: string; outcome: string | null; settlement_status: string; settlement_requested_at_ns: string | null; settled_at_ns: string | null; payment: {status: string; transfer_in_flight: boolean; amount: string} | null; deadline_ns: string};

function outcomeSummary(outcome: SignedOutcome) {
  if (!outcome.accepted) return {accepted: false, rejected: JSON.stringify(outcome.error.data ?? outcome.error.message)};
  const burnt = totalBurnt(outcome);
  return {accepted: true, transaction_hash: outcome.result.transaction.hash, succeeded: succeeded(outcome), gas_burnt: burnt.gas, tokens_burnt_yocto: burnt.tokens, receipts: outcome.result.receipts_outcome.length};
}

async function main(): Promise<void> {
  const step = process.argv[2];
  const {account, rpcUrl, options} = requireRehearsalConfirmation(process.argv.slice(3), process.env);
  const balanceOf = async (id: string) => BigInt((await viewAccount(rpcUrl, id)).amount);
  const record = async (entry: object) => { await appendLog(account, {account, ...entry}); say(entry); };

  if (step === 'snapshot') {
    const [state, keys, life, price] = await Promise.all([
      viewAccount(rpcUrl, account), accessKeyList(rpcUrl, account), viewCall<Life>(rpcUrl, account, 'life'), rpc<{gas_price: string}>(rpcUrl, 'gas_price', [null]),
    ]);
    const config = await rpc<{protocol_version: number; runtime_config: {storage_amount_per_byte: string}}>(rpcUrl, 'EXPERIMENTAL_protocol_config', {finality: 'final'});
    const predictionKeys = keys.filter(key => key.access_key.permission !== 'FullAccess');
    await record({
      step, amount_yocto: state.amount, storage_usage_bytes: state.storage_usage, code_hash: state.code_hash,
      gas_price_yocto: price.gas_price, storage_byte_cost_yocto: config.runtime_config.storage_amount_per_byte, protocol_version: config.protocol_version,
      life, keys: keys.map(key => ({public_key: key.public_key, permission: key.access_key.permission})),
      function_call_key_count: predictionKeys.length,
    });
    return;
  }

  if (step === 'probe-allowance') {
    const owner = await readKeyFile(required(options, '--owner-key-file'));
    const probe = KeyPair.fromRandom('ed25519');
    const arguments_ = {reference_multiplier: '1', reference_decimals: 0, decision: 'no', confidence_ppm: 850_000, evidence_hash: '0'.repeat(64), evidence_url: 'https://example.invalid/probe.json'};
    const added = await signAndSend(rpcUrl, account, owner, account, [addKey(probe.getPublicKey(), functionCallAccessKey(account, ['publish_prediction'], 1_000n))]);
    if (!added.accepted) throw new RehearsalRefusal('The probe key was not added.');
    const costs: Record<string, string> = {};
    try {
      for (const gas of [30n, 50n, 100n, 250n]) {
        const refused = await signAndSend(rpcUrl, account, probe, account, [functionCall('publish_prediction', arguments_, gas * TGAS, 0n)]);
        const detail = !refused.accepted
          ? (refused.error.data as {TxExecutionError?: {InvalidTxError?: {InvalidAccessKeyError?: {NotEnoughAllowance?: {cost: string}}}}} | undefined)?.TxExecutionError?.InvalidTxError?.InvalidAccessKeyError?.NotEnoughAllowance
          : undefined;
        costs[`${gas}_tgas`] = detail?.cost ?? 'not rejected for allowance';
      }
    } finally {
      await signAndSend(rpcUrl, account, owner, account, [deleteKey(probe.getPublicKey())]);
    }
    await record({step, required_allowance_yocto_by_prepaid_gas: costs});
    return;
  }

  const predictionId = required(options, '--prediction-id');
  if (step === 'wait-resolved') {
    const timeoutSeconds = typeof options.get('--timeout-seconds') === 'string' ? Number(options.get('--timeout-seconds')) : 240;
    const resolved = await waitFor('the prediction to resolve or void', () => viewCall<Prediction | null>(rpcUrl, account, 'get_prediction', {id: predictionId}), item => Boolean(item?.outcome), timeoutSeconds * 1_000);
    const requested = resolved?.settlement_requested_at_ns ? BigInt(resolved.settlement_requested_at_ns) : null;
    const settled = resolved?.settled_at_ns ? BigInt(resolved.settled_at_ns) : null;
    await record({step, prediction: resolved, oracle_round_trip_chain_seconds: requested && settled ? Number(settled - requested) / 1e9 : null, note: 'chain time between the settlement request and the accepted callback'});
    return;
  }

  const send = async (signerId: string, key: KeyPair, method: string, args: object, deposit: bigint, gasTgas: bigint, measuredAccounts: string[]) => {
    const before = await Promise.all(measuredAccounts.map(balanceOf));
    const startedAt = Date.now();
    const outcome = await signAndSend(rpcUrl, signerId, key, account, [functionCall(method, args, gasTgas * TGAS, deposit)]);
    const elapsedMs = Date.now() - startedAt;
    if (method === 'request_settlement' && outcomeSummary(outcome).accepted) {
      // The paid oracle answers asynchronously; balances are only meaningful once the callback has been applied or the window closed.
      await waitFor('the oracle callback or the settlement window', () => viewCall<Prediction | null>(rpcUrl, account, 'get_prediction', {id: String((args as {prediction_id: string}).prediction_id)}),
        item => Boolean(item?.outcome), 180_000).catch(() => undefined);
    }
    await new Promise(resolve => setTimeout(resolve, 15_000)); // let gas refunds land before reading balances
    const after = await Promise.all(measuredAccounts.map(balanceOf));
    return {
      step, method, signer: signerId, elapsed_ms_client_clock: elapsedMs, ...outcomeSummary(outcome),
      net_balance_fall_yocto: Object.fromEntries(measuredAccounts.map((id, index) => [id, before[index] - after[index]])),
    };
  };

  if (step === 'publish') {
    const key = await readKeyFile(required(options, '--prediction-key-file'));
    const gas = BigInt(typeof options.get('--gas-tgas') === 'string' ? options.get('--gas-tgas') as string : '250');
    const decision = required(options, '--decision');
    const args = {
      reference_multiplier: required(options, '--reference-multiplier'), reference_decimals: Number(required(options, '--reference-decimals')), decision,
      confidence_ppm: Number(required(options, '--confidence-ppm')), evidence_hash: required(options, '--evidence-hash'), evidence_url: required(options, '--evidence-url'),
    };
    const allowanceBefore = await keyAllowance(rpcUrl, account, key);
    const result = await send(account, key, 'publish_prediction', args, 0n, gas, [account]);
    const allowanceAfter = await keyAllowance(rpcUrl, account, key);
    await record({...result, prepaid_gas_tgas: gas, allowance_before_yocto: allowanceBefore, allowance_after_yocto: allowanceAfter, allowance_consumed_yocto: allowanceBefore !== null && allowanceAfter !== null ? allowanceBefore - allowanceAfter : null, rehearsal_note: 'contract-level publication with operator-supplied terms; not a service-made model forecast'});
    return;
  }

  const challenger = step === 'take' ? required(options, '--challenger-account') : required(options, '--caller-account');
  if (!DISPOSABLE_NAME.test(challenger)) throw new RehearsalRefusal('The calling account must also be a disposable reckon-rehearsal-<suffix>.testnet account.');
  const key = await readKeyFile(required(options, step === 'take' ? '--challenger-key-file' : '--caller-key-file'));
  if (step === 'take') {
    const prediction = await viewCall<{challenger_stake: string} | null>(rpcUrl, account, 'get_prediction', {id: predictionId});
    if (!prediction) throw new RehearsalRefusal('No such prediction.');
    await record(await send(challenger, key, 'challenge_prediction', {prediction_id: predictionId}, BigInt(prediction.challenger_stake), 30n, [challenger, account]));
  } else if (step === 'request-settlement' || step === 'void' || step === 'retry-payment') {
    const method = step === 'request-settlement' ? 'request_settlement' : step === 'void' ? 'void_unsettled_prediction' : 'retry_payment';
    await record(await send(challenger, key, method, {prediction_id: predictionId}, 0n, 250n, [challenger, account]));
  } else {
    throw new RehearsalRefusal(`Unknown step ${String(step)}.`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(error instanceof RehearsalRefusal ? error.message : 'Rehearsal step failed; check the account before retrying.');
    process.exitCode = 1;
  });
}
