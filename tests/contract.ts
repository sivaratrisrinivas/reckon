import assert from 'node:assert/strict';
import { Worker } from 'near-workspaces';

const worker = await Worker.init();
try {
  const root = worker.rootAccount;
  const args = {initial_bankroll: '100000000000000000000000000', operational_reserve: '20000000000000000000000000', idle_life_ns: '900000000000'};
  const contract = await root.devDeploy('contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm', {initialBalance: 120n * 10n ** 24n, method: 'new', args});
  await assert.rejects(root.call(contract, 'new', args));
  const before = await contract.view<{spendable_bankroll:string; retired_bankroll:string; operational_reserve:string}>('life');
  const physicalBefore = BigInt((await contract.balance()).total);
  const partitionBefore = BigInt(before.spendable_bankroll) + BigInt(before.retired_bankroll) + BigInt(before.operational_reserve);
  assert.equal(partitionBefore, physicalBefore, 'initial partition matches the funded contract account');
  await root.transfer(contract, 10n ** 24n);
  const after = await contract.view<{spendable_bankroll:string; retired_bankroll:string; operational_reserve:string}>('life');
  const physicalAfter = BigInt((await contract.balance()).total);
  const partitionAfter = BigInt(after.spendable_bankroll) + BigInt(after.retired_bankroll) + BigInt(after.operational_reserve);
  assert.equal(physicalAfter - physicalBefore, 10n ** 24n, 'plain transfer reaches the contract account');
  assert.equal(partitionAfter, partitionBefore, 'plain transfer does not increase the usable bankroll partition');
  assert(BigInt(after.spendable_bankroll) <= BigInt(before.spendable_bankroll), 'plain transfers must not increase spendable bankroll');
  await worker.provider.fastForward(300);
  const later = await contract.view<{spendable_bankroll:string; retired_bankroll:string}>('life');
  assert(BigInt(later.spendable_bankroll) < BigInt(after.spendable_bankroll));
  assert(BigInt(later.retired_bankroll) > BigInt(after.retired_bankroll));
  const tiny = await root.devDeploy('contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm', {initialBalance: 2n * 10n ** 24n, method: 'new', args: {initial_bankroll: '10', operational_reserve: '1', idle_life_ns: '100000000000'}});
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
    args: {initial_bankroll: '15000000000000000000000000', operational_reserve: '5000000000000000000000000'},
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
  console.log('Contract initialization, transfer, fractional upkeep, death, and fifteen-day live rate checks passed');
} finally { await worker.tearDown(); }
