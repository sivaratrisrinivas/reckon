import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {AddressInfo} from 'node:net';
import {KeyPairEd25519, Worker} from 'near-workspaces';
import {functionCallAccessKey} from 'near-api-js/lib/transaction.js';
import {ForecastService} from '../forecast.js';
import {NearChain} from '../testnet-chain.js';
import {createTestnetService} from '../testnet-service.js';

// Testnet mode drives the production contract through restricted keys only. A sandbox stands in
// for the RPC endpoint and the oracle account; providers are the deterministic fixtures.
const NEAR = 10n ** 24n;
process.env.RECKON_TEST = '1'; // testnet mode must ignore the sandbox test switch
const scratch = await mkdtemp(join(tmpdir(), 'rk-tn-'));
const worker = await Worker.init();
let service: ReturnType<typeof createTestnetService> | null = null;
try {
  const root = worker.rootAccount;
  const predictionKey = KeyPairEd25519.fromRandom();
  const keeperKey = KeyPairEd25519.fromRandom();
  const oracle = await root.devDeploy('contract/target/wasm32-unknown-unknown/release/reckon_oracle_fixture.wasm', {
    initialBalance: 5n * NEAR, method: 'new', args: {owner_id: root.accountId},
  });
  const contract = await root.devDeploy('contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm', {
    initialBalance: 120n * NEAR,
    method: 'new',
    args: {
      receipt_genesis: null,
      initial_bankroll: (100n * NEAR).toString(),
      operational_reserve: (20n * NEAR).toString(),
      idle_life_ns: (15n * 24n * 3600n * 10n ** 9n).toString(),
      prediction_public_key: predictionKey.getPublicKey().toString(),
      oracle_account_id: oracle.accountId,
    },
  });
  await contract.batch(contract).addKey(predictionKey.getPublicKey(), functionCallAccessKey(contract.accountId, ['publish_prediction'], 5n * NEAR)).transact();
  const keeper = await root.createSubAccount('keeper', {initialBalance: 10n * NEAR});
  await keeper.batch(keeper).addKey(
    keeperKey.getPublicKey(),
    functionCallAccessKey(contract.accountId, ['request_settlement', 'void_unsettled_prediction', 'retry_payment'], 2n * NEAR),
  ).transact();
  const challenger = await root.createSubAccount('challenger', {initialBalance: 5n * NEAR});

  const rpcUrl = (worker.provider as unknown as {connection: {url: string}}).connection.url;
  const chain = new NearChain({
    networkId: 'sandbox', rpcUrl, contractId: contract.accountId,
    predictionSecretKey: predictionKey.toString(), keeperAccountId: keeper.accountId, keeperSecretKey: keeperKey.toString(),
  });
  const forecast = new ForecastService(chain.predictionChain(), {
    mode: 'fixture',
    evidenceDirectory: join(scratch, 'evidence'),
    publishEvidence: async hash => `https://evidence.reckon.invalid/${hash}.json`,
    budgetPath: join(scratch, 'budget.json'),
    lockPath: join(scratch, 'forecast.lock'),
    cooldownMs: 0,
  });
  service = createTestnetService({
    chain,
    forecast,
    config: {
      networkId: 'testnet',
      networkName: 'NEAR testnet · test money',
      rpcUrl: 'https://rpc.testnet.near.org',
      agentAccountId: contract.accountId,
      providerMode: 'fixture',
      evidenceHosting: 'configured evidence hosting',
      modelCallsPerUtcDay: null,
      settlementOracle: oracle.accountId,
      labels: {network_badge: 'NEAR TESTNET · TEST MONEY', footer: 'NEAR TESTNET · TEST MONEY · SETTLED BY A THIRD-PARTY ORACLE'},
    },
    keeperPollMs: 500,
  });
  await new Promise<void>(resolve => service!.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`;
  const bodies: string[] = [];
  async function get(path: string, init?: RequestInit): Promise<{status: number; body: string}> {
    const response = await fetch(`${base}${path}`, init);
    const body = await response.text();
    bodies.push(body);
    return {status: response.status, body};
  }

  const config = JSON.parse((await get('/api/config')).body);
  assert.equal(config.chain_mode, 'testnet');
  assert.equal(config.network_id, 'testnet');
  assert.equal(config.contract_account_id, contract.accountId);
  assert.equal(config.labels.network_badge, 'NEAR TESTNET · TEST MONEY', 'labels come from configuration');
  assert.doesNotMatch(JSON.stringify(config), /local sandbox/i, 'testnet configuration never says local sandbox');

  for (const [method, path] of [['GET', '/api/wallet'], ['POST', '/api/wallet/fund'], ['GET', '/api/wallet/balance'], ['POST', '/api/rpc'], ['POST', '/test/advance'], ['POST', '/test/accrue'], ['POST', '/test/settlement-scenario'], ['POST', '/test/challenge-race'], ['POST', '/test/payment-scenario']] as const) {
    assert.equal((await get(path, {method})).status, 404, `${method} ${path} does not exist in testnet mode`);
  }

  const life = JSON.parse((await get('/api/life')).body);
  assert.equal(life.dead, false);
  const readiness = JSON.parse((await get(`/api/wallet/readiness?account_id=${challenger.accountId}`)).body);
  assert.equal(readiness.network_id, 'testnet');
  assert.equal(readiness.account_id, challenger.accountId);
  assert(BigInt(readiness.available_balance) > 4n * NEAR, 'readiness reads the visitor account balance, not a service wallet');
  assert.equal((await get('/api/wallet/readiness?account_id=NOT%20AN%20ACCOUNT')).status, 400);

  const forecastResponse = await get('/api/forecast', {method: 'POST'});
  assert.equal(forecastResponse.status, 201, forecastResponse.body);
  const published = JSON.parse(forecastResponse.body).prediction;
  assert.equal(published.id, '1');
  const evidence = await get(`/api/evidence/${published.evidence_hash}`);
  assert.equal(evidence.status, 200);

  const challenge = await challenger.callRaw(contract, 'challenge_prediction', {prediction_id: published.id}, {attachedDeposit: BigInt(published.challenger_stake)});
  assert(challenge.succeeded, 'a normal challenger account takes the position');

  // Advance chain time past the deadline; the keeper must request settlement and the result must follow.
  const deadline = BigInt(published.deadline_ns);
  for (let attempt = 0; attempt < 80 && await chain.optimisticBlockTimestampNs() < deadline; attempt += 1) await worker.provider.fastForward(100);
  assert(await chain.optimisticBlockTimestampNs() >= deadline, 'the sandbox reached the prediction deadline');
  let settled = JSON.parse((await get('/api/predictions?start_id=1&limit=1')).body)[0];
  for (let attempt = 0; attempt < 60 && !(settled.settlement_status === 'resolved' && (settled.payment === null || settled.payment.status === 'paid')); attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 1_000));
    settled = JSON.parse((await get('/api/predictions?start_id=1&limit=1')).body)[0];
  }
  assert.equal(settled.settlement_status, 'resolved', 'the keeper settled through the declared oracle with its restricted key');
  assert(settled.outcome === 'yes' || settled.outcome === 'no');
  assert(settled.payment === null || settled.payment.status === 'paid', 'a challenger payout is confirmed before it is reported paid');

  const health = JSON.parse((await get('/api/health')).body);
  assert.equal(health.chain_mode, 'testnet');
  assert.equal(health.keeper.running, true);

  for (const secret of [predictionKey.toString(), keeperKey.toString()]) {
    assert(bodies.every(body => !body.includes(secret)), 'no response contains a private key');
    assert(bodies.every(body => !body.includes(secret.slice('ed25519:'.length))), 'no response contains private key material');
  }
  console.log('testnet service checks passed');
} finally {
  service?.keeper.stop();
  await new Promise<void>(resolve => (service ? service.server.close(() => resolve()) : resolve()));
  await worker.tearDown();
  await rm(scratch, {recursive: true, force: true});
}
