import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {KeyPairEd25519, Worker, type TransactionResult} from 'near-workspaces';
import {functionCallAccessKey} from 'near-api-js/lib/transaction.js';
import {ReceiptProofRelay, sandboxReceiptGenesis} from '../receipt-proofs.js';

function changed<T>(value: T, path: string[], replacement: unknown): T {
  const clone = structuredClone(value);
  const parent = path.slice(0, -1).reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], clone);
  (parent as Record<string, unknown>)[path.at(-1)!] = replacement;
  return clone;
}

const GAS = 250n * 10n ** 12n;
const NEAR = 10n ** 24n;
const journalDirectory = await mkdtemp(join(tmpdir(), 'reckon-payment-journal-'));
const journalPath = join(journalDirectory, 'receipts.json');
const worker = await Worker.init();
try {
  const rpcUrl = (worker.provider as unknown as {connection: {url: string}}).connection.url;
  const genesisAnchor = await sandboxReceiptGenesis(rpcUrl);
  const key = KeyPairEd25519.fromRandom();
  const oracle = await worker.rootAccount.devDeploy('contract/target/wasm32-unknown-unknown/release/reckon_oracle_fixture.wasm', {
    initialBalance: 5n * 10n ** 24n, method: 'new', args: {owner_id: worker.rootAccount.accountId},
  });
  const contract = await worker.rootAccount.devDeploy('contract/target/wasm32-unknown-unknown/release/reckon_contract_callback_fault.wasm', {
    initialBalance: 120n * 10n ** 24n,
    method: 'new',
    args: {
      initial_bankroll: (100n * 10n ** 24n).toString(),
      operational_reserve: (20n * 10n ** 24n).toString(),
      idle_life_ns: '1500000000000',
      prediction_public_key: key.getPublicKey().toString(),
      oracle_account_id: oracle.accountId,
      receipt_genesis: genesisAnchor,
    },
  });
  const head =await contract.view<{hash: string; height: string; genesis_hash: string}>('receipt_verifier_head', {});
  assert.equal(head.hash, genesisAnchor.genesis_hash, 'receipt verification starts at the generated sandbox genesis');
  assert.equal(head.genesis_hash, genesisAnchor.genesis_hash, 'the immutable genesis choice remains publicly inspectable');
  assert.equal(head.height, '0', 'initialization must not trust a recent RPC checkpoint');
  async function network<T>(method: string, params: object): Promise<T> {
    const response = await fetch(rpcUrl, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({jsonrpc: '2.0', id: 'proof-test', method, params}),
    });
    const body = await response.json() as {result: T; error?: unknown};
    assert(response.ok && !body.error, JSON.stringify(body.error));
    return body.result;
  }
  const block = () => network<{header: {height: number; timestamp_nanosec: string}}>('block', {finality: 'optimistic'});
  async function advanceBlocks(count: number): Promise<void> {
    let current = await block();
    const target = current.header.height + count;
    for (let step = 0; current.header.height < target && step < 100; step++) {
      const beforeEpochBoundary = 500 - current.header.height % 500;
      if (beforeEpochBoundary <= 5) {
        // Let actual blocks carry validator approvals over the epoch boundary.
        await new Promise(resolve => setTimeout(resolve, 1200));
      } else {
        await network('sandbox_fast_forward', {delta_height: Math.min(50, beforeEpochBoundary - 5, target - current.header.height)});
      }
      current = await block();
    }
    assert(current.header.height >= target, 'sandbox must advance through the epoch boundary');
  }
  async function advanceSeconds(seconds: number): Promise<void> {
    const before = await block();
    const target = BigInt(before.header.timestamp_nanosec) + BigInt(seconds) * 1_000_000_000n;
    let current = before;
    for (let step = 0; BigInt(current.header.timestamp_nanosec) < target && step < 100; step++) {
      const elapsedNs = BigInt(current.header.timestamp_nanosec) - BigInt(before.header.timestamp_nanosec);
      const remainingNs = target - BigInt(current.header.timestamp_nanosec);
      const elapsedHeight = current.header.height - before.header.height;
      const estimate = elapsedNs > 0n && elapsedHeight > 0 ? Number((remainingNs * BigInt(elapsedHeight) + elapsedNs - 1n) / elapsedNs) : 10;
      await advanceBlocks(Math.max(1, Math.min(50, estimate)));
      current = await block();
    }
    assert(BigInt(current.header.timestamp_nanosec) >= target, 'sandbox must reach the requested chain time');
  }
  type Life = {spendable_bankroll: string; committed_bankroll: string; challenger_custody: string; retired_bankroll: string; operational_reserve: string; pending_payment_liabilities: string};
  // Compare the contract's recorded obligations with its actual account balance.
  // An unconfirmed transfer may already have delivered funds, so that amount is
  // still recorded as owed but no longer held. Gas and storage may only draw down
  // the operational reserve, never bankroll, custody, or a payment liability.
  async function assertConserved(label: string, deliveredUnconfirmed = 0n): Promise<void> {
    await advanceBlocks(5); // Let gas-refund and failed-transfer refund receipts land.
    const life = await contract.view<Life>('life', {});
    const balance = await contract.balance();
    const obligations = BigInt(life.spendable_bankroll) + BigInt(life.committed_bankroll) + BigInt(life.challenger_custody)
      + BigInt(life.retired_bankroll) + BigInt(life.pending_payment_liabilities);
    const heldFunds = BigInt(balance.total);
    const unrecorded = heldFunds - (obligations - deliveredUnconfirmed + BigInt(life.operational_reserve));
    assert(unrecorded <= 0n, `${label}: the account holds ${unrecorded} more than every recorded obligation and reserve, so an obligation was dropped from accounting`);
    // Available funds exclude the storage stake, so storage and gas must fit in the reserve.
    const shortfall = obligations - deliveredUnconfirmed - BigInt(balance.available);
    assert(shortfall <= 0n, `${label}: obligations exceed the account's available balance by ${shortfall}; measured storage and gas outgrew the reserve`);
  }
  const firstHeader = await network<Record<string, unknown>>('next_light_client_block', {last_block_hash: head.hash});
  assert(firstHeader, 'sandbox must supply a real finalized light-client header');
  for (const invalid of [
    changed(firstHeader, ['approvals_after_next'], [null]),
    changed(firstHeader, ['next_bps', '0', 'stake'], '1'),
    changed(firstHeader, ['inner_lite', 'epoch_id'], key.getPublicKey().toString().slice(8)),
  ]) {
    const rejected = await worker.rootAccount.callRaw(contract, 'update_receipt_verifier', {header: invalid}, {gas: GAS});
    assert.equal(rejected.succeeded, false, 'nonfinal headers and invalid validator changes must fail');
    assert.deepEqual(await contract.view('receipt_verifier_head', {}), head, 'invalid headers leave the trust root unchanged');
  }
  const foreign = await worker.rootAccount.devDeploy('contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm', {
    initialBalance: 120n * NEAR, method: 'new', args: {
      initial_bankroll: (100n * NEAR).toString(), operational_reserve: (20n * NEAR).toString(),
      idle_life_ns: '1200000000000', prediction_public_key: key.getPublicKey().toString(), oracle_account_id: oracle.accountId,
      receipt_genesis: {...genesisAnchor, genesis_hash: key.getPublicKey().toString().slice(8)},
    },
  });
  assert.equal((await worker.rootAccount.callRaw(foreign, 'update_receipt_verifier', {header: firstHeader}, {gas: GAS})).succeeded, false, 'a header from another genesis cannot advance the verifier');
  assert.equal((await foreign.callRaw(foreign, 'set_payment_callback_fault', {enabled: true})).succeeded, false, 'the production Wasm excludes the callback fault method');
  await contract.batch(contract).addKey(key.getPublicKey(), functionCallAccessKey(contract.accountId, ['publish_prediction'], 5n * 10n ** 24n)).transact();
  const prediction = await contract.call<{id: string; challenger_stake: string; agent_stake: string}>(contract, 'publish_prediction', {
    reference_multiplier: '340823333', reference_decimals: 8, decision: 'no', confidence_ppm: 850_000,
    evidence_hash: 'a'.repeat(64), evidence_url: 'https://evidence.reckon.invalid/callback-fault.json',
  }, {signWithKey: key});
  const beneficiary = await worker.rootAccount.createSubAccount('beneficiary', {initialBalance: 10n * 10n ** 24n});
  await beneficiary.call(contract, 'challenge_prediction', {prediction_id: prediction.id}, {attachedDeposit: BigInt(prediction.challenger_stake)});
  await worker.rootAccount.call(oracle, 'set_scenario', {scenario: 'above'});
  await contract.call(contract, 'set_payment_callback_fault', {enabled: true});
  await advanceSeconds(300);
  const before = BigInt((await beneficiary.balance()).total);
  let relay = await ReceiptProofRelay.open(rpcUrl, contract, journalPath);
  const staged = await relay.stage('request_settlement', {prediction_id: prediction.id});
  // Restart before broadcast, then race two recovery passes for identical bytes.
  relay = await ReceiptProofRelay.open(rpcUrl, contract, journalPath);
  await Promise.all([relay.recoverSubmitted(), relay.recoverSubmitted()]);
  await network('tx', {tx_hash: staged.hash, sender_account_id: staged.signerId, wait_until: 'INCLUDED'});
  relay = await ReceiptProofRelay.open(rpcUrl, contract, journalPath);
  await relay.recoverSubmitted();
  const includedJournal = JSON.parse(await readFile(journalPath, 'utf8')) as {submissions: Record<string, unknown>; attempts: Record<string, unknown>};
  assert(includedJournal.submissions[staged.hash] || includedJournal.attempts[prediction.id], 'an included parent must retain either its staged transaction or durably observed source receipts');
  const settlement = await network<TransactionResult['result']>('tx', {tx_hash: staged.hash, sender_account_id: staged.signerId, wait_until: 'EXECUTED_OPTIMISTIC'});
  assert(settlement.receipts_outcome.some((receipt: {outcome: {status: unknown}}) => receipt.outcome.status !== null && typeof receipt.outcome.status === 'object' && 'Failure' in receipt.outcome.status), 'the test-only callback fault must fail a real receipt');
  const pending = await contract.view<{outcome: string; payment: {amount: string; status: string; attempt_id: string; beneficiary_account_id: string; transfer_in_flight: boolean}}>('get_prediction', {id: prediction.id});
  assert.equal(pending.outcome, 'yes');
  assert.equal(pending.payment.status, 'pending', 'a missing callback must not falsely announce payment');
  assert.equal(pending.payment.transfer_in_flight, true);
  assert.equal(BigInt((await beneficiary.balance()).total) - before, BigInt(pending.payment.amount), 'the native transfer really executed despite the callback fault');
  // The transfer has executed, but its callback never confirmed it. Repeating the
  // public recovery call must not send a second payment, on either side of the
  // callback timeout (300 s of contract block time from the attempt). A timeout
  // alone never authorizes another transfer; only a proven failure does.
  async function assertRetryRefused(label: string): Promise<void> {
    const balanceBeforeRetry = BigInt((await beneficiary.balance()).total);
    const refused = await worker.rootAccount.callRaw(contract, 'retry_payment', {prediction_id: prediction.id}, {gas: GAS});
    assert.equal(refused.succeeded, false, `${label}: an unconfirmed transfer cannot be retried`);
    await advanceBlocks(5);
    assert.equal(BigInt((await beneficiary.balance()).total), balanceBeforeRetry, `${label}: no second transfer was sent`);
    assert.deepEqual(await contract.view('get_prediction', {id: prediction.id}), pending, `${label}: the recorded attempt is untouched`);
  }
  await assertRetryRefused('before the callback timeout');
  await advanceSeconds(301);
  await assertRetryRefused('after the callback timeout');
  await assertConserved('a delivered transfer with a lost callback', BigInt(pending.payment.amount));
  // Simulate termination after chain execution but before receipt observation.
  // The new relay has only the pre-broadcast journal, never this RPC response.
  relay = await ReceiptProofRelay.open(rpcUrl, contract, journalPath);
  await relay.recoverSubmitted();
  const proofs = await relay.proofs(prediction.id, pending.payment);
  for (const invalid of [
    changed(proofs, ['source_proof', 'outcome_proof', 'outcome', 'logs', '0'], 'RECKON_PAYMENT_ATTEMPT:{}'),
    changed(proofs, ['source_proof', 'outcome_proof', 'outcome', 'receipt_ids', '0'], '1'.repeat(32)),
    changed(proofs, ['transfer_proof', 'outcome_proof', 'outcome', 'executor_id'], worker.rootAccount.accountId),
    changed(proofs, ['transfer_proof', 'outcome_proof', 'outcome', 'status'], {Failure: {}}),
    changed(proofs, ['transfer_proof', 'outcome_proof', 'block_hash'], '1'.repeat(32)),
    changed(proofs, ['transfer_proof', 'block_header_lite', 'inner_lite', 'height'], 999_999),
  ]) {
    const rejected = await worker.rootAccount.callRaw(contract, 'reconcile_payment', {prediction_id: prediction.id, ...invalid}, {gas: GAS});
    assert.equal(rejected.succeeded, false, 'tampering cannot change a payment or its transfer result');
    assert.deepEqual(await contract.view('get_prediction', {id: prediction.id}), pending, 'invalid proofs preserve the liability and final outcome');
  }
  const contractBeforeReconciliation = BigInt((await contract.balance()).total);
  const reconciliation = await worker.rootAccount.callRaw(contract, 'reconcile_payment', {prediction_id: prediction.id, ...proofs}, {gas: 250n * 10n ** 12n});
  assert(reconciliation.succeeded, JSON.stringify(reconciliation.status));
  assert.equal(BigInt((await contract.balance()).total), contractBeforeReconciliation, 'reconciliation changes accounting without transferring more custody');
  const paid = await contract.view<typeof pending>('get_prediction', {id: prediction.id});
  assert.equal(paid.payment.status, 'paid', 'a verified receipt recovers the missing callback');
  assert.equal(paid.payment.transfer_in_flight, false);
  assert.equal(BigInt((await beneficiary.balance()).total) - before, BigInt(pending.payment.amount), 'proof reconciliation never sends a second payment');
  assert.equal((await contract.view<{pending_payment_liabilities: string}>('life', {})).pending_payment_liabilities, '0');
  await assertConserved('a payment confirmed by its receipt proof');
  assert.equal((await worker.rootAccount.callRaw(contract, 'reconcile_payment', {prediction_id: prediction.id, ...proofs}, {gas: GAS})).succeeded, false, 'a successful proof cannot be replayed');
  const publish = (hash: string) => contract.call<{id: string; challenger_stake: string}>(contract, 'publish_prediction', {
    reference_multiplier: '340823333', reference_decimals: 8, decision: 'no', confidence_ppm: 850_000,
    evidence_hash: hash.repeat(64), evidence_url: 'https://evidence.reckon.invalid/callback-fault.json',
  }, {signWithKey: key});
  const failedRound = await publish('b');
  await beneficiary.call(contract, 'challenge_prediction', {prediction_id: failedRound.id}, {attachedDeposit: BigInt(failedRound.challenger_stake)});
  const beneficiaryKey = await beneficiary.getKey();
  assert(beneficiaryKey);
  await beneficiary.delete(worker.rootAccount.accountId);
  await advanceSeconds(300);
  const failedTransfer = await contract.callRaw(contract, 'request_settlement', {prediction_id: failedRound.id}, {gas: GAS});
  await relay.observe(failedTransfer);
  const failedPending = await contract.view<typeof pending>('get_prediction', {id: failedRound.id});
  assert.equal(failedPending.payment.transfer_in_flight, true, 'both transfer and callback failures retain the unresolved attempt');
  const temporary = await worker.rootAccount.createAccount(beneficiary.accountId, {initialBalance: NEAR, keyPair: beneficiaryKey});
  const thirdRound = await publish('c');
  await temporary.call(contract, 'challenge_prediction', {prediction_id: thirdRound.id}, {attachedDeposit: BigInt(thirdRound.challenger_stake)});
  await temporary.delete(worker.rootAccount.accountId);
  await advanceSeconds(300);
  const thirdFailure = await contract.callRaw(contract, 'request_settlement', {prediction_id: thirdRound.id}, {gas: GAS});
  await relay.observe(thirdFailure);
  const thirdPending = await contract.view<typeof pending>('get_prediction', {id: thirdRound.id});
  await advanceSeconds(600);
  await worker.rootAccount.call(contract, 'accrue', {});
  assert.equal((await contract.view<{dead: boolean}>('life', {})).dead, true);
  const failedProofs = await relay.proofs(failedRound.id, failedPending.payment);
  const failedReconciliation = await worker.rootAccount.callRaw(contract, 'reconcile_payment', {prediction_id: failedRound.id, ...failedProofs}, {gas: GAS});
  assert(failedReconciliation.succeeded, JSON.stringify(failedReconciliation.status));
  const retryable = await contract.view<typeof pending>('get_prediction', {id: failedRound.id});
  assert.equal(retryable.payment.status, 'pending');
  assert.equal(retryable.payment.transfer_in_flight, false, 'a proven failure permits only this liability to be retried');
  assert.equal(retryable.payment.amount, failedPending.payment.amount);
  assert.equal(retryable.payment.beneficiary_account_id, failedPending.payment.beneficiary_account_id);
  assert.equal((await contract.view<{pending_payment_liabilities: string}>('life', {})).pending_payment_liabilities, (BigInt(failedPending.payment.amount) + BigInt(thirdPending.payment.amount)).toString());
  await assertConserved('failed transfers remain liabilities after death');
  const thirdFailureProofs = await relay.proofs(thirdRound.id, thirdPending.payment);
  assert.equal((await worker.rootAccount.callRaw(contract, 'reconcile_payment', {prediction_id: thirdRound.id, ...thirdFailureProofs}, {gas: GAS})).succeeded, true);
  const restored = await worker.rootAccount.createAccount(beneficiary.accountId, {initialBalance: NEAR, keyPair: beneficiaryKey});
  const restoredBefore = BigInt((await restored.balance()).total);
  const retry = await worker.rootAccount.batch(contract)
    .functionCall('retry_payment', {prediction_id: failedRound.id}, {gas: 120n * 10n ** 12n})
    .functionCall('retry_payment', {prediction_id: thirdRound.id}, {gas: 120n * 10n ** 12n})
    .transact();
  await relay.observe(retry);
  await assertConserved('retry attempts delivered but unconfirmed', BigInt(failedPending.payment.amount) + BigInt(thirdPending.payment.amount));
  const retried = await contract.view<typeof pending>('get_prediction', {id: failedRound.id});
  assert.notEqual(retried.payment.attempt_id, failedPending.payment.attempt_id);
  assert.equal((await worker.rootAccount.callRaw(contract, 'reconcile_payment', {prediction_id: failedRound.id, ...failedProofs}, {gas: GAS})).succeeded, false, 'a proof from an older attempt cannot clear its successor');
  const retryProofs = await relay.proofs(failedRound.id, retried.payment);
  const mismatchedTransfer = await worker.rootAccount.callRaw(contract, 'reconcile_payment', {prediction_id: thirdRound.id, ...retryProofs}, {gas: GAS});
  assert.equal(mismatchedTransfer.succeeded, false, 'two batched attempts to the same beneficiary cannot substitute another transfer receipt');
  const thirdRetried = await contract.view<typeof pending>('get_prediction', {id: thirdRound.id});
  const thirdRetryProofs = await relay.proofs(thirdRound.id, thirdRetried.payment);
  assert.equal((await worker.rootAccount.callRaw(contract, 'reconcile_payment', {prediction_id: thirdRound.id, ...thirdRetryProofs}, {gas: GAS})).succeeded, true, 'the second transfer in the batched source receipt remains provable');
  const otherRelayer = await worker.rootAccount.createSubAccount('relayer', {initialBalance: 2n * NEAR});
  const competing = await Promise.all([
    worker.rootAccount.callRaw(contract, 'reconcile_payment', {prediction_id: failedRound.id, ...retryProofs}, {gas: GAS}),
    otherRelayer.callRaw(contract, 'reconcile_payment', {prediction_id: failedRound.id, ...retryProofs}, {gas: GAS}),
  ]);
  assert.equal(competing.filter(result => result.succeeded).length, 1, 'only one of two independent relayers can resolve an attempt');
  assert.equal(BigInt((await restored.balance()).total) - restoredBefore, BigInt(failedPending.payment.amount) + BigInt(thirdPending.payment.amount), 'failed-transfer recovery after death pays the original beneficiary exactly once');
  assert.equal((await contract.view<typeof pending>('get_prediction', {id: failedRound.id})).payment.status, 'paid');
  assert.equal((await contract.view<{pending_payment_liabilities: string; dead: boolean}>('life', {})).pending_payment_liabilities, '0');
  await assertConserved('every liability confirmed after death');
  assert.equal((await contract.view<{dead: boolean}>('life', {})).dead, true, 'recovery cannot revive Reckon');
  assert(BigInt((await contract.view<{height: string}>('receipt_verifier_head', {})).height) > 500n, 'the verifier advances through a real sandbox epoch transition');
  const newValidatorStake = BigInt(genesisAnchor.validators[0].stake) - NEAR;
  await worker.rootAccount.batch(worker.rootAccount).stake(newValidatorStake, genesisAnchor.validators[0].public_key).transact();
  let observedValidatorChange = false;
  let headerGas = 0n;
  for (let epoch = 0; epoch < 4 && !observedValidatorChange; epoch++) {
    await advanceBlocks(500);
    await new Promise(resolve => setTimeout(resolve, 2100));
    for (let update = 0; update < 4; update++) {
      const verified = await contract.view<{hash: string; height: string}>('receipt_verifier_head', {});
      const header = await network<{inner_lite: {height: number}; next_bps: {stake: string}[] | null} | null>('next_light_client_block', {last_block_hash: verified.hash});
      if (!header || BigInt(header.inner_lite.height) <= BigInt(verified.height)) break;
      const result = await worker.rootAccount.callRaw(contract, 'update_receipt_verifier', {header}, {gas: GAS});
      assert(result.succeeded, 'real validator-set changes must remain verifiable from genesis');
      headerGas += BigInt(result.gas_burnt);
      if (header.next_bps?.some(validator => validator.stake === newValidatorStake.toString())) observedValidatorChange = true;
    }
  }
  assert(observedValidatorChange, 'the sandbox must apply and the verifier must authenticate a real changed validator stake');
  const historicalProofs = await relay.proofs(prediction.id, pending.payment);
  assert.equal(historicalProofs.source_proof.outcome_proof.id, proofs.source_proof.outcome_proof.id, 'the archive retains historical transfer evidence after validator changes');
  console.log(`PAYMENT_PROOF_MEASUREMENT ${JSON.stringify({
    environment: 'NEAR sandbox 2.14.0, generated genesis, real native transfers',
    successful_reconciliation_gas: reconciliation.gas_burnt,
    validator_update_gas: headerGas.toString(),
    validator_change_verified: observedValidatorChange,
    failed_reconciliation_gas: failedReconciliation.gas_burnt,
    storage_usage_bytes: (await contract.accountView()).storage_usage,
    beneficiary_paid_once: true,
  })}`);
  console.log('Real callback faults, finalized proof recovery, adversarial rejection, replay prevention, concurrent relayers, and historical recovery after death passed');
} finally {
  await worker.tearDown();
  await rm(journalDirectory, {recursive: true, force: true});
}
