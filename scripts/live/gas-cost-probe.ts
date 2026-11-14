import {readFile} from 'node:fs/promises';
import {Account, Connection, InMemorySigner, KeyPair, keyStores, providers} from 'near-api-js';
import {functionCall} from 'near-api-js/lib/transaction.js';

// Learns the upfront cost the network assigns to a prepaid-gas amount by asking a key whose
// allowance is too small. Rejected transactions are not executed and cost nothing.
// Usage: tsx scripts/live/gas-cost-probe.ts <signer-account> <key-name> <receiver> <method> <tgas...>
const [signerId, keyName, receiver, method, ...tgas] = process.argv.slice(2);
const secret = (await readFile(`.local/runtime/live/${keyName}.key`, 'utf8')).trim();
const provider = new providers.JsonRpcProvider({url: process.env.RECKON_TESTNET_RPC ?? 'https://rpc.testnet.near.org'});
const store = new keyStores.InMemoryKeyStore();
void store.setKey('testnet', signerId, KeyPair.fromString(secret as `ed25519:${string}`));
const account = new Account(new Connection('testnet', provider, new InMemorySigner(store), ''), signerId);
for (const amount of tgas) {
  try {
    await account.signAndSendTransaction({
      receiverId: receiver,
      actions: [functionCall(method, {prediction_id: '999999'}, BigInt(amount) * 10n ** 12n, 0n)],
      returnError: true,
    });
    console.log(`${amount} Tgas: ACCEPTED AND EXECUTED (unexpected)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`${amount} Tgas: ${message.replace(/\s+/g, ' ').slice(0, 220)}`);
  }
}
