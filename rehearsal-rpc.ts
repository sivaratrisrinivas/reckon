// JSON-RPC and signing helpers shared by the sandbox tests and the live rehearsal scripts. The network, not this code,
// decides whether a transaction is accepted; these helpers only sign with the exact key they are given.
import {createHash} from 'node:crypto';
import {createTransaction, Signature, SignedTransaction, type Action} from 'near-api-js/lib/transaction.js';
import {base_decode} from 'near-api-js/lib/utils/serialize.js';
import type {KeyPair} from 'near-api-js/lib/utils/key_pair.js';

export const NEAR = 10n ** 24n;
export const TGAS = 10n ** 12n;

export type RpcFailure = {name?: string; cause?: {name?: string; info?: unknown}; data?: unknown; message?: string};
export type AccessKeyEntry = {
  public_key: string;
  access_key: {permission: 'FullAccess' | {FunctionCall: {allowance: string | null; receiver_id: string; method_names: string[]}}};
};
export async function rpc<T>(url: string, method: string, params: object): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({jsonrpc: '2.0', id: 'rehearsal', method, params}),
  });
  const body = await response.json() as {result?: T; error?: RpcFailure};
  if (body.error) throw Object.assign(new Error(JSON.stringify(body.error)), {rpcError: body.error});
  return body.result as T;
}

export async function accessKeyList(url: string, accountId: string): Promise<AccessKeyEntry[]> {
  return (await rpc<{keys: AccessKeyEntry[]}>(url, 'query', {request_type: 'view_access_key_list', finality: 'optimistic', account_id: accountId})).keys;
}

/** Remaining allowance of a function-call key, or null when the key does not exist. */
export async function keyAllowance(url: string, accountId: string, key: KeyPair): Promise<bigint | null> {
  const result = await rpc<{permission?: AccessKeyEntry['access_key']['permission']; error?: string}>(url, 'query', {
    request_type: 'view_access_key', finality: 'optimistic', account_id: accountId, public_key: key.getPublicKey().toString(),
  });
  if (!result.permission || result.permission === 'FullAccess') return null;
  const allowance = result.permission.FunctionCall.allowance;
  if (allowance === null) throw new Error('The prediction key must have a finite allowance');
  return BigInt(allowance);
}

export type SignedOutcome =
  | {accepted: true; result: {status: unknown; transaction_outcome: {outcome: {gas_burnt: number; tokens_burnt: string}}; receipts_outcome: {outcome: {gas_burnt: number; tokens_burnt: string; status: unknown; logs: string[]}}[]}}
  | {accepted: false; error: RpcFailure};

/** Sign with exactly the given key and report whether the network accepted the transaction. */
export async function signAndSend(url: string, signerId: string, key: KeyPair, receiverId: string, actions: Action[]): Promise<SignedOutcome> {
  const publicKey = key.getPublicKey();
  const access = await rpc<{nonce?: number | string}>(url, 'query', {
    request_type: 'view_access_key', finality: 'optimistic', account_id: signerId, public_key: publicKey.toString(),
  });
  const block = await rpc<{header: {hash: string}}>(url, 'block', {finality: 'optimistic'});
  // A deleted key has no nonce; the network then rejects the transaction as AccessKeyNotFound.
  const transaction = createTransaction(signerId, publicKey, receiverId, BigInt(access.nonce ?? 0) + 1n, actions, base_decode(block.header.hash));
  const digest = createHash('sha256').update(transaction.encode()).digest();
  const signed = new SignedTransaction({transaction, signature: new Signature({keyType: publicKey.keyType, data: key.sign(digest).signature})});
  try {
    const result = await rpc<Extract<SignedOutcome, {accepted: true}>['result']>(url, 'send_tx', {
      signed_tx_base64: Buffer.from(signed.encode()).toString('base64'), wait_until: 'EXECUTED_OPTIMISTIC',
    });
    return {accepted: true, result};
  } catch (error) {
    return {accepted: false, error: (error as {rpcError?: RpcFailure}).rpcError ?? {message: String(error)}};
  }
}

export function totalBurnt(outcome: Extract<SignedOutcome, {accepted: true}>): {gas: bigint; tokens: bigint} {
  const outcomes = [outcome.result.transaction_outcome.outcome, ...outcome.result.receipts_outcome.map(receipt => receipt.outcome)];
  return {
    gas: outcomes.reduce((sum, item) => sum + BigInt(item.gas_burnt), 0n),
    tokens: outcomes.reduce((sum, item) => sum + BigInt(item.tokens_burnt), 0n),
  };
}

export function succeeded(outcome: SignedOutcome): boolean {
  return outcome.accepted && typeof outcome.result.status === 'object' && outcome.result.status !== null && 'SuccessValue' in outcome.result.status;
}
