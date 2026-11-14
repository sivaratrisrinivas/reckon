import {createHash} from 'node:crypto';
import type {KeyPairEd25519} from 'near-workspaces';
import {createTransaction, Signature, SignedTransaction, type Action} from 'near-api-js/lib/transaction.js';
import {base_decode, base_encode} from 'near-api-js/lib/utils/serialize.js';

export const NEAR = 10n ** 24n;
// NEAR charges 0.0001 NEAR per stored byte; storage is locked inside the account's balance.
const STORAGE_YOCTO_PER_BYTE = 10n ** 19n;
const EMPTY_TX_ROOT = '11111111111111111111111111111111';

export type Signer = {accountId: string; key: KeyPairEd25519};
export type AccountState = {total: bigint; storageUsage: number; available: bigint; codeHash: string};
export type AccessKeyInfo = {
  publicKey: string;
  nonce: number;
  permission: 'FullAccess' | {FunctionCall: {allowance: string | null; receiver_id: string; method_names: string[]}};
};
export type ChainTransaction = {
  hash: string;
  height: number;
  signerId: string;
  publicKey: string;
  receiverId: string;
  methods: string[];
};
export type Receipt = {id: string; outcome: {executor_id: string; logs: string[]; status: unknown; gas_burnt: number; tokens_burnt: string}};
export type TransactionOutcome = {
  hash: string;
  signerId: string;
  succeeded: boolean;
  status: unknown;
  receipts: Receipt[];
  /** The complete RPC response, so a rejection reason can be found wherever the node puts it. */
  raw: string;
};

export class RpcError extends Error {
  constructor(readonly rpcMethod: string, readonly detail: unknown) {
    super(`${rpcMethod} was rejected: ${JSON.stringify(detail)}`);
  }
}

/** Minimal JSON-RPC client for the NEAR sandbox; a direct node URL or the service's /api/rpc proxy both work. */
export class SandboxChain {
  constructor(private readonly url: string) {}

  async rpc<T>(method: string, params: object | unknown[]): Promise<T> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: 'reckon-local-demo', method, params}),
      signal: AbortSignal.timeout(60_000),
    });
    const body = await response.json() as {result?: T; error?: unknown};
    if (body.error !== undefined || !('result' in body)) throw new RpcError(method, body.error ?? body);
    return body.result as T;
  }

  async view<T>(accountId: string, methodName: string, args: object = {}): Promise<T> {
    const result = await this.rpc<{result: number[]; error?: string}>('query', {
      request_type: 'call_function',
      finality: 'optimistic',
      account_id: accountId,
      method_name: methodName,
      args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
    });
    if (result.error) throw new Error(`View ${methodName} failed: ${result.error}`);
    return JSON.parse(Buffer.from(result.result).toString('utf8')) as T;
  }

  async accountState(accountId: string): Promise<AccountState> {
    const account = await this.rpc<{amount: string; locked: string; code_hash: string; storage_usage: number}>('query', {
      request_type: 'view_account', finality: 'optimistic', account_id: accountId,
    });
    const total = BigInt(account.amount) + BigInt(account.locked);
    const storageStake = BigInt(account.storage_usage) * STORAGE_YOCTO_PER_BYTE;
    return {total, storageUsage: account.storage_usage, available: total > storageStake ? total - storageStake : 0n, codeHash: account.code_hash};
  }

  /** The contract code currently deployed on an account, as the chain stores it. */
  async code(accountId: string): Promise<Buffer> {
    const result = await this.rpc<{code_base64: string}>('query', {request_type: 'view_code', finality: 'optimistic', account_id: accountId});
    return Buffer.from(result.code_base64, 'base64');
  }

  async accessKeys(accountId: string): Promise<AccessKeyInfo[]> {
    const list = await this.rpc<{keys: {public_key: string; access_key: {nonce: number; permission: AccessKeyInfo['permission']}}[]}>('query', {
      request_type: 'view_access_key_list', finality: 'optimistic', account_id: accountId,
    });
    return list.keys.map(entry => ({publicKey: entry.public_key, nonce: entry.access_key.nonce, permission: entry.access_key.permission}));
  }

  async latest(): Promise<{height: number; timestampNs: bigint}> {
    const block = await this.rpc<{header: {height: number; timestamp_nanosec: string}}>('block', {finality: 'optimistic'});
    return {height: block.header.height, timestampNs: BigInt(block.header.timestamp_nanosec)};
  }

  /**
   * Sign and submit one transaction. Validation failures (for example a key that may not
   * perform the action) reject with an RpcError; contract failures return succeeded=false.
   */
  async send(signer: Signer, receiverId: string, actions: Action[], options: {nonce?: number} = {}): Promise<TransactionOutcome> {
    const publicKey = signer.key.getPublicKey();
    const nonce = options.nonce ?? await this.nextNonce(signer.accountId, publicKey.toString());
    const block = await this.rpc<{header: {hash: string}}>('block', {finality: 'final'});
    const transaction = createTransaction(signer.accountId, publicKey, receiverId, BigInt(nonce), actions, base_decode(block.header.hash));
    const digest = createHash('sha256').update(transaction.encode()).digest();
    const signature = new Signature({keyType: publicKey.keyType, data: signer.key.sign(digest).signature});
    const signed = Buffer.from(new SignedTransaction({transaction, signature}).encode()).toString('base64');
    const result = await this.rpc<{status: unknown; receipts_outcome: Receipt[]}>('send_tx', {signed_tx_base64: signed, wait_until: 'FINAL'});
    return {
      hash: base_encode(digest),
      signerId: signer.accountId,
      succeeded: isSuccess(result.status),
      status: result.status,
      receipts: result.receipts_outcome,
      raw: JSON.stringify(result),
    };
  }

  private async nextNonce(accountId: string, publicKey: string): Promise<number> {
    const access = await this.rpc<{nonce: number}>('query', {request_type: 'view_access_key', finality: 'optimistic', account_id: accountId, public_key: publicKey});
    return access.nonce + 1;
  }

  /** Execution details of a transaction submitted by someone else, such as the service keeper. */
  async outcome(hash: string, signerId: string): Promise<TransactionOutcome> {
    const result = await this.rpc<{status: unknown; receipts_outcome: Receipt[]}>('tx', {tx_hash: hash, sender_account_id: signerId, wait_until: 'FINAL'});
    return {
      hash,
      signerId,
      succeeded: isSuccess(result.status),
      status: result.status,
      receipts: result.receipts_outcome,
      raw: JSON.stringify(result),
    };
  }

  /** List the transactions included in blocks fromHeight..toHeight, skipping heights without a block. */
  async transactions(fromHeight: number, toHeight: number, accept: (transaction: ChainTransaction) => boolean): Promise<ChainTransaction[]> {
    type Block = {chunks: {chunk_hash: string; tx_root: string}[]};
    type Chunk = {transactions: {hash: string; signer_id: string; public_key: string; receiver_id: string; actions: unknown[]}[]};
    const found: ChainTransaction[] = [];
    const heights = Array.from({length: Math.max(0, toHeight - fromHeight + 1)}, (_, index) => fromHeight + index);
    for (let start = 0; start < heights.length; start += 16) {
      const batch = await Promise.all(heights.slice(start, start + 16).map(async height => {
        let block: Block;
        try {
          block = await this.rpc<Block>('block', {block_id: height});
        } catch (error) {
          if (error instanceof RpcError) return [];
          throw error;
        }
        const matches: ChainTransaction[] = [];
        for (const header of block.chunks) {
          if (header.tx_root === EMPTY_TX_ROOT) continue;
          const chunk = await this.rpc<Chunk>('chunk', {chunk_id: header.chunk_hash});
          for (const transaction of chunk.transactions) {
            const methods = transaction.actions.flatMap(action => {
              const call = (action as {FunctionCall?: {method_name: string}}).FunctionCall;
              return call ? [call.method_name] : [];
            });
            const candidate = {hash: transaction.hash, height, signerId: transaction.signer_id, publicKey: transaction.public_key, receiverId: transaction.receiver_id, methods};
            if (accept(candidate)) matches.push(candidate);
          }
        }
        return matches;
      }));
      found.push(...batch.flat());
    }
    return found;
  }
}

function isSuccess(status: unknown): boolean {
  return typeof status === 'object' && status !== null && ('SuccessValue' in status || 'SuccessReceiptId' in status);
}

/** Names of the functions a Wasm module exports, read from its export section. */
export function wasmExports(wasm: Buffer): string[] {
  let offset = 8;
  const unsigned = (): number => {
    let value = 0;
    let shift = 0;
    for (;;) {
      const byte = wasm[offset++];
      value += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return value;
      shift += 7;
    }
  };
  const names: string[] = [];
  while (offset < wasm.length) {
    const id = wasm[offset++];
    const size = unsigned();
    const end = offset + size;
    if (id === 7) {
      for (let remaining = unsigned(); remaining > 0; remaining -= 1) {
        const length = unsigned();
        const name = wasm.subarray(offset, offset + length).toString('utf8');
        offset += length;
        const kind = wasm[offset++];
        unsigned();
        if (kind === 0) names.push(name);
      }
    }
    offset = end;
  }
  return names.sort();
}

export function describeStatus(status: unknown): string {
  if (typeof status === 'object' && status !== null) {
    if ('SuccessValue' in status || 'SuccessReceiptId' in status) return 'Success';
    if ('Failure' in status) return `Failure ${JSON.stringify((status as {Failure: unknown}).Failure)}`;
  }
  return JSON.stringify(status);
}
