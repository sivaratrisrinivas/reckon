import assert from 'node:assert/strict';
import {KeyPairEd25519, Worker, type NearAccount} from 'near-workspaces';
import {
  addKey, deleteAccount, deleteKey, deployContract, fullAccessKey, functionCall, functionCallAccessKey, stake, transfer, type Action,
} from 'near-api-js/lib/transaction.js';
import {auditAccessKeys} from '../rehearsal-audit.js';
import {
  accessKeyList, keyAllowance, NEAR, predictionArgs, sandboxUrl, signAndSend, succeeded, TGAS, type RpcFailure, type SandboxLife, type SignedOutcome,
} from './rehearsal-support.js';

// RECKON_PERMISSIONS_WASM lets scripts/rehearsal/mutation-check.sh run this file against a mutant build.
const PRODUCTION_WASM = process.env.RECKON_PERMISSIONS_WASM ?? 'contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm';
const PUBLISH_GAS = 250n * TGAS;
const worker = await Worker.init();

/** The protocol's reason for rejecting a transaction before any receipt exists, e.g. InvalidAccessKeyError.MethodNameMismatch. */
function rejection(outcome: SignedOutcome): string | null {
  if (outcome.accepted) return null;
  const tx = (outcome.error.data as {TxExecutionError?: {InvalidTxError?: Record<string, Record<string, unknown> | string>}} | undefined)?.TxExecutionError?.InvalidTxError;
  if (!tx) return `unclassified: ${JSON.stringify(outcome.error)}`;
  const [group, detail] = Object.entries(tx)[0];
  return typeof detail === 'string' ? `${group}.${detail}` : `${group}.${Object.keys(detail)[0]}`;
}
function notEnoughAllowance(outcome: SignedOutcome): {allowance: bigint; cost: bigint} {
  assert.equal(rejection(outcome), 'InvalidAccessKeyError.NotEnoughAllowance');
  const failure = outcome as {accepted: false; error: RpcFailure};
  const detail = (failure.error.data as {TxExecutionError: {InvalidTxError: {InvalidAccessKeyError: {NotEnoughAllowance: {allowance: string; cost: string}}}}}).TxExecutionError.InvalidTxError.InvalidAccessKeyError.NotEnoughAllowance;
  return {allowance: BigInt(detail.allowance), cost: BigInt(detail.cost)};
}
const executionFailure = (outcome: SignedOutcome) => outcome.accepted && typeof outcome.result.status === 'object' && outcome.result.status !== null && 'Failure' in outcome.result.status;
const burntTokens = (outcome: SignedOutcome) => outcome.accepted
  ? BigInt(outcome.result.transaction_outcome.outcome.tokens_burnt) + outcome.result.receipts_outcome.reduce((sum, receipt) => sum + BigInt(receipt.outcome.tokens_burnt), 0n)
  : 0n;

try {
  const url = sandboxUrl(worker);
  const root = worker.rootAccount;
  const oracle = await root.devDeploy('contract/target/wasm32-unknown-unknown/release/reckon_oracle_fixture.wasm', {
    initialBalance: 5n * NEAR, method: 'new', args: {owner_id: root.accountId},
  });
  const keeper = await root.createSubAccount('keeper', {initialBalance: 20n * NEAR});

  async function deployAgent(allowance: bigint, idleLifeNs = '604800000000000') {
    const predictionKey = KeyPairEd25519.fromRandom();
    const contract = await root.devDeploy(PRODUCTION_WASM, {
      initialBalance: 120n * NEAR,
      method: 'new',
      args: {
        initial_bankroll: (100n * NEAR).toString(), operational_reserve: (20n * NEAR).toString(), idle_life_ns: idleLifeNs,
        prediction_public_key: predictionKey.getPublicKey().toString(), oracle_account_id: oracle.accountId,
      },
    });
    const ownerKey = await contract.getKey();
    assert(ownerKey, 'devDeploy gives the account one full-access key');
    await contract.batch(contract).addKey(predictionKey.getPublicKey(), functionCallAccessKey(contract.accountId, ['publish_prediction'], allowance)).transact();
    return {contract, predictionKey, ownerKey: ownerKey as KeyPairEd25519};
  }
  const life = (contract: NearAccount) => contract.view<SandboxLife>('life', {});
  const publishVia = (contract: NearAccount, key: KeyPairEd25519, id: number, decision: 'yes' | 'no' = 'no') => signAndSend(
    url, contract.accountId, key, contract.accountId, [functionCall('publish_prediction', predictionArgs(id, decision), PUBLISH_GAS, 0n)],
  );
  const published = (outcome: SignedOutcome) => {
    assert(succeeded(outcome), `publication must succeed: ${JSON.stringify(outcome)}`);
    const status = (outcome as Extract<SignedOutcome, {accepted: true}>).result.status as {SuccessValue: string};
    return JSON.parse(Buffer.from(status.SuccessValue, 'base64').toString()) as {id: string; challenger_stake: string; agent_stake: string};
  };

  // Every action a stolen or misused publication key could attempt. A restricted key must have none of them accepted.
  const FORBIDDEN_ATTEMPTS = (contract: NearAccount, key: KeyPairEd25519): {name: string; receiver: string; actions: Action[]; destructive?: boolean}[] => {
    const self = contract.accountId;
    const call = (method: string, args: object = {}, deposit = 0n) => [functionCall(method, args, 30n * TGAS, deposit)];
    return [
      {name: 'transfer to the agent itself', receiver: self, actions: [transfer(1n)]},
      {name: 'transfer to another account', receiver: root.accountId, actions: [transfer(1n)]},
      {name: 'publish_prediction with an attached deposit', receiver: self, actions: call('publish_prediction', predictionArgs(900), 1n)},
      {name: 'publish_prediction batched with a transfer', receiver: self, actions: [functionCall('publish_prediction', predictionArgs(901), 30n * TGAS, 0n), transfer(1n)]},
      {name: 'publish_prediction addressed to another contract', receiver: oracle.accountId, actions: call('publish_prediction', predictionArgs(902))},
      ...['accrue', 'challenge_prediction', 'request_settlement', 'void_unsettled_prediction', 'retry_payment', 'reconcile_payment', 'update_receipt_verifier',
        'on_payment_complete', 'oracle_on_call', 'new', 'new_live', 'life', 'active_prediction'].map(method => ({
        name: `forbidden method ${method}`, receiver: self, actions: call(method, {}),
      })),
      {name: 'add a full-access key', receiver: self, actions: [addKey(key.getPublicKey(), fullAccessKey())], destructive: true},
      {name: 'add another function-call key', receiver: self, actions: [addKey(KeyPairEd25519.fromRandom().getPublicKey(), functionCallAccessKey(self, []))], destructive: true},
      {name: 'deploy replacement code', receiver: self, actions: [deployContract(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))], destructive: true},
      {name: 'stake', receiver: self, actions: [stake(1n, key.getPublicKey())], destructive: true},
      {name: 'delete a key', receiver: self, actions: [deleteKey(key.getPublicKey())], destructive: true},
      {name: 'delete the account and send its funds away', receiver: self, actions: [deleteAccount(root.accountId)], destructive: true},
    ];
  };
  async function acceptedAttempts(contract: NearAccount, key: KeyPairEd25519, includeDestructive: boolean): Promise<{accepted: string[]; rejectedFor: Map<string, string>}> {
    const accepted: string[] = [];
    const rejectedFor = new Map<string, string>();
    for (const attempt of FORBIDDEN_ATTEMPTS(contract, key)) {
      if (attempt.destructive && !includeDestructive) continue;
      const outcome = await signAndSend(url, contract.accountId, key, attempt.receiver, attempt.actions);
      if (outcome.accepted) accepted.push(attempt.name);
      else rejectedFor.set(attempt.name, rejection(outcome) ?? 'unknown');
    }
    return {accepted, rejectedFor};
  }

  // 1. The rehearsal lock: deploy, initialize, add the restricted key, delete the full-access key.
  const lockAllowance = 2n * NEAR;
  const {contract: locked, predictionKey: lockedKey, ownerKey: lockedOwner} = await deployAgent(lockAllowance);
  const beforeLock = await accessKeyList(url, locked.accountId);
  assert.equal(beforeLock.length, 2, 'before the lock the account holds its full-access key and the restricted key');
  assert(auditAccessKeys(beforeLock, {contractId: locked.accountId, predictionPublicKey: lockedKey.getPublicKey().toString(), methods: ['publish_prediction']}).some(violation => violation.includes('full-access')), 'the key audit detects the not-yet-locked state');
  const lockReceipt = await locked.batch(locked).deleteKey(lockedOwner.getPublicKey()).transact();
  assert(lockReceipt, 'the lock transaction is accepted');
  await worker.provider.fastForward(3);
  const lockedKeys = await accessKeyList(url, locked.accountId);
  assert.deepEqual(
    auditAccessKeys(lockedKeys, {contractId: locked.accountId, predictionPublicKey: lockedKey.getPublicKey().toString(), methods: ['publish_prediction']}), [],
    `the locked account must hold exactly the restricted key: ${JSON.stringify(lockedKeys)}`,
  );
  assert.equal(lockedKeys.length, 1);

  // 1a. The old full-access key has no authority: it cannot transfer, replace code, add keys or delete the account.
  const lockedBalance = BigInt((await locked.balance()).total);
  for (const attempt of FORBIDDEN_ATTEMPTS(locked, lockedOwner)) {
    const outcome = await signAndSend(url, locked.accountId, lockedOwner, attempt.receiver, attempt.actions);
    assert.equal(rejection(outcome), 'InvalidAccessKeyError.AccessKeyNotFound', `the deleted full-access key must not authorize: ${attempt.name}`);
  }
  assert.equal(BigInt((await locked.balance()).total), lockedBalance, 'the old key moved no funds');

  // 1b. The restricted key may publish; nothing else it signs is accepted, and rejected attempts cost it nothing.
  const allowanceBeforeBattery = await keyAllowance(url, locked.accountId, lockedKey);
  const battery = await acceptedAttempts(locked, lockedKey, true);
  assert.deepEqual(battery.accepted, [], `the restricted key must not be able to do any of these: ${battery.accepted.join(', ')}`);
  const reasons = new Set(battery.rejectedFor.values());
  assert.deepEqual([...reasons].sort(), [
    'InvalidAccessKeyError.DepositWithFunctionCall', 'InvalidAccessKeyError.MethodNameMismatch', 'InvalidAccessKeyError.ReceiverMismatch', 'InvalidAccessKeyError.RequiresFullAccess',
  ], 'every rejection is an access-key permission failure, not an incidental error');
  assert.equal(await keyAllowance(url, locked.accountId, lockedKey), allowanceBeforeBattery, 'rejected attempts are not charged to the allowance');
  assert.equal(BigInt((await locked.balance()).total), lockedBalance, 'the rejected attempts moved no funds');
  assert.equal((await accessKeyList(url, locked.accountId)).length, 1, 'the rejected attempts changed no key');
  assert.equal(await locked.view('active_prediction', {}), null, 'the rejected attempts published nothing');

  // 1c. A caller without the prediction key, even a funded account, cannot publish.
  assert.equal((await keeper.callRaw(locked, 'publish_prediction', predictionArgs(950), {gas: PUBLISH_GAS})).succeeded, false, 'a different caller cannot publish');
  assert.equal(await locked.view('active_prediction', {}), null, 'the refused caller published nothing');

  // 1c'. Each contract-side guard is needed on its own (each is checked by scripts/rehearsal/mutation-check.sh).
  // Signer-key guard: the account's own full-access key calls the agent directly, so only the key check refuses it.
  const unlocked = await deployAgent(2n * NEAR);
  const ownKeyCall = await signAndSend(url, unlocked.contract.accountId, unlocked.ownerKey, unlocked.contract.accountId, [functionCall('publish_prediction', predictionArgs(951), PUBLISH_GAS, 0n)]);
  assert(ownKeyCall.accepted && executionFailure(ownKeyCall), `a key other than the prediction key must not publish, even on the agent account: ${JSON.stringify(ownKeyCall)}`);
  assert.equal(await unlocked.contract.view('active_prediction', {}), null, 'the refused key published nothing');
  // Caller guard: another account signs with the prediction key itself, so only the direct-caller check refuses it.
  const impostor = await root.createSubAccount('impostor', {initialBalance: 5n * NEAR});
  await impostor.batch(impostor).addKey(unlocked.predictionKey.getPublicKey(), fullAccessKey()).transact();
  const relayed = await signAndSend(url, impostor.accountId, unlocked.predictionKey, unlocked.contract.accountId, [functionCall('publish_prediction', predictionArgs(952), PUBLISH_GAS, 0n)]);
  assert(relayed.accepted && executionFailure(relayed), `the prediction key must not publish through another account: ${JSON.stringify(relayed)}`);
  assert.equal(await unlocked.contract.view('active_prediction', {}), null, 'the relayed call published nothing');
  // Positive control: the same agent accepts the real prediction key, so the refusals above are the guards, not the arguments.
  published(await publishVia(unlocked.contract, unlocked.predictionKey, 953));

  // 1d. The permitted call works from the locked state and every other participant still completes the round.
  const permitted = published(await publishVia(locked, lockedKey, 1));
  const lockedChallenger = await root.createSubAccount('locked-challenger', {initialBalance: 10n * NEAR});
  await lockedChallenger.call(locked, 'challenge_prediction', {prediction_id: permitted.id}, {attachedDeposit: BigInt(permitted.challenger_stake)});
  await worker.provider.fastForward(300);
  await root.call(oracle, 'set_scenario', {scenario: 'above'});
  const challengerBefore = BigInt((await lockedChallenger.balance()).total);
  assert.equal((await keeper.callRaw(locked, 'request_settlement', {prediction_id: permitted.id}, {gas: PUBLISH_GAS})).succeeded, true);
  const lockedResult = await locked.view<{outcome: string; payment: {status: string; amount: string}}>('get_prediction', {id: permitted.id});
  assert.equal(lockedResult.outcome, 'yes');
  assert.equal(lockedResult.payment.status, 'paid');
  assert.equal(BigInt((await lockedChallenger.balance()).total) - challengerBefore, BigInt(lockedResult.payment.amount), 'a locked account still pays its challenger exactly');
  assert.equal((await accessKeyList(url, locked.accountId)).length, 1, 'the lock holds after a complete round');

  // 1e. The harness can fail: a misconfigured key on a throwaway account is detected.
  const misconfigured = await deployAgent(2n * NEAR);
  const grantsAccrue = KeyPairEd25519.fromRandom();
  await misconfigured.contract.batch(misconfigured.contract).addKey(grantsAccrue.getPublicKey(), functionCallAccessKey(misconfigured.contract.accountId, ['publish_prediction', 'accrue'], 2n * NEAR)).transact();
  const extraMethod = await acceptedAttempts(misconfigured.contract, grantsAccrue, true);
  assert.deepEqual(extraMethod.accepted, ['forbidden method accrue'], 'an extra permitted method is detected by the battery');
  const grantsEverything = await acceptedAttempts(misconfigured.contract, misconfigured.ownerKey, false);
  assert(grantsEverything.accepted.includes('transfer to another account') && grantsEverything.accepted.includes('forbidden method accrue'), 'a full-access key is detected by the battery');

  // 2. Allowance exhaustion. Calibrate the cost the protocol requires per publication, then size an allowance for three.
  const probe = await deployAgent(1_000n);
  const probeFailure = notEnoughAllowance(await publishVia(probe.contract, probe.predictionKey, 1));
  const requiredPerPublication = probeFailure.cost; // The protocol reserves prepaid gas up front and credits unused gas back.
  assert(requiredPerPublication > 10n ** 22n, 'publication reserves a visible amount of allowance while it runs');

  const calibration = await deployAgent(requiredPerPublication + NEAR / 10n);
  const firstCalibrationOutcome = await publishVia(calibration.contract, calibration.predictionKey, 1);
  published(firstCalibrationOutcome);
  await worker.provider.fastForward(5);
  const afterOne = await keyAllowance(url, calibration.contract.accountId, calibration.predictionKey);
  const burnPerPublication = requiredPerPublication + NEAR / 10n - afterOne!;
  assert.equal(burnPerPublication, burntTokens(firstCalibrationOutcome), 'the allowance is charged the gas actually burnt once unused prepaid gas is credited back');
  assert(burnPerPublication < requiredPerPublication / 100n, 'burnt gas is a small fraction of the amount reserved while the call runs');

  const exhaustible = await deployAgent(requiredPerPublication + (burnPerPublication * 5n) / 2n);
  const {contract: agent, predictionKey: key} = exhaustible;
  const challenger = await root.createSubAccount('exhaustion-challenger', {initialBalance: 30n * NEAR});
  let outstanding: ReturnType<typeof published> | null = null;
  let round = 0;
  while (!outstanding) {
    round += 1;
    assert(round <= 6, 'the finite allowance must run out within a few publications');
    const prediction = published(await publishVia(agent, key, round));
    await worker.provider.fastForward(5);
    await challenger.call(agent, 'challenge_prediction', {prediction_id: prediction.id}, {attachedDeposit: BigInt(prediction.challenger_stake)});
    if ((await keyAllowance(url, agent.accountId, key))! < requiredPerPublication) {
      outstanding = prediction;
      break;
    }
    await worker.provider.fastForward(300);
    await root.call(oracle, 'set_scenario', {scenario: 'below'});
    assert.equal((await keeper.callRaw(agent, 'request_settlement', {prediction_id: prediction.id}, {gas: PUBLISH_GAS})).succeeded, true);
    assert.equal((await agent.view<{outcome: string}>('get_prediction', {id: prediction.id})).outcome, 'no');
  }
  assert.equal(round, 3, 'an allowance sized for two and a half publications supports exactly three');

  // 2a. Exhausted: the protocol refuses publication before the contract runs, and the agent is not dead.
  const exhaustedAllowance = (await keyAllowance(url, agent.accountId, key))!;
  assert(exhaustedAllowance > 0n && exhaustedAllowance < requiredPerPublication, 'the key keeps a remainder it can no longer spend');
  const refused = await publishVia(agent, key, 99);
  const refusal = notEnoughAllowance(refused);
  assert.equal(refusal.allowance, exhaustedAllowance);
  assert(refusal.cost > refusal.allowance);
  const lifeExhausted = await life(agent);
  assert.equal(lifeExhausted.dead, false, 'operational unavailability is not death');
  assert(BigInt(lifeExhausted.remaining_life_ns) > 0n, 'the agent still has life');
  assert(BigInt(lifeExhausted.spendable_bankroll) > 90n * NEAR, 'bankroll is intact');
  assert.equal((await agent.view<{agent_stake: string}>('quote_prediction', {confidence_ppm: 850_000})).agent_stake !== undefined, true, 'quotes still work');

  // 2b. Adding funds changes neither the usable bankroll nor the allowance.
  const spendableBeforeFunds = BigInt(lifeExhausted.spendable_bankroll);
  const balanceBeforeFunds = BigInt((await agent.balance()).total);
  await root.transfer(agent, 50n * NEAR);
  await worker.provider.fastForward(3);
  const lifeFunded = await life(agent);
  assert.equal(BigInt((await agent.balance()).total) - balanceBeforeFunds, 50n * NEAR, 'the funds reached the account');
  assert(BigInt(lifeFunded.spendable_bankroll) <= spendableBeforeFunds, 'added funds do not increase usable bankroll');
  assert.equal(lifeFunded.operational_reserve, lifeExhausted.operational_reserve, 'added funds do not change the recorded reserve');
  assert.equal(await keyAllowance(url, agent.accountId, key), exhaustedAllowance, 'added funds do not reset the key allowance');
  notEnoughAllowance(await publishVia(agent, key, 100));

  // 2c. Other callers still settle and recover the outstanding challenged obligation, including a failed payout.
  const challengerKeyPair = await challenger.getKey();
  assert(challengerKeyPair);
  await challenger.delete(root.accountId);
  await root.call(oracle, 'set_scenario', {scenario: 'above'});
  await worker.provider.fastForward(300);
  const settled = await keeper.callRaw(agent, 'request_settlement', {prediction_id: outstanding.id}, {gas: PUBLISH_GAS});
  assert.equal(settled.succeeded, true, settled.summary());
  const stranded = await agent.view<{outcome: string; payment: {status: string; transfer_in_flight: boolean; beneficiary_account_id: string; amount: string}}>('get_prediction', {id: outstanding.id});
  assert.equal(stranded.outcome, 'yes', 'settlement completes without the publication key');
  assert.equal(stranded.payment.status, 'pending', 'a payout to a missing account stays an owed liability');
  assert.equal(stranded.payment.transfer_in_flight, false);
  const restored = await root.createAccount(challenger.accountId, {initialBalance: NEAR, keyPair: challengerKeyPair as KeyPairEd25519});
  const restoredBefore = BigInt((await restored.balance()).total);
  const retry = await keeper.callRaw(agent, 'retry_payment', {prediction_id: outstanding.id}, {gas: PUBLISH_GAS});
  assert.equal(retry.succeeded, true, retry.summary());
  assert.equal((await agent.view<{payment: {status: string}}>('get_prediction', {id: outstanding.id})).payment.status, 'paid');
  assert.equal(BigInt((await restored.balance()).total) - restoredBefore, BigInt(stranded.payment.amount), 'recovery pays the original challenger exactly once');
  assert.equal((await life(agent)).pending_payment_liabilities, '0');
  assert.equal(await agent.view('active_prediction', {}), null, 'the obligation is closed and the slot is free, yet publication stays unavailable');
  assert.equal(await keyAllowance(url, agent.accountId, key), exhaustedAllowance, 'other callers spend their own gas, not the key allowance');
  notEnoughAllowance(await publishVia(agent, key, 101));
  assert.equal((await life(agent)).dead, false);

  // 3. Death is a different failure: a healthy key reaches the contract, which refuses, and the views say dead.
  const mortal = await deployAgent(2n * NEAR, '120000000000');
  await worker.provider.fastForward(130);
  await root.call(mortal.contract, 'accrue', {});
  const lifeDead = await life(mortal.contract);
  assert.equal(lifeDead.dead, true);
  const allowanceWhileDead = await keyAllowance(url, mortal.contract.accountId, mortal.predictionKey);
  assert(allowanceWhileDead! > requiredPerPublication * 5n, 'a dead agent keeps a healthy allowance');
  const deadAttempt = await publishVia(mortal.contract, mortal.predictionKey, 1);
  assert.equal(deadAttempt.accepted, true, 'the network accepts the call; only the contract refuses it');
  assert(executionFailure(deadAttempt), 'the contract rejects publication by a dead agent');
  // The sandbox outcome does not carry the panic text, so the cause is established by control: the same call,
  // key and arguments publish on a live agent above, and here only the agent's views differ.
  assert.equal(rejection(deadAttempt), null);
  assert.equal((await mortal.contract.view<unknown>('active_prediction', {})), null);
  assert.equal(lifeExhausted.dead, false, 'exhaustion and death are separately observable states');

  // The bounded spend of a rejected-by-contract call is charged to the allowance, as sizing must assume.
  assert(burntTokens(deadAttempt) > 0n && (await keyAllowance(url, mortal.contract.accountId, mortal.predictionKey))! < allowanceWhileDead!, 'a permitted call that the contract rejects still spends allowance');
  console.log('Restricted-key permissions, rehearsal lock, allowance exhaustion, funding, recovery by other callers, and death-versus-exhaustion checks passed');
} finally {
  await worker.tearDown();
}
