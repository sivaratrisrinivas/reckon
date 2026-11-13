import assert from 'node:assert/strict';
import {KeyPairEd25519, Worker} from 'near-workspaces';
import {functionCallAccessKey} from 'near-api-js/lib/transaction.js';

const NEAR = 10n ** 24n;
const worker = await Worker.init();
try {
  const root = worker.rootAccount;
  const oracle = await root.devDeploy('contract/target/wasm32-unknown-unknown/release/reckon_oracle_fixture.wasm', {
    initialBalance: 5n * NEAR,
    method: 'new',
    args: {owner_id: root.accountId},
  });
  const predictionKey = KeyPairEd25519.fromRandom();
  const contract = await root.devDeploy('contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm', {
    initialBalance: 120n * NEAR,
    method: 'new',
    args: {
      initial_bankroll: (100n * NEAR).toString(),
      operational_reserve: (20n * NEAR).toString(),
      idle_life_ns: '604800000000000',
      prediction_public_key: predictionKey.getPublicKey().toString(),
      oracle_account_id: oracle.accountId,
    },
  });
  await contract.batch(contract).addKey(
    predictionKey.getPublicKey(),
    functionCallAccessKey(contract.accountId, ['publish_prediction'], 5n * NEAR),
  ).transact();

  const setOracleScenario = (scenario: string) => root.call(oracle, 'set_scenario', {scenario});
  const publish = (id: number, decision = 'no') => contract.call<{id: string; agent_stake: string; challenger_stake: string}>(
    contract,
    'publish_prediction',
    {
      reference_multiplier: '340823333',
      reference_decimals: 8,
      decision,
      confidence_ppm: 850_000,
      evidence_hash: id.toString(16).padStart(64, '0'),
      evidence_url: `https://evidence.reckon.invalid/${id.toString(16).padStart(64, '0')}.json`,
    },
    {signWithKey: predictionKey},
  );

  const first = await publish(1);
  const firstChallenger = await root.createSubAccount('equal-challenger', {initialBalance: 10n * NEAR});
  await firstChallenger.call(contract, 'challenge_prediction', {prediction_id: first.id}, {attachedDeposit: BigInt(first.challenger_stake)});
  await assert.rejects(contract.call(contract, 'request_settlement', {prediction_id: first.id}), 'settlement cannot be requested before the deadline');
  const rejectedImpersonation = await contract.callRaw(contract, 'oracle_on_call', {
    sender_id: contract.accountId,
    data: {timestamp: '1', recency_duration_sec: 300, prices: []},
    msg: 'forged',
  });
  assert.equal(rejectedImpersonation.succeeded, false, 'only the configured oracle can submit an observation');

  await worker.provider.fastForward(300);
  await setOracleScenario('equal');
  const equalReceipt = await contract.callRaw(contract, 'request_settlement', {prediction_id: first.id}, {gas: 250n * 10n ** 12n});
  assert.equal(equalReceipt.succeeded, true, equalReceipt.summary());
  const equal = await contract.view<{
    outcome: string;
    settlement_status: string;
    settlement_price: {multiplier: string; decimals: number; response_timestamp_ns: string; provider_recency_seconds: number};
    payment: unknown;
  }>('get_prediction', {id: first.id});
  assert.equal(equal.outcome, 'no', 'equality resolves to no');
  assert.equal(equal.settlement_status, 'resolved');
  assert.deepEqual(equal.settlement_price, {multiplier: '340823333', decimals: 8, response_timestamp_ns: equal.settlement_price.response_timestamp_ns, provider_recency_seconds: 300});
  assert.equal(equal.payment, null, 'the agent win requires no outgoing payment');
  assert.equal(await contract.view('active_prediction'), null, 'a settled prediction releases the active slot');
  await assert.rejects(contract.call(contract, 'request_settlement', {prediction_id: first.id}), 'a completed result cannot be requested or changed again');

  const storageBeforeRound = BigInt((await contract.accountView()).storage_usage);
  const second = await publish(2);
  const secondChallenger = await root.createSubAccount('winning-challenger', {initialBalance: 10n * NEAR});
  const challengerBefore = BigInt((await secondChallenger.balance()).total);
  await secondChallenger.call(contract, 'challenge_prediction', {prediction_id: second.id}, {attachedDeposit: BigInt(second.challenger_stake)});
  await worker.provider.fastForward(300);
  await setOracleScenario('above');
  const winningReceipt = await contract.callRaw(contract, 'request_settlement', {prediction_id: second.id}, {gas: 250n * 10n ** 12n});
  assert.equal(winningReceipt.succeeded, true, winningReceipt.summary());
  const won = await contract.view<{
    outcome: string;
    payment: {beneficiary_account_id: string; amount: string; status: string; transfer_in_flight: boolean} | null;
  }>('get_prediction', {id: second.id});
  assert.equal(won.outcome, 'yes');
  assert.deepEqual(won.payment && {
    beneficiary_account_id: won.payment.beneficiary_account_id,
    amount: won.payment.amount,
    status: won.payment.status,
    transfer_in_flight: won.payment.transfer_in_flight,
  }, {
    beneficiary_account_id: secondChallenger.accountId,
    amount: (BigInt(second.agent_stake) + BigInt(second.challenger_stake)).toString(),
    status: 'paid',
    transfer_in_flight: false,
  }, 'the liability is recorded before transfer and becomes paid only after its receipt succeeds');
  assert(BigInt((await secondChallenger.balance()).total) > challengerBefore, 'a challenger win returns both stakes and credits the agent stake');
  assert(winningReceipt.receipts_outcomes.some(receipt => receipt.succeeded), 'the real sandbox execution includes successful settlement and payout receipts');
  const storageAfterRound = BigInt((await contract.accountView()).storage_usage);
  const roundMeasurement = {
    scenario: 'challenged_challenger_win',
    environment: 'local NEAR sandbox with deterministic oracle fixture',
    prediction_id: second.id,
    total_records_after_round: 2,
    outcome: won.outcome,
    payment_status: won.payment?.status,
    storage_bytes_before_round: storageBeforeRound.toString(),
    storage_bytes_after_round: storageAfterRound.toString(),
    storage_growth_bytes: (storageAfterRound - storageBeforeRound).toString(),
    oracle_fixture_account: oracle.accountId,
    oracle_request_attached_near: '0.02',
    external_oracle_worker_charge_near: null,
    end_to_end_oracle_and_payout_duration_ms: winningReceipt.durationMs,
    end_to_end_gas_burnt_yocto_gas: winningReceipt.gas_burnt,
    receipt_gas_burnt_yocto_gas: winningReceipt.receipts_outcomes.map(receipt => receipt.gas_burnt),
    successful_receipts: winningReceipt.receipts_outcomes.filter(receipt => receipt.succeeded).length,
    receipt_count: winningReceipt.receipts_outcomes.length,
  };

  const third = await publish(3);
  const voidChallenger = await root.createSubAccount('void-challenger', {initialBalance: 10n * NEAR});
  await voidChallenger.call(contract, 'challenge_prediction', {prediction_id: third.id}, {attachedDeposit: BigInt(third.challenger_stake)});
  await worker.provider.fastForward(300);
  await setOracleScenario('stalled');
  const stalledReceipt = await contract.callRaw(contract, 'request_settlement', {prediction_id: third.id}, {gas: 250n * 10n ** 12n});
  assert.equal(stalledReceipt.succeeded, false, 'the fixture simulates an oracle call that fails without delivering a callback');
  const pending = await contract.view<{settlement_status: string; settlement_request_id: string | null}>('get_prediction', {id: third.id});
  assert.equal(pending.settlement_status, 'observing');
  assert(pending.settlement_request_id, 'the request identity is recorded while observation is pending');
  await assert.rejects(contract.call(contract, 'request_settlement', {prediction_id: third.id}), 'a stalled request cannot race another observation');
  await assert.rejects(contract.call(contract, 'void_unsettled_prediction', {prediction_id: third.id}), 'a stalled request cannot be voided before the measured window closes');
  await worker.provider.fastForward(120);
  const refundReceipt = await contract.callRaw(contract, 'void_unsettled_prediction', {prediction_id: third.id}, {gas: 250n * 10n ** 12n});
  assert.equal(refundReceipt.succeeded, true, refundReceipt.summary());
  const voided = await contract.view<{outcome: string; payment: {status: string; amount: string} | null}>('get_prediction', {id: third.id});
  assert.equal(voided.outcome, 'void');
  assert.equal(voided.payment?.status, 'paid', 'void refunds the challenger through a confirmed transfer receipt');
  assert.equal(voided.payment?.amount, third.challenger_stake);
  const afterVoid = await contract.view<{committed_bankroll: string; challenger_custody: string}>('life');
  assert.equal(afterVoid.committed_bankroll, '0', 'voiding releases the agent commitment');
  assert.equal(afterVoid.challenger_custody, '0', 'voiding clears custody after recording the refund liability');

  const fourth = await publish(4);
  await worker.provider.fastForward(300);
  await setOracleScenario('below');
  const unchallengedReceipt = await contract.callRaw(contract, 'request_settlement', {prediction_id: fourth.id}, {gas: 250n * 10n ** 12n});
  assert.equal(unchallengedReceipt.succeeded, true, unchallengedReceipt.summary());
  const unchallenged = await contract.view<{outcome: string; challenger_account_id: string | null; payment: unknown}>('get_prediction', {id: fourth.id});
  assert.equal(unchallenged.outcome, 'no');
  assert.equal(unchallenged.challenger_account_id, null);
  assert.equal(unchallenged.payment, null, 'unchallenged outcomes move no betting funds');
  const summary = await contract.view<{published: string; valid_outcomes: string; correct_outcomes: string}>('prediction_summary', {});
  assert.deepEqual(summary, {published: '4', valid_outcomes: '3', correct_outcomes: '2'}, 'valid unchallenged results count, while the void does not and a challenger win is a missed forecast');
  const records = await contract.view<Array<{id: string}>>('list_predictions', {start_id: '1', limit: '100'});
  assert.deepEqual(records.map(prediction => prediction.id), ['1', '2', '3', '4'], 'the bounded public history includes resolved, void, and unchallenged predictions');

  for (const [offset, scenario] of ['invalid', 'invalid_units', 'stale', 'wrong_asset', 'wrong_request_id'].entries()) {
    const prediction = await publish(offset + 5);
    await worker.provider.fastForward(300);
    await setOracleScenario(scenario);
    const invalidReceipt = await contract.callRaw(contract, 'request_settlement', {prediction_id: prediction.id}, {gas: 250n * 10n ** 12n});
    assert.equal(invalidReceipt.succeeded, false, `${scenario} oracle data cannot settle a prediction`);
    const invalidPending = await contract.view<{settlement_status: string; outcome: string | null}>('get_prediction', {id: prediction.id});
    assert.equal(invalidPending.settlement_status, 'observing');
    assert.equal(invalidPending.outcome, null);
    await worker.provider.fastForward(120);
    const safelyVoided = await contract.callRaw(contract, 'void_unsettled_prediction', {prediction_id: prediction.id}, {gas: 250n * 10n ** 12n});
    assert.equal(safelyVoided.succeeded, true, safelyVoided.summary());
    assert.equal((await contract.view<{outcome: string}>('get_prediction', {id: prediction.id})).outcome, 'void');
  }
  const finalSummary = await contract.view<{published: string; valid_outcomes: string; correct_outcomes: string}>('prediction_summary', {});
  assert.deepEqual(finalSummary, {published: '9', valid_outcomes: '3', correct_outcomes: '2'}, 'malformed, wrong-asset, stale, and stale-identity callbacks cannot enter accuracy');

  console.log(`COMPLETE_ROUND_MEASUREMENT ${JSON.stringify(roundMeasurement)}`);
  console.log('Oracle validation, request serialization, equality, payment receipts, void refunds, unchallenged results, and accuracy summary passed');
} finally {
  await worker.tearDown();
}
