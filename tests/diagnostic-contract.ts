import assert from 'node:assert/strict';
import { Worker } from 'near-workspaces';

const worker = await Worker.init();
try {
  const root = worker.rootAccount;
  const contract = await root.devDeploy('diagnostic-contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm');
  assert.equal(await contract.view('callback', {}), null);
  await assert.rejects(root.call(contract, 'reset', {}));
  await assert.rejects(root.call(contract, 'request', {nonce: 'test'}));
  await assert.rejects(root.call(contract, 'oracle_on_call', {
    sender_id: contract.accountId,
    data: {timestamp: '0', recency_duration_sec: 300, prices: []},
    msg: 'reckon-diagnostic',
  }));
  assert.equal(await contract.view('callback', {}), null);
  const oracle = await root.createSubAccount('oracle');
  await contract.call(contract, 'reset', {oracle_id: oracle.accountId});
  assert.equal(await contract.view('oracle_id', {}), oracle.accountId);
  const request = () => contract.call(contract, 'request', {nonce: 'same'}, {gas: 250_000_000_000_000n});
  const deliver = (msg: string) => oracle.call(contract, 'oracle_on_call', {
    sender_id: contract.accountId,
    data: {timestamp: '1', recency_duration_sec: 300, prices: []},
    msg,
  });
  // The fixture oracle has no contract, so the cross-contract call fails after the request is recorded.
  await assert.rejects(request());
  await deliver('1:same');
  assert.equal(JSON.parse(await contract.view<string>('callback', {})).nonce, 'same');
  await assert.rejects(deliver('1:same'));
  await assert.rejects(request());
  await assert.rejects(deliver('1:same'));
  await deliver('2:same');
  await assert.rejects(request());
  await worker.provider.fastForward(130);
  await assert.rejects(deliver('3:same'));
  await assert.rejects(request());
  await deliver('4:same');
  await assert.rejects(request());
  await contract.call(contract, 'reset', {oracle_id: oracle.accountId});
  await assert.rejects(request());
  await assert.rejects(deliver('5:same'));
  await deliver('6:same');
  console.log('Unauthorized diagnostic requests and callbacks were rejected');
} finally {
  await worker.tearDown();
}
