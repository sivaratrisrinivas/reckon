import assert from 'node:assert/strict';
import { KeyPairEd25519, Worker } from 'near-workspaces';
import { functionCallAccessKey } from 'near-api-js/lib/transaction.js';

const NEAR = 10n ** 24n;
const predictionArgs = {
  reference_multiplier: '340823333',
  reference_decimals: 8,
  decision: 'no',
  confidence_ppm: 850_000,
  evidence_hash: 'a'.repeat(64),
  evidence_url: `https://evidence.reckon.invalid/${'a'.repeat(64)}.json`,
};

const worker = await Worker.init();
try {
  const root = worker.rootAccount;
  const predictionKey = KeyPairEd25519.fromRandom();
  const args = {
    initial_bankroll: (100n * NEAR).toString(),
    operational_reserve: (20n * NEAR).toString(),
    idle_life_ns: '900000000000',
    prediction_public_key: predictionKey.getPublicKey().toString(),
  };
  const contract = await root.devDeploy('contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm', {initialBalance: 120n * 10n ** 24n, method: 'new', args});
  await contract.batch(contract).addKey(
    predictionKey.getPublicKey(),
    functionCallAccessKey(contract.accountId, ['publish_prediction'], 5n * NEAR),
  ).transact();
  await assert.rejects(root.call(contract, 'new', args));

  const quote = await contract.view<{
    agent_stake: string;
    challenger_stake: string;
    confidence_ppm: number;
  }>('quote_prediction', {confidence_ppm: predictionArgs.confidence_ppm});
  assert.equal(quote.confidence_ppm, 850_000);
  assert(BigInt(quote.agent_stake) >= 10n ** 22n, 'agent stake meets the documented 0.01 NEAR minimum');
  assert(BigInt(quote.challenger_stake) >= 10n ** 21n, 'challenger quote meets the documented 0.001 NEAR minimum');
  assert(BigInt(quote.agent_stake) <= 2n * NEAR, 'agent risk remains within 2% of the initial bankroll');
  const expectedFairOdds = (BigInt(quote.agent_stake) * 150_000n + 425_000n) / 850_000n;
  assert.equal(BigInt(quote.challenger_stake), expectedFairOdds, 'challenger quote follows the selected-side probability without a margin');

  await assert.rejects(contract.call(contract, 'publish_prediction', predictionArgs));
  await assert.rejects(contract.call(contract, 'publish_prediction', {...predictionArgs, reference_multiplier: '0'}, {signWithKey: predictionKey}));
  assert.equal(await contract.view('active_prediction'), null, 'an invalid reference creates no prediction');
  await assert.rejects(contract.call(contract, 'publish_prediction', {...predictionArgs, evidence_url: 'http://example.com/evidence.json'}, {signWithKey: predictionKey}));
  assert.equal(await contract.view('active_prediction'), null, 'an invalid evidence URL creates no prediction');
  const prediction = await contract.call<{
    id: string;
    decision: string;
    confidence_ppm: number;
    agent_stake: string;
    challenger_stake: string;
    evidence_hash: string;
    evidence_url: string;
    published_at_ns: string;
    challenge_deadline_ns: string;
    deadline_ns: string;
  }>(contract, 'publish_prediction', predictionArgs, {signWithKey: predictionKey});
  assert.equal(prediction.id, '1');
  assert.equal(prediction.decision, 'no');
  assert.equal(prediction.confidence_ppm, 850_000);
  assert(BigInt(prediction.agent_stake) <= BigInt(quote.agent_stake), 'publication prices the remaining bankroll after elapsed upkeep');
  assert.equal(BigInt(prediction.challenger_stake), (BigInt(prediction.agent_stake) * 150_000n + 425_000n) / 850_000n, 'published stakes preserve exact fair-odds rounding');
  assert.equal(prediction.evidence_hash, predictionArgs.evidence_hash);
  assert.equal(prediction.evidence_url, predictionArgs.evidence_url);
  assert.equal(BigInt(prediction.challenge_deadline_ns) - BigInt(prediction.published_at_ns), 30_000_000_000n);
  assert.equal(BigInt(prediction.deadline_ns) - BigInt(prediction.published_at_ns), 300_000_000_000n);

  const challenger = await root.createSubAccount('challenger', {initialBalance: 10n * NEAR});
  const contractBalanceBeforeWrongDeposit = BigInt((await contract.balance()).total);
  await assert.rejects(challenger.call(contract, 'challenge_prediction', {prediction_id: prediction.id}, {
    attachedDeposit: BigInt(prediction.challenger_stake) + 1n,
  }));
  assert.equal(BigInt((await contract.balance()).total), contractBalanceBeforeWrongDeposit, 'a wrong deposit is rejected without custody');
  const custodyBeforeSelfChallenge = await contract.view<{challenger_custody: string}>('life');
  await assert.rejects(contract.call(contract, 'challenge_prediction', {prediction_id: prediction.id}, {
    attachedDeposit: BigInt(prediction.challenger_stake),
  }), 'the contract cannot challenge its own prediction');
  const custodyAfterSelfChallenge = await contract.view<{challenger_custody: string}>('life');
  assert.equal(BigInt(custodyAfterSelfChallenge.challenger_custody), BigInt(custodyBeforeSelfChallenge.challenger_custody), 'a self-challenge does not enter custody');
  const contractBalanceBeforeTake = BigInt((await contract.balance()).total);

  const challengeLifeBefore = await contract.view<{
    spendable_bankroll: string;
    committed_bankroll: string;
    challenger_custody: string;
    retired_bankroll: string;
  }>('life');
  const acceptedChallenge = await challenger.call<{
    challenger_account_id: string | null;
    challenged_at_ns: string | null;
    agent_stake_committed: boolean;
  }>(contract, 'challenge_prediction', {prediction_id: prediction.id}, {
    attachedDeposit: BigInt(prediction.challenger_stake),
  });
  assert.equal(acceptedChallenge.challenger_account_id, challenger.accountId, 'the contract records the actual challenger identity');
  assert(acceptedChallenge.challenged_at_ns, 'the contract records acceptance time');
  assert.equal(acceptedChallenge.agent_stake_committed, true, 'acceptance commits Reckon stake');
  const challengeLifeAfter = await contract.view<{
    spendable_bankroll: string;
    committed_bankroll: string;
    challenger_custody: string;
    retired_bankroll: string;
  }>('life');
  const agentPartitionBefore = BigInt(challengeLifeBefore.spendable_bankroll)
    + BigInt(challengeLifeBefore.committed_bankroll)
    + BigInt(challengeLifeBefore.retired_bankroll);
  const agentPartitionAfter = BigInt(challengeLifeAfter.spendable_bankroll)
    + BigInt(challengeLifeAfter.committed_bankroll)
    + BigInt(challengeLifeAfter.retired_bankroll);
  assert.equal(agentPartitionAfter, agentPartitionBefore, 'accepted stakes move from spendable to committed while upkeep moves to retired');
  assert.equal(BigInt(challengeLifeAfter.committed_bankroll), BigInt(prediction.agent_stake));
  assert.equal(BigInt(challengeLifeAfter.challenger_custody), BigInt(prediction.challenger_stake));
  const contractBalanceAfterTake = BigInt((await contract.balance()).total);
  assert.equal(contractBalanceAfterTake - contractBalanceBeforeTake, BigInt(prediction.challenger_stake), 'the exact quoted challenger stake enters custody');
  const secondChallenger = await root.createSubAccount('second-challenger', {initialBalance: 10n * NEAR});
  await assert.rejects(secondChallenger.call(contract, 'challenge_prediction', {prediction_id: prediction.id}, {
    attachedDeposit: BigInt(prediction.challenger_stake),
  }));
  assert.equal(BigInt((await contract.balance()).total), contractBalanceAfterTake, 'a second take cannot add another deposit');

  await assert.rejects(contract.call(contract, 'publish_prediction', predictionArgs, {signWithKey: predictionKey}));
  await assert.rejects(contract.view('quote_prediction', {confidence_ppm: 0}));

  const active = await contract.view<typeof prediction>('active_prediction');
  assert.equal(active?.evidence_hash, predictionArgs.evidence_hash);

  await worker.provider.fastForward(5); // Let prior publication gas-refund receipts complete before comparing balances.
  const before = await contract.view<{spendable_bankroll:string; committed_bankroll:string; challenger_custody:string; retired_bankroll:string; operational_reserve:string}>('life');
  const physicalBefore = BigInt((await contract.balance()).total);
  const partitionBefore = BigInt(before.spendable_bankroll) + BigInt(before.committed_bankroll) + BigInt(before.challenger_custody) + BigInt(before.retired_bankroll) + BigInt(before.operational_reserve);
  assert(partitionBefore >= physicalBefore && partitionBefore - physicalBefore < BigInt(before.operational_reserve), 'publication fees remain within the operational reserve, separate from bankroll');
  await root.transfer(contract, 10n ** 24n);
  const after = await contract.view<{spendable_bankroll:string; committed_bankroll:string; challenger_custody:string; retired_bankroll:string; operational_reserve:string}>('life');
  const physicalAfter = BigInt((await contract.balance()).total);
  const partitionAfter = BigInt(after.spendable_bankroll) + BigInt(after.committed_bankroll) + BigInt(after.challenger_custody) + BigInt(after.retired_bankroll) + BigInt(after.operational_reserve);
  assert.equal(physicalAfter - physicalBefore, 10n ** 24n, 'plain transfer reaches the contract account');
  assert.equal(partitionAfter, partitionBefore, 'plain transfer does not increase the usable bankroll partition');
  assert(BigInt(after.spendable_bankroll) <= BigInt(before.spendable_bankroll), 'plain transfers must not increase spendable bankroll');
  await worker.provider.fastForward(300);
  const later = await contract.view<{spendable_bankroll:string; retired_bankroll:string}>('life');
  assert(BigInt(later.spendable_bankroll) < BigInt(after.spendable_bankroll));
  assert(BigInt(later.retired_bankroll) > BigInt(after.retired_bankroll));

  const latePredictionKey = KeyPairEd25519.fromRandom();
  const lateContract = await root.devDeploy('contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm', {
    initialBalance: 120n * NEAR,
    method: 'new',
    args: {...args, prediction_public_key: latePredictionKey.getPublicKey().toString()},
  });
  await lateContract.batch(lateContract).addKey(
    latePredictionKey.getPublicKey(),
    functionCallAccessKey(lateContract.accountId, ['publish_prediction'], 5n * NEAR),
  ).transact();
  const latePrediction = await lateContract.call<{id: string; challenger_stake: string}>(lateContract, 'publish_prediction', predictionArgs, {signWithKey: latePredictionKey});
  const lateChallenger = await root.createSubAccount('late-challenger', {initialBalance: 10n * NEAR});
  const lateContractBalance = BigInt((await lateContract.balance()).total);
  await worker.provider.fastForward(31);
  await assert.rejects(lateChallenger.call(lateContract, 'challenge_prediction', {prediction_id: latePrediction.id}, {
    attachedDeposit: BigInt(latePrediction.challenger_stake),
  }));
  const closedPrediction = await lateContract.view<{challenger_account_id: string | null}>('active_prediction');
  assert.equal(closedPrediction.challenger_account_id, null, 'a late take cannot claim the position');
  assert.equal(BigInt((await lateContract.balance()).total), lateContractBalance, 'the late deposit is rejected and returned');

  const tiny = await root.devDeploy('contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm', {initialBalance: 3n * 10n ** 24n, method: 'new', args: {initial_bankroll: '10', operational_reserve: '1', idle_life_ns: '100000000000', prediction_public_key: KeyPairEd25519.fromRandom().getPublicKey().toString()}});
  for (let i = 0; i < 4; i++) {
    await worker.provider.fastForward(5);
    await root.call(tiny, 'accrue', {});
  }
  const accrued = await tiny.view<{spendable_bankroll:string; retired_bankroll:string}>('life');
  assert(BigInt(accrued.retired_bankroll) > 0n, 'fractional upkeep survives repeated calls');
  await worker.provider.fastForward(200);
  const depleted = await tiny.view<{dead:boolean; spendable_bankroll:string}>('life');
  assert.equal(depleted.dead, true);
  assert.equal(depleted.spendable_bankroll, '0');
  await root.call(tiny, 'accrue', {});
  await root.transfer(tiny, 10n ** 24n);
  assert.equal((await tiny.view<{dead:boolean}>('life')).dead, true, 'transfers cannot revive the agent');
  const live = await root.devDeploy('contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm', {
    initialBalance: 20n * 10n ** 24n,
    method: 'new_live',
    args: {initial_bankroll: '15000000000000000000000000', operational_reserve: '5000000000000000000000000', prediction_public_key: KeyPairEd25519.fromRandom().getPublicKey().toString()},
  });
  const initialLive = await live.view<{idle_life_ns:string; remaining_life_ns:string}>('life');
  const fifteenDays = 1_296_000_000_000_000n;
  assert.equal(BigInt(initialLive.idle_life_ns), fifteenDays);
  assert(BigInt(initialLive.remaining_life_ns) > fifteenDays - 60_000_000_000n, 'live agent begins with close to fifteen days of life');
  await worker.provider.fastForward(300);
  const liveAfter = await live.view<{remaining_life_ns:string; retired_bankroll:string; spendable_bankroll:string}>('life');
  const elapsed = fifteenDays - BigInt(liveAfter.remaining_life_ns);
  assert(elapsed > 0n, 'live upkeep projects time without a mutation');
  assert.equal(BigInt(liveAfter.retired_bankroll), 15n * 10n ** 24n * elapsed / fifteenDays, 'live upkeep follows the fifteen-day rate');
  assert.equal(BigInt(liveAfter.retired_bankroll) + BigInt(liveAfter.spendable_bankroll), 15n * 10n ** 24n);
  console.log('Prediction authorization, immutable terms, deadlines, quote bounds, upkeep, death, and live-rate checks passed');
} finally { await worker.tearDown(); }
