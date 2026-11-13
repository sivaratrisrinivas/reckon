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
    settlement_request_id: string;
    settlement_requested_at_ns: string;
    settlement_price: {multiplier: string; decimals: number; response_timestamp_ns: string; provider_recency_seconds: number};
    payment: unknown;
  }>('get_prediction', {id: first.id});
  assert.equal(equal.outcome, 'no', 'equality resolves to no');
  assert.equal(equal.settlement_status, 'resolved');
  assert.deepEqual(equal.settlement_price, {multiplier: '340823333', decimals: 8, response_timestamp_ns: equal.settlement_price.response_timestamp_ns, provider_recency_seconds: 300});
  assert.equal(equal.payment, null, 'the agent win requires no outgoing payment');
  assert.equal(await contract.view('active_prediction'), null, 'a settled prediction releases the active slot');
  const afterEqual = await contract.view<{spendable_bankroll: string; committed_bankroll: string; challenger_custody: string}>('life', {});
  assert(BigInt(afterEqual.spendable_bankroll) > 100n * NEAR, 'an alive agent receives its committed stake and the losing challenger stake');
  assert.equal(afterEqual.committed_bankroll, '0');
  assert.equal(afterEqual.challenger_custody, '0');
  const duplicateCallback = await oracle.callRaw(contract, 'oracle_on_call', {
    sender_id: contract.accountId,
    data: {
      timestamp: equal.settlement_requested_at_ns,
      recency_duration_sec: 300,
      prices: [{asset_id: 'wrap.near', price: {multiplier: '340823333', decimals: 8}}],
    },
    msg: equal.settlement_request_id,
  }, {gas: 250n * 10n ** 12n});
  assert.equal(duplicateCallback.succeeded, false, 'a duplicate callback cannot change or pay a resolved round again');
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
  const pending = await contract.view<{
    settlement_status: string;
    settlement_request_id: string | null;
    settlement_requested_at_ns: string | null;
  }>('get_prediction', {id: third.id});
  assert.equal(pending.settlement_status, 'observing');
  assert(pending.settlement_request_id, 'the request identity is recorded while observation is pending');
  const wrongReceiverCallback = await oracle.callRaw(contract, 'oracle_on_call', {
    sender_id: root.accountId,
    data: {
      timestamp: pending.settlement_requested_at_ns,
      recency_duration_sec: 300,
      prices: [{asset_id: 'wrap.near', price: {multiplier: '340823334', decimals: 8}}],
    },
    msg: pending.settlement_request_id,
  }, {gas: 250n * 10n ** 12n});
  assert.equal(wrongReceiverCallback.succeeded, false, 'a configured provider cannot callback for a different receiver');
  await assert.rejects(contract.call(contract, 'request_settlement', {prediction_id: third.id}), 'a stalled request cannot race another observation');
  await assert.rejects(contract.call(contract, 'void_unsettled_prediction', {prediction_id: third.id}), 'a stalled request cannot be voided before the measured window closes');
  await worker.provider.fastForward(120);
  const lateCallback = await oracle.callRaw(contract, 'oracle_on_call', {
    sender_id: contract.accountId,
    data: {
      timestamp: pending.settlement_requested_at_ns,
      recency_duration_sec: 300,
      prices: [{asset_id: 'wrap.near', price: {multiplier: '340823334', decimals: 8}}],
    },
    msg: pending.settlement_request_id,
  }, {gas: 250n * 10n ** 12n});
  assert.equal(lateCallback.succeeded, false, 'a callback received after the cutoff cannot beat a safe void');
  const refundReceipt = await contract.callRaw(contract, 'void_unsettled_prediction', {prediction_id: third.id}, {gas: 250n * 10n ** 12n});
  assert.equal(refundReceipt.succeeded, true, refundReceipt.summary());
  const voided = await contract.view<{outcome: string; payment: {status: string; amount: string} | null}>('get_prediction', {id: third.id});
  assert.equal(voided.outcome, 'void');
  assert.equal(voided.payment?.status, 'paid', 'void refunds the challenger through a confirmed transfer receipt');
  assert.equal(voided.payment?.amount, third.challenger_stake);
  const duplicateVoidedCallback = await oracle.callRaw(contract, 'oracle_on_call', {
    sender_id: contract.accountId,
    data: {
      timestamp: pending.settlement_requested_at_ns,
      recency_duration_sec: 300,
      prices: [{asset_id: 'wrap.near', price: {multiplier: '340823334', decimals: 8}}],
    },
    msg: pending.settlement_request_id,
  }, {gas: 250n * 10n ** 12n});
  assert.equal(duplicateVoidedCallback.succeeded, false, 'a late callback cannot resurrect a voided prediction');
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

  const recoveryKey = KeyPairEd25519.fromRandom();
  const recoveryContract = await root.devDeploy('contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm', {
    initialBalance: 120n * NEAR,
    method: 'new',
    args: {
      initial_bankroll: (100n * NEAR).toString(),
      operational_reserve: (20n * NEAR).toString(),
      idle_life_ns: '604800000000000',
      prediction_public_key: recoveryKey.getPublicKey().toString(),
      oracle_account_id: oracle.accountId,
    },
  });
  await recoveryContract.batch(recoveryContract).addKey(
    recoveryKey.getPublicKey(),
    functionCallAccessKey(recoveryContract.accountId, ['publish_prediction'], 5n * NEAR),
  ).transact();
  const recoveryPrediction = await recoveryContract.call<{id: string; agent_stake: string; challenger_stake: string}>(
    recoveryContract,
    'publish_prediction',
    {
      reference_multiplier: '340823333',
      reference_decimals: 8,
      decision: 'no',
      confidence_ppm: 850_000,
      evidence_hash: '000000000000000000000000000000000000000000000000000000000000000b',
      evidence_url: 'https://evidence.reckon.invalid/payment-recovery.json',
    },
    {signWithKey: recoveryKey},
  );
  const recoveryChallenger = await root.createSubAccount('recovery-challenger', {initialBalance: 10n * NEAR});
  await recoveryChallenger.call(recoveryContract, 'challenge_prediction', {prediction_id: recoveryPrediction.id}, {
    attachedDeposit: BigInt(recoveryPrediction.challenger_stake),
  });
  const failedBeneficiaryId = recoveryChallenger.accountId;
  const deleteBeneficiary = await recoveryChallenger.delete(root.accountId);
  assert.equal(deleteBeneficiary.succeeded, true, 'the failure fixture removes the payout account before settlement');
  await worker.provider.fastForward(300);
  await setOracleScenario('above');
  const failedSettlement = await recoveryContract.callRaw(
    recoveryContract,
    'request_settlement',
    {prediction_id: recoveryPrediction.id},
    {gas: 250n * 10n ** 12n},
  );
  assert(failedSettlement.receipts_outcomes.length > 0, 'a transfer failure still completes the settlement callback path');
  const failedPayment = await recoveryContract.view<{
    outcome: string;
    payment: {payment_id: string; attempt_id: string; beneficiary_account_id: string; amount: string; status: string; transfer_in_flight: boolean};
  }>('get_prediction', {id: recoveryPrediction.id});
  assert.equal(failedPayment.outcome, 'yes');
  assert.equal(failedPayment.payment.beneficiary_account_id, failedBeneficiaryId, 'the failed liability keeps its original beneficiary');
  assert.equal(failedPayment.payment.status, 'pending');
  assert.equal(failedPayment.payment.transfer_in_flight, false);
  const failedLife = await recoveryContract.view<{pending_payment_liabilities: string; challenger_custody: string}>('life');
  assert.equal(failedLife.pending_payment_liabilities, (BigInt(recoveryPrediction.challenger_stake) + BigInt(recoveryPrediction.agent_stake)).toString(), 'pending payout remains in conservation accounting');
  const firstPaymentAttempt = failedPayment.payment.attempt_id;
  const retryReceipt = await root.callRaw(recoveryContract, 'retry_payment', {prediction_id: recoveryPrediction.id}, {gas: 250n * 10n ** 12n});
  assert(retryReceipt.receipts_outcomes.length > 0, 'retrying while the beneficiary is absent remains pending rather than changing the obligation');
  const retriedPayment = await recoveryContract.view<typeof failedPayment>('get_prediction', {id: recoveryPrediction.id});
  assert.notEqual(retriedPayment.payment.attempt_id, firstPaymentAttempt, 'each retry receives a unique attempt identity');
  assert.equal(retriedPayment.payment.status, 'pending');
  const staleCallback = await recoveryContract.callRaw(recoveryContract, 'on_payment_complete', {
    prediction_id: recoveryPrediction.id,
    callback_payment_id: failedPayment.payment.payment_id,
    callback_attempt_id: firstPaymentAttempt,
  });
  assert.equal(staleCallback.succeeded, false, 'a stale callback cannot complete a later payment attempt');
  const restoredBeneficiary = await root.createAccount(failedBeneficiaryId, {initialBalance: NEAR, keyPair: recoveryKey});
  assert.equal(await restoredBeneficiary.exists(), true);
  const beneficiaryBeforeConcurrentRecovery = BigInt((await restoredBeneficiary.balance()).total);
  const contractBeforeConcurrentRecovery = BigInt((await recoveryContract.balance()).total);
  const storageBeforeConcurrentRecovery = BigInt((await recoveryContract.accountView()).storage_usage);
  const concurrentRecovery = await Promise.all([
    root.callRaw(recoveryContract, 'retry_payment', {prediction_id: recoveryPrediction.id}, {gas: 250n * 10n ** 12n}),
    root.callRaw(recoveryContract, 'retry_payment', {prediction_id: recoveryPrediction.id}, {gas: 250n * 10n ** 12n}),
  ]);
  assert.equal(concurrentRecovery.filter(receipt => receipt.succeeded).length, 1, 'concurrent retries accept at most one transfer attempt');
  assert(concurrentRecovery.every(receipt => receipt.receipts_outcomes.length > 0), 'concurrent retry calls produce inspectable receipts and gas outcomes');
  const paidRecovery = await recoveryContract.view<typeof failedPayment>('get_prediction', {id: recoveryPrediction.id});
  assert.equal(paidRecovery.outcome, 'yes', 'recovery does not change the final outcome');
  assert.equal(paidRecovery.payment.status, 'paid');
  assert.equal(paidRecovery.payment.beneficiary_account_id, failedBeneficiaryId);
  const paidLife = await recoveryContract.view<{pending_payment_liabilities: string; challenger_custody: string}>('life');
  assert.equal(paidLife.pending_payment_liabilities, '0', 'confirmed payment releases the recorded liability');
  assert.equal(paidLife.challenger_custody, '0');
  const beneficiaryAfterConcurrentRecovery = BigInt((await restoredBeneficiary.balance()).total);
  const contractAfterConcurrentRecovery = BigInt((await recoveryContract.balance()).total);
  const storageAfterConcurrentRecovery = BigInt((await recoveryContract.accountView()).storage_usage);
  assert(beneficiaryAfterConcurrentRecovery - beneficiaryBeforeConcurrentRecovery >= BigInt(paidRecovery.payment.amount), 'one accepted retry credits the fixed beneficiary by the fixed liability');
  assert(contractBeforeConcurrentRecovery - contractAfterConcurrentRecovery >= BigInt(paidRecovery.payment.amount), 'one accepted retry removes only the fixed liability from contract balance');
  assert(storageAfterConcurrentRecovery >= storageBeforeConcurrentRecovery, 'retry bookkeeping does not redirect or erase the recorded liability');
  const repeatedPaidRetry = await root.callRaw(recoveryContract, 'retry_payment', {prediction_id: recoveryPrediction.id}, {gas: 250n * 10n ** 12n});
  assert.equal(repeatedPaidRetry.succeeded, false, 'repeating a confirmed retry cannot create a second payout');

  const deadKey = KeyPairEd25519.fromRandom();
  const deadContract = await root.devDeploy('contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm', {
    initialBalance: 120n * NEAR,
    method: 'new',
    args: {
      initial_bankroll: (100n * NEAR).toString(),
      operational_reserve: (20n * NEAR).toString(),
      idle_life_ns: '120000000000',
      prediction_public_key: deadKey.getPublicKey().toString(),
      oracle_account_id: oracle.accountId,
    },
  });
  await deadContract.batch(deadContract).addKey(
    deadKey.getPublicKey(),
    functionCallAccessKey(deadContract.accountId, ['publish_prediction'], 5n * NEAR),
  ).transact();
  const deadPrediction = await deadContract.call<{id: string; agent_stake: string; challenger_stake: string}>(
    deadContract,
    'publish_prediction',
    {
      reference_multiplier: '340823333',
      reference_decimals: 8,
      decision: 'no',
      confidence_ppm: 850_000,
      evidence_hash: '000000000000000000000000000000000000000000000000000000000000000a',
      evidence_url: 'https://evidence.reckon.invalid/dead-agent.json',
    },
    {signWithKey: deadKey},
  );
  const deadChallenger = await root.createSubAccount('dead-agent-challenger', {initialBalance: 10n * NEAR});
  await deadChallenger.call(deadContract, 'challenge_prediction', {prediction_id: deadPrediction.id}, {attachedDeposit: BigInt(deadPrediction.challenger_stake)});
  const retiredBeforeDeath = BigInt((await deadContract.view<{retired_bankroll: string}>('life', {})).retired_bankroll);
  const projectedBeforeDeath = await deadContract.view<{
    dead: boolean;
    death_at_ns: string;
    remaining_life_ns: string;
  }>('life', {});
  assert.equal(projectedBeforeDeath.dead, false);
  assert.equal(projectedBeforeDeath.death_at_ns, '0', 'a living agent has no death date');
  await worker.provider.fastForward(300);
  const projectedDeadBeforeOutcome = await deadContract.view<{
    dead: boolean;
    death_at_ns: string;
    committed_bankroll: string;
    challenger_custody: string;
  }>('life', {});
  assert.equal(projectedDeadBeforeOutcome.dead, true, 'life projects depletion before the keeper settles the open round');
  assert(BigInt(projectedDeadBeforeOutcome.death_at_ns) > 0n);
  assert(BigInt(projectedDeadBeforeOutcome.death_at_ns) < BigInt((await deadContract.view<{deadline_ns: string}>('get_prediction', {id: deadPrediction.id})).deadline_ns));
  await assert.rejects(deadContract.call(deadContract, 'publish_prediction', {
    reference_multiplier: '340823333',
    reference_decimals: 8,
    decision: 'no',
    confidence_ppm: 850_000,
    evidence_hash: '000000000000000000000000000000000000000000000000000000000000000c',
    evidence_url: 'https://evidence.reckon.invalid/dead-agent-republish.json',
  }, {signWithKey: deadKey}), 'a rejected post-death publication cannot revive the account');
  await deadContract.call(deadContract, 'accrue', {});
  const persistedDeadBeforeOutcome = await deadContract.view<{dead: boolean; death_at_ns: string}>('life', {});
  assert.equal(persistedDeadBeforeOutcome.dead, true);
  assert.equal(persistedDeadBeforeOutcome.death_at_ns, projectedDeadBeforeOutcome.death_at_ns, 'accrual persists the exact projected death instant');
  await setOracleScenario('equal');
  const deadRoundReceipt = await deadContract.callRaw(deadContract, 'request_settlement', {prediction_id: deadPrediction.id}, {gas: 250n * 10n ** 12n});
  assert.equal(deadRoundReceipt.succeeded, true, deadRoundReceipt.summary());
  const afterDeadWin = await deadContract.view<{
    dead: boolean;
    retired_bankroll: string;
    spendable_bankroll: string;
    committed_bankroll: string;
    challenger_custody: string;
    death_at_ns: string;
  }>('life', {});
  assert.equal(afterDeadWin.dead, true, 'the short-lived agent dies before the valid result is applied');
  assert(BigInt(afterDeadWin.death_at_ns) > 0n, 'death records the exact projected depletion timestamp');
  assert(BigInt(afterDeadWin.death_at_ns) < BigInt((await deadContract.view<{settled_at_ns: string}>('get_prediction', {id: deadPrediction.id})).settled_at_ns));
  assert(
    BigInt(afterDeadWin.retired_bankroll) - retiredBeforeDeath >= BigInt(deadPrediction.agent_stake) + BigInt(deadPrediction.challenger_stake),
    'a correct forecast cannot revive a dead agent; both stakes are retired',
  );
  assert.equal(afterDeadWin.spendable_bankroll, '0');
  assert.equal(afterDeadWin.committed_bankroll, '0');
  assert.equal(afterDeadWin.challenger_custody, '0');
  await root.transfer(deadContract, NEAR);
  const afterDeadTransfer = await deadContract.view<{dead: boolean; spendable_bankroll: string; retired_bankroll: string}>('life', {});
  assert.equal(afterDeadTransfer.dead, true, 'plain transfers cannot revive a dead agent');
  assert.equal(afterDeadTransfer.spendable_bankroll, '0', 'incoming funds never become a usable bankroll after death');
  assert.equal(afterDeadTransfer.retired_bankroll, afterDeadWin.retired_bankroll, 'incoming funds cannot be counted as retired or usable stake');
  await assert.rejects(deadContract.call(deadContract, 'publish_prediction', {
    reference_multiplier: '340823333',
    reference_decimals: 8,
    decision: 'no',
    confidence_ppm: 850_000,
    evidence_hash: '000000000000000000000000000000000000000000000000000000000000000d',
    evidence_url: 'https://evidence.reckon.invalid/dead-agent-after-transfer.json',
  }, {signWithKey: deadKey}), 'a late transfer cannot enable new publication');

  const deployShortLivedContract = async (key: KeyPairEd25519) => {
    const deployed = await root.devDeploy('contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm', {
      initialBalance: 120n * NEAR,
      method: 'new',
      args: {
        initial_bankroll: (100n * NEAR).toString(),
        operational_reserve: (20n * NEAR).toString(),
        idle_life_ns: '120000000000',
        prediction_public_key: key.getPublicKey().toString(),
        oracle_account_id: oracle.accountId,
      },
    });
    await deployed.batch(deployed).addKey(
      key.getPublicKey(),
      functionCallAccessKey(deployed.accountId, ['publish_prediction'], 5n * NEAR),
    ).transact();
    return deployed;
  };

  const deadPayoutKey = KeyPairEd25519.fromRandom();
  const deadPayoutContract = await deployShortLivedContract(deadPayoutKey);
  const deadPayoutPrediction = await deadPayoutContract.call<{id: string; agent_stake: string; challenger_stake: string}>(
    deadPayoutContract,
    'publish_prediction',
    {
      reference_multiplier: '340823333',
      reference_decimals: 8,
      decision: 'no',
      confidence_ppm: 850_000,
      evidence_hash: '000000000000000000000000000000000000000000000000000000000000000e',
      evidence_url: 'https://evidence.reckon.invalid/dead-payout.json',
    },
    {signWithKey: deadPayoutKey},
  );
  const deadPayoutChallenger = await root.createSubAccount('dead-payout-challenger', {initialBalance: 10n * NEAR});
  await deadPayoutChallenger.call(deadPayoutContract, 'challenge_prediction', {prediction_id: deadPayoutPrediction.id}, {
    attachedDeposit: BigInt(deadPayoutPrediction.challenger_stake),
  });
  const deadPayoutBeneficiary = deadPayoutChallenger.accountId;
  assert.equal((await deadPayoutChallenger.delete(root.accountId)).succeeded, true);
  await worker.provider.fastForward(300);
  await setOracleScenario('above');
  const deadPayoutReceipt = await deadPayoutContract.callRaw(deadPayoutContract, 'request_settlement', {prediction_id: deadPayoutPrediction.id}, {gas: 250n * 10n ** 12n});
  assert.equal(deadPayoutReceipt.succeeded, true, deadPayoutReceipt.summary());
  const deadPayout = await deadPayoutContract.view<{
    outcome: string;
    payment: {beneficiary_account_id: string; amount: string; status: string};
  }>('get_prediction', {id: deadPayoutPrediction.id});
  assert.equal(deadPayout.outcome, 'yes');
  assert.equal(deadPayout.payment.beneficiary_account_id, deadPayoutBeneficiary);
  assert.equal(deadPayout.payment.status, 'pending', 'a failed winner payout remains owed after death');
  const deadPayoutLife = await deadPayoutContract.view<{dead: boolean; pending_payment_liabilities: string; spendable_bankroll: string}>('life', {});
  assert.equal(deadPayoutLife.dead, true);
  assert.equal(deadPayoutLife.spendable_bankroll, '0');
  assert.equal(deadPayoutLife.pending_payment_liabilities, deadPayout.payment.amount);
  await root.createAccount(deadPayoutBeneficiary, {initialBalance: NEAR, keyPair: KeyPairEd25519.fromRandom()});
  const deadPayoutRetry = await root.callRaw(deadPayoutContract, 'retry_payment', {prediction_id: deadPayoutPrediction.id}, {gas: 250n * 10n ** 12n});
  assert.equal(deadPayoutRetry.succeeded, true, deadPayoutRetry.summary());
  const recoveredDeadPayout = await deadPayoutContract.view<typeof deadPayout>('get_prediction', {id: deadPayoutPrediction.id});
  assert.equal(recoveredDeadPayout.payment.status, 'paid', 'recovery pays the original winner after death');
  assert.equal((await deadPayoutContract.view<{dead: boolean}>('life', {})).dead, true, 'payout recovery cannot revive the agent');

  const deadRefundKey = KeyPairEd25519.fromRandom();
  const deadRefundContract = await deployShortLivedContract(deadRefundKey);
  const deadRefundPrediction = await deadRefundContract.call<{id: string; agent_stake: string; challenger_stake: string}>(
    deadRefundContract,
    'publish_prediction',
    {
      reference_multiplier: '340823333',
      reference_decimals: 8,
      decision: 'yes',
      confidence_ppm: 850_000,
      evidence_hash: '000000000000000000000000000000000000000000000000000000000000000f',
      evidence_url: 'https://evidence.reckon.invalid/dead-refund.json',
    },
    {signWithKey: deadRefundKey},
  );
  const deadRefundChallenger = await root.createSubAccount('dead-refund-challenger', {initialBalance: 10n * NEAR});
  await deadRefundChallenger.call(deadRefundContract, 'challenge_prediction', {prediction_id: deadRefundPrediction.id}, {
    attachedDeposit: BigInt(deadRefundPrediction.challenger_stake),
  });
  const deadRefundBeneficiary = deadRefundChallenger.accountId;
  assert.equal((await deadRefundChallenger.delete(root.accountId)).succeeded, true);
  await worker.provider.fastForward(420);
  const deadRefundReceipt = await deadRefundContract.callRaw(deadRefundContract, 'void_unsettled_prediction', {prediction_id: deadRefundPrediction.id}, {gas: 250n * 10n ** 12n});
  assert.equal(deadRefundReceipt.succeeded, true, deadRefundReceipt.summary());
  const deadRefund = await deadRefundContract.view<{
    outcome: string;
    payment: {beneficiary_account_id: string; amount: string; status: string};
  }>('get_prediction', {id: deadRefundPrediction.id});
  assert.equal(deadRefund.outcome, 'void');
  assert.equal(deadRefund.payment.beneficiary_account_id, deadRefundBeneficiary);
  assert.equal(deadRefund.payment.amount, deadRefundPrediction.challenger_stake);
  assert.equal(deadRefund.payment.status, 'pending', 'a failed refund remains owed after death');
  const deadRefundLife = await deadRefundContract.view<{
    dead: boolean;
    pending_payment_liabilities: string;
    committed_bankroll: string;
    challenger_custody: string;
    spendable_bankroll: string;
  }>('life', {});
  assert.equal(deadRefundLife.dead, true);
  assert.equal(deadRefundLife.pending_payment_liabilities, deadRefundPrediction.challenger_stake);
  assert.equal(deadRefundLife.committed_bankroll, '0', 'death releases the commitment without restoring spendable bankroll');
  assert.equal(deadRefundLife.challenger_custody, '0');
  assert.equal(deadRefundLife.spendable_bankroll, '0');
  await root.createAccount(deadRefundBeneficiary, {initialBalance: NEAR, keyPair: KeyPairEd25519.fromRandom()});
  const deadRefundRetry = await root.callRaw(deadRefundContract, 'retry_payment', {prediction_id: deadRefundPrediction.id}, {gas: 250n * 10n ** 12n});
  assert.equal(deadRefundRetry.succeeded, true, deadRefundRetry.summary());
  const recoveredDeadRefund = await deadRefundContract.view<typeof deadRefund>('get_prediction', {id: deadRefundPrediction.id});
  assert.equal(recoveredDeadRefund.payment.status, 'paid', 'recovery refunds the original challenger after death');
  assert.equal((await deadRefundContract.view<{dead: boolean}>('life', {})).dead, true, 'refund recovery cannot revive the agent');
  const lateDeadTaker = await root.createSubAccount('late-dead-taker', {initialBalance: 10n * NEAR});
  const deadContractBalance = BigInt((await deadRefundContract.balance()).total);
  await assert.rejects(lateDeadTaker.call(deadRefundContract, 'challenge_prediction', {prediction_id: deadRefundPrediction.id}, {
    attachedDeposit: BigInt(deadRefundPrediction.challenger_stake),
  }));
  assert.equal(BigInt((await deadRefundContract.balance()).total), deadContractBalance, 'a late challenger cannot add a stake to the dead agent');

  console.log(`COMPLETE_ROUND_MEASUREMENT ${JSON.stringify(roundMeasurement)}`);
  console.log('Oracle validation, request serialization, equality, payment receipts, void refunds, unchallenged results, and accuracy summary passed');
} finally {
  await worker.tearDown();
}
