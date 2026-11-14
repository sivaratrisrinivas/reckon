import {existsSync} from 'node:fs';
import {readFile, writeFile} from 'node:fs/promises';
import {Account, Connection, InMemorySigner, KeyPair, keyStores, providers} from 'near-api-js';
import {functionCall, transfer} from 'near-api-js/lib/transaction.js';
import {NearChain} from '../../testnet-chain.js';

// Exercises the restricted keys on a live account: permitted use, forbidden transfer, forbidden
// methods and deposits, and the allowance debit of a call that the contract itself rejects.
// Secrets are read from private files and never printed.
if (existsSync('.env')) process.loadEnvFile('.env');
const AGENT = process.env.RECKON_AGENT_ACCOUNT ?? 'reckon-srinivas-test-2026.testnet';
const CHALLENGER = process.env.RECKON_CHALLENGER_ACCOUNT ?? 'challenger.reckon-srinivas-test-2026.testnet';
const RPC = process.env.RECKON_TESTNET_RPC ?? 'https://rpc.testnet.near.org';
const directory = '.local/runtime/live';
const secret = async (name: string) => (await readFile(`${directory}/${name}.key`, 'utf8')).trim();
const predictionSecret = await secret('prediction-rehearsal-2');
const keeperSecret = await secret('keeper-rehearsal-2');
const predictionPublic = KeyPair.fromString(predictionSecret as `ed25519:${string}`).getPublicKey().toString();
const keeperPublic = KeyPair.fromString(keeperSecret as `ed25519:${string}`).getPublicKey().toString();

const provider = new providers.JsonRpcProvider({url: RPC});
function accountFor(accountId: string, secretKey: string): Account {
  const store = new keyStores.InMemoryKeyStore();
  void store.setKey('testnet', accountId, KeyPair.fromString(secretKey as `ed25519:${string}`));
  return new Account(new Connection('testnet', provider, new InMemorySigner(store), ''), accountId);
}
const predictionAccount = accountFor(AGENT, predictionSecret);
const keeperAccount = accountFor(CHALLENGER, keeperSecret);
const chain = new NearChain({networkId: 'testnet', rpcUrl: RPC, contractId: AGENT, predictionSecretKey: predictionSecret, keeperAccountId: CHALLENGER, keeperSecretKey: keeperSecret});

async function allowance(accountId: string, key: string): Promise<string | null> {
  const description = await chain.accessKeyAllowance(accountId, key);
  return description?.kind === 'function-call' ? String(description.allowance) : description ? description.kind : null;
}

type Attempt = {label: string; signer: string; expected: string; outcome: 'rejected-before-execution' | 'executed-and-failed' | 'succeeded'; error: string | null; transaction: string | null; allowance_before: string | null; allowance_after: string | null};
const attempts: Attempt[] = [];

async function attempt(label: string, signer: Account, signerKey: string, expected: string, receiverId: string, action: ReturnType<typeof functionCall>): Promise<void> {
  const allowanceBefore = await allowance(signer.accountId, signerKey);
  let outcomeKind: Attempt['outcome'];
  let error: string | null = null;
  let transaction: string | null = null;
  try {
    const result = await signer.signAndSendTransaction({receiverId, actions: [action], returnError: true});
    transaction = result.transaction_outcome.id;
    const failure = JSON.stringify(result.status);
    if (failure.includes('Failure')) {
      outcomeKind = 'executed-and-failed';
      error = failure.length > 600 ? `${failure.slice(0, 600)}...` : failure;
    } else {
      outcomeKind = 'succeeded';
    }
  } catch (caught) {
    outcomeKind = 'rejected-before-execution';
    error = caught instanceof Error ? `${caught.name}: ${caught.message}`.slice(0, 600) : String(caught);
  }
  const allowanceAfter = await allowance(signer.accountId, signerKey);
  attempts.push({label, signer: signer.accountId, expected, outcome: outcomeKind, error, transaction, allowance_before: allowanceBefore, allowance_after: allowanceAfter});
  console.log(JSON.stringify(attempts.at(-1)));
}

const probeArguments = {reference_multiplier: '340823333', reference_decimals: 8, decision: 'abstain', confidence_ppm: 800_000, evidence_hash: 'd'.repeat(64), evidence_url: `https://evidence.reckon.invalid/${'d'.repeat(64)}.json`};
const gas = 100n * 10n ** 12n;

await attempt('prediction key: transfer 0.001 NEAR', predictionAccount, predictionPublic, 'rejected: a function-call key cannot transfer', CHALLENGER, transfer(10n ** 21n) as unknown as ReturnType<typeof functionCall>);
await attempt('prediction key: call accrue (not an allowed method)', predictionAccount, predictionPublic, 'rejected: method not allowed for this key', AGENT, functionCall('accrue', {}, gas, 0n));
await attempt('prediction key: publish_prediction with an attached deposit', predictionAccount, predictionPublic, 'rejected: function-call keys cannot attach a deposit', AGENT, functionCall('publish_prediction', probeArguments, gas, 1n));
await attempt('prediction key: publish_prediction to another account', predictionAccount, predictionPublic, 'rejected: receiver does not match the key', CHALLENGER, functionCall('publish_prediction', probeArguments, gas, 0n));
await attempt('prediction key: authorization probe (decision abstain, 100 Tgas prepaid)', predictionAccount, predictionPublic, 'executed and failed inside the contract with "Decision must be yes or no"', AGENT, functionCall('publish_prediction', probeArguments, gas, 0n));
await attempt('prediction key: authorization probe again (60 Tgas prepaid)', predictionAccount, predictionPublic, 'executed and failed inside the contract with "Decision must be yes or no"', AGENT, functionCall('publish_prediction', probeArguments, 60n * 10n ** 12n, 0n));
await attempt('keeper key: transfer 0.001 NEAR', keeperAccount, keeperPublic, 'rejected: a function-call key cannot transfer', AGENT, transfer(10n ** 21n) as unknown as ReturnType<typeof functionCall>);
await attempt('keeper key: publish_prediction (not an allowed method)', keeperAccount, keeperPublic, 'rejected: method not allowed for this key', AGENT, functionCall('publish_prediction', probeArguments, gas, 0n));
await attempt('keeper key: challenge_prediction (not an allowed method)', keeperAccount, keeperPublic, 'rejected: method not allowed for this key', AGENT, functionCall('challenge_prediction', {prediction_id: '1'}, gas, 0n));
await attempt('keeper key: request_settlement with no prediction (allowed method, contract refuses)', keeperAccount, keeperPublic, 'executed and failed inside the contract: not awaiting settlement', AGENT, functionCall('request_settlement', {prediction_id: '1'}, 30n * 10n ** 12n, 0n));
await attempt('keeper key: retry_payment with no prediction (allowed method, contract refuses)', keeperAccount, keeperPublic, 'executed and failed inside the contract', AGENT, functionCall('retry_payment', {prediction_id: '1'}, gas, 0n));

const keys = {
  agent: await provider.query({request_type: 'view_access_key_list', finality: 'final', account_id: AGENT}),
  challenger: await provider.query({request_type: 'view_access_key_list', finality: 'final', account_id: CHALLENGER}),
};
await writeFile(`${directory}/key-checks.json`, JSON.stringify({generated_at: new Date().toISOString(), attempts, keys}, null, 2), {mode: 0o600});
console.log(`written ${directory}/key-checks.json`);
