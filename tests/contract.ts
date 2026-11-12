import assert from 'node:assert/strict';
import { Worker } from 'near-workspaces';

const worker = await Worker.init();
try {
  const root = worker.rootAccount;
  const args = {initial_bankroll: '100000000000000000000000000', operational_reserve: '20000000000000000000000000', idle_life_ns: '900000000000'};
  const contract = await root.devDeploy('contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm', {initialBalance: 120n * 10n ** 24n, method: 'new', args});
  await assert.rejects(root.call(contract, 'new', args));
  const before = await contract.view<{spendable_bankroll:string; retired_bankroll:string}>('life');
  await root.transfer(contract, 10n ** 24n);
  const after = await contract.view<{spendable_bankroll:string; retired_bankroll:string}>('life');
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
  console.log('Contract initialization, transfer, fractional upkeep, and death checks passed');
} finally { await worker.tearDown(); }
