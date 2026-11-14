import {readFile} from 'node:fs/promises';
import {ForecastService} from './forecast.js';
import {publishBlobEvidence} from './evidence-store.js';
import {NearChain} from './testnet-chain.js';
import {createTestnetService, type UiLabels} from './testnet-service.js';

// Entry for RECKON_CHAIN=testnet. Configuration comes from the environment and private key files;
// nothing here starts a sandbox, creates a wallet, or exposes a test control.
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Testnet mode requires ${name}`);
  return value;
}

async function keyFromFile(name: string): Promise<string> {
  const path = required(name);
  const secret = (await readFile(path, 'utf8')).trim();
  if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{80,100}$/.test(secret)) throw new Error(`${name} must point to a file holding one ed25519 secret key`);
  return secret;
}

const networkId = process.env.RECKON_NETWORK_ID ?? 'testnet';
if (networkId !== 'testnet') throw new Error('Only the NEAR testnet is supported by this mode');
if (!process.env.NEAR_AI_API_KEY || !process.env.NEAR_AI_MODEL) throw new Error('Testnet mode uses live providers and requires NEAR_AI_API_KEY and NEAR_AI_MODEL; scripted forecasts are disabled.');
if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Testnet mode requires BLOB_READ_WRITE_TOKEN for public evidence storage.');

const rpcUrl = process.env.RECKON_TESTNET_RPC ?? 'https://rpc.testnet.near.org';
const agentAccountId = required('RECKON_AGENT_ACCOUNT');
const chain = new NearChain({
  networkId,
  rpcUrl,
  contractId: agentAccountId,
  predictionSecretKey: await keyFromFile('RECKON_PREDICTION_KEY_FILE'),
  keeperAccountId: required('RECKON_KEEPER_ACCOUNT'),
  keeperSecretKey: await keyFromFile('RECKON_KEEPER_KEY_FILE'),
});
const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
const forecast = new ForecastService(chain.predictionChain(), {
  mode: 'live',
  evidenceDirectory: process.env.RECKON_EVIDENCE_DIR ?? '.local/evidence',
  publishEvidence: (hash, canonical) => publishBlobEvidence(hash, canonical, blobToken),
  budgetPath: process.env.RECKON_BUDGET_PATH ?? '.local/runtime/forecast-budget.json',
  lockPath: process.env.RECKON_LOCK_PATH ?? '.local/runtime/forecast.lock',
  modelApiKey: process.env.NEAR_AI_API_KEY,
  modelId: process.env.NEAR_AI_MODEL,
});

// Labels are configuration, so the interface never claims a network the service is not on.
const labels: UiLabels = {
  network_badge: process.env.RECKON_LABEL_NETWORK ?? 'NEAR TESTNET · TEST MONEY',
  footer: process.env.RECKON_LABEL_FOOTER ?? 'NEAR TESTNET · TEST MONEY · YOUR OWN WALLET APPROVES EVERY STAKE · THE AI CAN LOSE AND DIE',
};
const service = createTestnetService({
  chain,
  forecast,
  config: {
    networkId,
    networkName: 'NEAR testnet · test money',
    rpcUrl,
    agentAccountId,
    providerMode: 'live',
    evidenceHosting: 'Vercel Blob public storage',
    modelCallsPerUtcDay: 12,
    settlementOracle: 'price-oracle.testnet',
    labels,
  },
});

const port = Number(process.env.PORT ?? 4389);
const host = process.env.RECKON_BIND ?? '127.0.0.1';
service.server.listen(port, host, () => {
  console.log(`Reckon on NEAR testnet (live providers, restricted keys only): http://${host}:${port}`);
});
service.keeper.start();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    service.keeper.stop();
    service.server.close(() => process.exit());
  });
}
