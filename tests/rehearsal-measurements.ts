import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {KeyPairEd25519, Worker, type NearAccount} from 'near-workspaces';
import {functionCall, functionCallAccessKey} from 'near-api-js/lib/transaction.js';
import {keyAllowance, NEAR, predictionArgs, rpc, sandboxUrl, signAndSend, succeeded, TGAS, totalBurnt, type SandboxLife, type SignedOutcome} from './rehearsal-support.js';

// LOCAL SANDBOX WITH FIXTURE ORACLE, NOT LIVE. The oracle fixture returns its whole deposit, charges no worker fee and
// replies in a few blocks, so oracle cost and latency are not represented here. Everything on chain is the production Wasm.
const WASM = 'contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm';
const PUBLISH_GAS = 250n * TGAS;
// Same host and path shape as the verified public evidence store (docs/evidence/blob-storage-verification.json), with a 64-hex digest.
const blobUrl = (id: number) => `https://hl93vivkapaqgdrp.public.blob.vercel-storage.com/evidence/${id.toString(16).padStart(64, '0')}.json`;

const worker = await Worker.init();
try {
  const url = sandboxUrl(worker);
  const root = worker.rootAccount;
  const oracle = await root.devDeploy('contract/target/wasm32-unknown-unknown/release/reckon_oracle_fixture.wasm', {initialBalance: 5n * NEAR, method: 'new', args: {owner_id: root.accountId}});
  const keeper = await root.createSubAccount('keeper', {initialBalance: 30n * NEAR});
  const predictionKey = KeyPairEd25519.fromRandom();
  const contract = await root.devDeploy(WASM, {
    initialBalance: 120n * NEAR,
    method: 'new',
    args: {
      initial_bankroll: (100n * NEAR).toString(), operational_reserve: (20n * NEAR).toString(), idle_life_ns: '604800000000000',
      prediction_public_key: predictionKey.getPublicKey().toString(), oracle_account_id: oracle.accountId,
    },
  });
  await contract.batch(contract).addKey(predictionKey.getPublicKey(), functionCallAccessKey(contract.accountId, ['publish_prediction'], 5n * NEAR)).transact();
  await worker.provider.fastForward(5);

  const protocol = await rpc<{protocol_version: number; runtime_config: {storage_amount_per_byte: string}}>(url, 'EXPERIMENTAL_protocol_config', {finality: 'final'});
  const gasPrice = BigInt((await rpc<{gas_price: string}>(url, 'gas_price', [null])).gas_price);
  const byteCost = BigInt(protocol.runtime_config.storage_amount_per_byte);
  const storage = async () => BigInt((await contract.accountView()).storage_usage);
  const total = async (account: NearAccount) => BigInt((await account.balance()).total);
  const settled = async () => { await worker.provider.fastForward(5); }; // let gas-refund receipts land before reading balances
  const life = () => contract.view<SandboxLife>('life', {});

  const storageAtInit = await storage();
  const codeBytes = (await readFile(WASM)).byteLength;

  type OperationRecord = {gas_burnt: string; tokens_burnt_yocto: string; payer_net_yocto: string; contract_net_yocto: string; storage_delta_bytes: string};
  async function measure(payer: NearAccount, run: () => Promise<{gas: bigint; tokens: bigint}>): Promise<OperationRecord> {
    await settled();
    const [payerBefore, contractBefore, storageBefore] = [await total(payer), await total(contract), await storage()];
    const burnt = await run();
    await settled();
    const [payerAfter, contractAfter, storageAfter] = [await total(payer), await total(contract), await storage()];
    const sameAccount = payer.accountId === contract.accountId;
    return {
      gas_burnt: burnt.gas.toString(),
      tokens_burnt_yocto: burnt.tokens.toString(),
      // Positive means the account lost funds. When the contract signs for itself both figures describe the same account.
      payer_net_yocto: (payerBefore - payerAfter).toString(),
      contract_net_yocto: sameAccount ? (payerBefore - payerAfter).toString() : (contractBefore - contractAfter).toString(),
      storage_delta_bytes: (storageAfter - storageBefore).toString(),
    };
  }
  const burnOf = (result: {gas_burnt: string; result: {transaction_outcome: {outcome: {tokens_burnt: string}}; receipts_outcome: {outcome: {tokens_burnt: string}}[]}}) => ({
    gas: BigInt(result.gas_burnt),
    tokens: BigInt(result.result.transaction_outcome.outcome.tokens_burnt) + result.result.receipts_outcome.reduce((sum, receipt) => sum + BigInt(receipt.outcome.tokens_burnt), 0n),
  });
  let publicationCounter = 0;
  async function publish(decision: 'yes' | 'no' = 'no'): Promise<{prediction: {id: string; challenger_stake: string; agent_stake: string}; record: OperationRecord}> {
    publicationCounter += 1;
    const id = publicationCounter;
    let outcome: SignedOutcome | null = null;
    const record = await measure(contract, async () => {
      outcome = await signAndSend(url, contract.accountId, predictionKey, contract.accountId, [functionCall('publish_prediction', predictionArgs(id, decision, blobUrl(id)), PUBLISH_GAS, 0n)]);
      assert(succeeded(outcome), `publication ${id} must succeed`);
      return totalBurnt(outcome as Extract<SignedOutcome, {accepted: true}>);
    });
    const status = (outcome as unknown as Extract<SignedOutcome, {accepted: true}>).result.status as {SuccessValue: string};
    return {prediction: JSON.parse(Buffer.from(status.SuccessValue, 'base64').toString()), record};
  }
  const oracleScenario = (scenario: string) => root.call(oracle, 'set_scenario', {scenario});
  async function take(prediction: {id: string; challenger_stake: string}, who: NearAccount): Promise<OperationRecord> {
    return measure(who, async () => burnOf(await who.callRaw(contract, 'challenge_prediction', {prediction_id: prediction.id}, {attachedDeposit: BigInt(prediction.challenger_stake), gas: 30n * TGAS}) as never));
  }
  const chainNow = async () => BigInt((await rpc<{header: {timestamp_nanosec: string}}>(url, 'block', {finality: 'optimistic'})).header.timestamp_nanosec);
  // Move chain time to just past the prediction deadline, plus extra seconds, in small steps so the settlement window is not overshot.
  async function advancePastDeadline(id: string, extraSeconds = 0n): Promise<void> {
    const prediction = await contract.view<{deadline_ns: string}>('get_prediction', {id});
    const target = BigInt(prediction.deadline_ns) + extraSeconds * 1_000_000_000n;
    for (let step = 0; step < 100 && (await chainNow()) < target; step++) await worker.provider.fastForward(10);
    assert((await chainNow()) >= target, 'chain time reached the target');
  }
  // A stalled oracle request ends in a failed receipt by design, so its success is not asserted.
  const callAs = (who: NearAccount, method: string, id: string, expectSuccess = true) => measure(who, async () => {
    const result = await who.callRaw(contract, method, {prediction_id: id}, {gas: PUBLISH_GAS});
    if (expectSuccess) {
      const state = JSON.stringify(await contract.view('get_prediction', {id}));
      assert(result.succeeded, `${method} must succeed at chain time ${await chainNow()}: ${result.summary()} prediction ${state}`);
    }
    return burnOf(result as never);
  });

  // Required allowance per publication at several prepaid gas amounts, read from the network's own rejection.
  const probeKey = KeyPairEd25519.fromRandom();
  await contract.batch(contract).addKey(probeKey.getPublicKey(), functionCallAccessKey(contract.accountId, ['publish_prediction'], 1_000n)).transact();
  const requiredAllowance: Record<string, string> = {};
  for (const gas of [30n, 50n, 100n, 250n]) {
    const refused = await signAndSend(url, contract.accountId, probeKey, contract.accountId, [functionCall('publish_prediction', predictionArgs(9_000), gas * TGAS, 0n)]);
    assert(!refused.accepted);
    const detail = (refused.error.data as {TxExecutionError: {InvalidTxError: {InvalidAccessKeyError: {NotEnoughAllowance: {cost: string}}}}}).TxExecutionError.InvalidTxError.InvalidAccessKeyError.NotEnoughAllowance;
    requiredAllowance[`${gas}_tgas`] = detail.cost;
  }

  // Repeated unchallenged rounds show whether publication cost or storage drifts as the record grows.
  const series: {publication: OperationRecord; settlement: OperationRecord}[] = [];
  const allowanceBefore = (await keyAllowance(url, contract.accountId, predictionKey))!;
  for (let round = 0; round < 6; round++) {
    const {prediction, record} = await publish();
    await advancePastDeadline(prediction.id);
    await oracleScenario('below');
    series.push({publication: record, settlement: await callAs(keeper, 'request_settlement', prediction.id)});
  }
  await settled();
  const allowanceAfter = (await keyAllowance(url, contract.accountId, predictionKey))!;
  const seriesBurns = series.map(item => BigInt(item.publication.tokens_burnt_yocto));
  assert.equal(allowanceBefore - allowanceAfter, seriesBurns.reduce((sum, burn) => sum + burn, 0n), 'the key allowance falls by exactly the publication gas burnt');
  assert(Math.max(...seriesBurns.map(Number)) / Math.min(...seriesBurns.map(Number)) < 1.1, 'publication gas does not drift as the record grows');

  // Challenged round won by the challenger: take, oracle settlement, payout receipt.
  const winner = await root.createSubAccount('winning-challenger', {initialBalance: 10n * NEAR});
  const won = await publish('no');
  const wonTake = await take(won.prediction, winner);
  await advancePastDeadline(won.prediction.id);
  await oracleScenario('above');
  const wonSettlement = await callAs(keeper, 'request_settlement', won.prediction.id);
  assert.equal((await contract.view<{payment: {status: string}}>('get_prediction', {id: won.prediction.id})).payment.status, 'paid');

  // Challenged round won by the agent: its stake returns to bankroll and nothing is paid.
  const loser = await root.createSubAccount('losing-challenger', {initialBalance: 10n * NEAR});
  const lost = await publish('no');
  await take(lost.prediction, loser);
  await advancePastDeadline(lost.prediction.id);
  await oracleScenario('below');
  const lostSettlement = await callAs(keeper, 'request_settlement', lost.prediction.id);

  // Stalled oracle: the request never completes, anyone voids after the cutoff, and the challenger is refunded.
  const refunded = await root.createSubAccount('refunded-challenger', {initialBalance: 10n * NEAR});
  const voided = await publish('no');
  await take(voided.prediction, refunded);
  await advancePastDeadline(voided.prediction.id);
  await oracleScenario('stalled');
  const voidRequest = await callAs(keeper, 'request_settlement', voided.prediction.id, false);
  await advancePastDeadline(voided.prediction.id, 121n);
  const voidCall = await callAs(keeper, 'void_unsettled_prediction', voided.prediction.id);
  assert.equal((await contract.view<{payment: {status: string}; outcome: string}>('get_prediction', {id: voided.prediction.id})).payment.status, 'paid');

  // Failed payout, then retry after the beneficiary exists again.
  const failing = await root.createSubAccount('failing-challenger', {initialBalance: 10n * NEAR});
  const failingKey = (await failing.getKey()) as KeyPairEd25519;
  const owed = await publish('no');
  await take(owed.prediction, failing);
  await failing.delete(root.accountId);
  await advancePastDeadline(owed.prediction.id);
  await oracleScenario('above');
  const failedPayoutSettlement = await callAs(keeper, 'request_settlement', owed.prediction.id);
  assert.equal((await contract.view<{payment: {status: string}}>('get_prediction', {id: owed.prediction.id})).payment.status, 'pending');
  await root.createAccount(failing.accountId, {initialBalance: NEAR, keyPair: failingKey});
  const retry = await callAs(keeper, 'retry_payment', owed.prediction.id);
  assert.equal((await contract.view<{payment: {status: string}}>('get_prediction', {id: owed.prediction.id})).payment.status, 'paid');

  // Storage after publication, resolution and payment for the paid challenger win, and the cumulative record.
  const lifeNow = await life();
  const physical = BigInt((await contract.balance()).total);
  const available = BigInt((await contract.balance()).available);
  const obligations = BigInt(lifeNow.spendable_bankroll) + BigInt(lifeNow.committed_bankroll) + BigInt(lifeNow.challenger_custody) + BigInt(lifeNow.retired_bankroll) + BigInt(lifeNow.pending_payment_liabilities);
  const predictionsRecorded = publicationCounter;
  const storageNow = await storage();
  const stateBytesPerPrediction = (storageNow - storageAtInit) / BigInt(predictionsRecorded);
  assert(stateBytesPerPrediction > 300n && stateBytesPerPrediction < 3_000n, `a recorded prediction stays within a few hundred bytes of state: ${stateBytesPerPrediction}`);
  // The reserve must cover storage growth and gas: funds held beyond every recorded obligation stay positive.
  assert(available - obligations > 0n, 'the account still covers every recorded obligation after the measured rounds');

  const measurement = {
    label: 'local sandbox with fixture oracle, not live',
    environment: {
      sandbox: 'near-sandbox 2.14.0', protocol_version: protocol.protocol_version, gas_price_yocto: gasPrice.toString(), storage_byte_cost_yocto: byteCost.toString(),
      contract_wasm_bytes: codeBytes, storage_usage_at_initialization_bytes: storageAtInit.toString(),
      publication_prepaid_gas: PUBLISH_GAS.toString(), evidence_url_length_chars: blobUrl(1).length,
    },
    required_allowance_per_publication_yocto_by_prepaid_gas: requiredAllowance,
    operations: {
      publication_by_key: series.at(-1)!.publication,
      take: wonTake,
      settlement_unchallenged_or_agent_win_no_payout: series.at(-1)!.settlement,
      settlement_agent_win_challenged: lostSettlement,
      settlement_challenger_win_with_paid_payout: wonSettlement,
      settlement_request_stalled_oracle: voidRequest,
      void_with_refund_paid: voidCall,
      settlement_with_failed_payout: failedPayoutSettlement,
      retry_payment_success: retry,
    },
    publication_series: series.map(item => item.publication),
    unchallenged_settlement_series: series.map(item => item.settlement),
    key_allowance: {before_series_yocto: allowanceBefore.toString(), after_series_yocto: allowanceAfter.toString(), publications_in_series: series.length},
    record: {
      predictions_recorded: predictionsRecorded,
      state_growth_total_bytes: (storageNow - storageAtInit).toString(),
      state_bytes_per_prediction_average: stateBytesPerPrediction.toString(),
      storage_stake_per_prediction_yocto: (stateBytesPerPrediction * byteCost).toString(),
      code_storage_stake_yocto: (BigInt(codeBytes) * byteCost).toString(),
    },
    funds_at_end: {physical_yocto: physical.toString(), available_yocto: available.toString(), recorded_obligations_yocto: obligations.toString(), free_reserve_yocto: (available - obligations).toString()},
  };
  console.log(`REHEARSAL_MEASUREMENT ${JSON.stringify(measurement)}`);
  console.log('Local rehearsal measurements recorded (fixture oracle, not live)');
} finally {
  await worker.tearDown();
}
