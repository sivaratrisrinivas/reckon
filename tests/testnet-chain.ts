import assert from 'node:assert/strict';
import {KeyPairEd25519, Worker} from 'near-workspaces';
import {functionCallAccessKey} from 'near-api-js/lib/transaction.js';
import {NearChain} from '../testnet-chain.js';

// Exercises the keyed-signer chain adapter used by testnet mode against a real sandbox
// running the production contract. The sandbox stands in for the RPC endpoint only.
const NEAR = 10n ** 24n;
const worker = await Worker.init();
try {
  const root = worker.rootAccount;
  const predictionKey = KeyPairEd25519.fromRandom();
  const keeperKey = KeyPairEd25519.fromRandom();
  const contract = await root.devDeploy('contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm', {
    initialBalance: 120n * NEAR,
    method: 'new_live',
    args: {
      initial_bankroll: (100n * NEAR).toString(),
      operational_reserve: (20n * NEAR).toString(),
      prediction_public_key: predictionKey.getPublicKey().toString(),
    },
  });
  await contract.batch(contract).addKey(
    predictionKey.getPublicKey(),
    functionCallAccessKey(contract.accountId, ['publish_prediction'], 5n * NEAR),
  ).transact();
  const keeper = await root.createSubAccount('keeper', {initialBalance: 5n * NEAR});
  await keeper.batch(keeper).addKey(
    keeperKey.getPublicKey(),
    functionCallAccessKey(contract.accountId, ['request_settlement', 'void_unsettled_prediction', 'retry_payment'], NEAR),
  ).transact();

  const rpcUrl = (worker.provider as unknown as {connection: {url: string}}).connection.url;
  const chain = new NearChain({
    networkId: 'sandbox',
    rpcUrl,
    contractId: contract.accountId,
    predictionSecretKey: predictionKey.toString(),
    keeperAccountId: keeper.accountId,
    keeperSecretKey: keeperKey.toString(),
  });

  const life = await chain.view<{initial_bankroll: string; dead: boolean}>('life');
  assert.equal(life.initial_bankroll, (100n * NEAR).toString(), 'views read the contract through the configured RPC');
  assert.equal(life.dead, false);
  const quote = await chain.predictionChain().quotePrediction(800_000);
  assert.equal(quote.confidence_ppm, 800_000);

  assert.equal(await chain.predictionChain().activePrediction(), null);
  const keyBefore = await chain.accessKeyAllowance(contract.accountId, predictionKey.getPublicKey().toString());
  assert.equal(keyBefore?.kind, 'function-call');
  const published = await chain.predictionChain().publishPrediction({
    reference_multiplier: '340823333',
    reference_decimals: 8,
    decision: 'yes',
    confidence_ppm: 800_000,
    evidence_hash: 'b'.repeat(64),
    evidence_url: `https://evidence.reckon.invalid/${'b'.repeat(64)}.json`,
  });
  assert.equal(published.id, '1');
  assert.equal(published.decision, 'yes');
  assert.equal((await chain.predictionChain().activePrediction())?.id, '1');
  const keyAfter = await chain.accessKeyAllowance(contract.accountId, predictionKey.getPublicKey().toString());
  assert(keyAfter && keyAfter.kind === 'function-call' && keyAfter.allowance < keyBefore.allowance!, 'publication spends from the restricted key allowance');

  await assert.rejects(
    chain.predictionChain().publishPrediction({
      reference_multiplier: '340823333',
      reference_decimals: 8,
      decision: 'no',
      confidence_ppm: 800_000,
      evidence_hash: 'c'.repeat(64),
      evidence_url: `https://evidence.reckon.invalid/${'c'.repeat(64)}.json`,
    }),
    /unresolved prediction/,
    'a rejected publication surfaces the contract reason',
  );

  const early = await chain.keeperCall('request_settlement', {prediction_id: '1'});
  assert.equal(early.succeeded, false, 'settlement before the deadline is refused');
  assert.match(early.failure ?? '', /deadline has not passed/);
  assert.match(early.transactionHash, /^[1-9A-HJ-NP-Za-km-z]{43,44}$/, 'a failed call still reports its transaction hash');

  const timestamp = await chain.optimisticBlockTimestampNs();
  assert(timestamp > BigInt(published.published_at_ns), 'optimistic block time advances past publication');
  console.log('testnet chain adapter checks passed');
} finally {
  await worker.tearDown();
}
