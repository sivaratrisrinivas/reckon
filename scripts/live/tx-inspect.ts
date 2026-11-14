import {providers} from 'near-api-js';

// Prints the receipts of a testnet transaction: executor, status, logs and burnt gas.
// Usage: tsx scripts/live/tx-inspect.ts <transaction-hash> <signer-account-id>
const [hash, signer] = process.argv.slice(2);
const provider = new providers.JsonRpcProvider({url: process.env.RECKON_TESTNET_RPC ?? 'https://rpc.testnet.near.org'});
const outcome = await provider.txStatus(hash, signer, 'FINAL') as unknown as {
  status: unknown;
  transaction: {signer_id: string; receiver_id: string; actions: unknown[]};
  transaction_outcome: {outcome: {gas_burnt: number; tokens_burnt: string}};
  receipts_outcome: Array<{id: string; outcome: {executor_id: string; gas_burnt: number; tokens_burnt: string; logs: string[]; status: unknown}}>;
};
console.log(JSON.stringify({
  signer: outcome.transaction.signer_id,
  receiver: outcome.transaction.receiver_id,
  status: outcome.status,
  transaction_gas_burnt: outcome.transaction_outcome.outcome.gas_burnt,
  receipts: outcome.receipts_outcome.map(receipt => ({
    executor: receipt.outcome.executor_id,
    gas_burnt: receipt.outcome.gas_burnt,
    tokens_burnt: receipt.outcome.tokens_burnt,
    logs: receipt.outcome.logs.map(line => line.slice(0, 300)),
    status: typeof receipt.outcome.status === 'object' ? JSON.parse(JSON.stringify(receipt.outcome.status, (_key, value) => typeof value === 'string' && value.length > 400 ? `${value.slice(0, 400)}...` : value)) : receipt.outcome.status,
  })),
}, null, 1));
