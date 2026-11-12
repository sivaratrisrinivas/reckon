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
  console.log('Unauthorized diagnostic requests and callbacks were rejected');
} finally {
  await worker.tearDown();
}
