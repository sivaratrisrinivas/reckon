import {createHash, randomUUID} from 'node:crypto';
import {createTransaction, functionCall, Signature, SignedTransaction} from 'near-api-js/lib/transaction.js';
import {base_decode, base_encode} from 'near-api-js/lib/utils/serialize.js';
import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import type {NearAccount, TransactionResult} from 'near-workspaces';

type Validator = {account_id: string; public_key: string; stake: string};
type GenesisAnchor = {genesis_hash: string; next_bp_hash: string; validators: Validator[]};
type Header = {inner_lite: {height: number}};
type Head = {hash: string; height: string};
type PendingPayment = {attempt_id: string; beneficiary_account_id: string};
type OutcomeProof = {light_client_head?: string; outcome_proof: {id: string}};
type Submission = {hash: string; signerId: string; signedTransaction: string};
type ExecutionReceipt = {id: string; outcome: {executor_id: string; logs: string[]; receipt_ids: string[]; status: unknown}};
type Execution = {final_execution_status?: string; status: unknown; receipts_outcome: ExecutionReceipt[]};
type Observation = {result: Execution};
type Attempt = {attemptId: string; sourceId: string; transferId: string; beneficiary: string};
const EVENT_PREFIX = 'RECKON_PAYMENT_ATTEMPT:';

function isAttempt(value: unknown): value is Attempt {
  if (!value || typeof value !== 'object') return false;
  const fields = value as Record<string, unknown>;
  return ['attemptId', 'sourceId', 'transferId', 'beneficiary'].every(key => typeof fields[key] === 'string')
    && /^[1-9][0-9]*$/.test(fields.attemptId as string);
}


type AttemptEvent = {instance_id: string; prediction_id: string; payment_id: string; attempt_id: string; beneficiary_account_id: string; amount: string};
function parseAttemptEvent(log: string): AttemptEvent | null {
  try {
    const event = JSON.parse(log.slice(EVENT_PREFIX.length)) as Record<string, unknown>;
    const keys = ['instance_id', 'prediction_id', 'payment_id', 'attempt_id', 'beneficiary_account_id', 'amount'];
    if (!event || Object.keys(event).length !== keys.length || !keys.every(key => typeof event[key] === 'string')) return null;
    const value = event as AttemptEvent;
    if (!/^[1-9][0-9]*$/.test(value.prediction_id) || BigInt(value.prediction_id) >= 1n << 64n
      || !/^[1-9][0-9]*$/.test(value.attempt_id) || BigInt(value.attempt_id) >= 1n << 64n
      || !/^[1-9][0-9]*$/.test(value.amount) || BigInt(value.amount) >= 1n << 128n
      || value.payment_id !== `reckon:payment:${value.prediction_id}` || base_decode(value.instance_id).length !== 32
      || value.beneficiary_account_id.length < 2 || value.beneficiary_account_id.length > 64
      || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value.beneficiary_account_id)) return null;
    return value;
  } catch { return null; }
}

async function rpc<T>(url: string, method: string, params: object): Promise<T> {
  const response = await fetch(url, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 'reckon-receipt-proof', method, params}),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  if (Buffer.byteLength(text) > 2_097_152) throw new Error('Receipt RPC response exceeds the supported size');
  const body = JSON.parse(text) as {result?: T; error?: unknown};
  if (!response.ok || body.error || !('result' in body)) throw new Error(`Receipt proof RPC ${method} is unavailable: ${JSON.stringify(body.error)}`);
  return body.result as T;
}

export async function sandboxReceiptGenesis(url: string): Promise<GenesisAnchor> {
  const [genesis, block] = await Promise.all([
    rpc<{genesis_height: number; validators: {account_id: string; public_key: string; amount: string}[]}>(url, 'EXPERIMENTAL_genesis_config', {}),
    rpc<{header: {hash: string; next_bp_hash: string}}>(url, 'block', {block_id: 0}),
  ]);
  if (genesis.genesis_height !== 0) throw new Error('Receipt verification requires the generated sandbox genesis');
  return {
    genesis_hash: block.header.hash,
    next_bp_hash: block.header.next_bp_hash,
    validators: genesis.validators.map(validator => ({account_id: validator.account_id, public_key: validator.public_key, stake: validator.amount})),
  };
}

/** RPC supplies untrusted data; only the contract verifies and applies it. */
export class ReceiptProofRelay {
  private readonly attempts = new Map<string, Attempt>();
  private readonly submissions = new Map<string, Submission>();
  private signerQueue: Promise<unknown> = Promise.resolve();
  private recoveryCursor = 0;
  private journalWrite: Promise<void> = Promise.resolve();
  private constructor(private readonly url: string, private readonly contract: NearAccount, private readonly journalPath: string, private readonly caller: NearAccount) {}

  static async open(url: string, contract: NearAccount, journalPath: string, caller: NearAccount = contract): Promise<ReceiptProofRelay> {
    const relay = new ReceiptProofRelay(url, contract, journalPath, caller);
    try {
      const data = JSON.parse(await readFile(journalPath, 'utf8')) as {contract_id?: unknown; attempts?: unknown; submissions?: unknown};
      if (data.contract_id !== contract.accountId || !data.attempts || typeof data.attempts !== 'object' || Array.isArray(data.attempts)) throw new Error('Invalid payment receipt journal');
      for (const [predictionId, attempt] of Object.entries(data.attempts)) {
        if (!/^[1-9][0-9]*$/.test(predictionId) || !isAttempt(attempt)) throw new Error('Invalid payment attempt in receipt journal');
        relay.attempts.set(predictionId, attempt);
      }
      if (data.submissions !== undefined) {
        if (!data.submissions || typeof data.submissions !== 'object' || Array.isArray(data.submissions)) throw new Error('Invalid submission journal');
        for (const [hash, value] of Object.entries(data.submissions)) {
          const submission = value as Submission;
          if (!submission || submission.hash !== hash || typeof submission.signerId !== 'string' || typeof submission.signedTransaction !== 'string') throw new Error('Invalid staged transaction');
          relay.submissions.set(hash, submission);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return relay;
  }

  private persist(): Promise<void> {
    const bytes = JSON.stringify({contract_id: this.contract.accountId, attempts: Object.fromEntries(this.attempts), submissions: Object.fromEntries(this.submissions)});
    this.journalWrite = this.journalWrite.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.journalPath), {recursive: true});
      const temporaryPath = `${this.journalPath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaryPath, bytes, {mode: 0o600, flush: true});
        await rename(temporaryPath, this.journalPath);
      } finally {
        await rm(temporaryPath, {force: true});
      }
    });
    return this.journalWrite;
  }

  private withSigner<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.signerQueue.catch(() => undefined).then(operation);
    this.signerQueue = result;
    return result;
  }

  /** Durably record the exact signed transaction before any broadcast. */
  async stage(method: string, args: Record<string, string>): Promise<Submission> {
    return this.withSigner(() => this.stageTransaction(method, args));
  }

  private async stageTransaction(method: string, args: Record<string, string>): Promise<Submission> {
    const key = await this.caller.getKey();
    if (!key) throw new Error('The local receipt relayer signing key is unavailable');
    const publicKey = key.getPublicKey();
    const [access, block] = await Promise.all([
      rpc<{nonce: number | string}>(this.url, 'query', {request_type: 'view_access_key', finality: 'optimistic', account_id: this.caller.accountId, public_key: publicKey.toString()}),
      rpc<{header: {hash: string}}>(this.url, 'block', {finality: 'optimistic'}),
    ]);
    if (typeof access.nonce === 'number' && !Number.isSafeInteger(access.nonce)) throw new Error('Invalid relayer nonce');
    const transaction = createTransaction(this.caller.accountId, publicKey, this.contract.accountId, BigInt(access.nonce) + 1n,
      [functionCall(method, args, 250n * 10n ** 12n, 0n)], base_decode(block.header.hash));
    const digest = createHash('sha256').update(transaction.encode()).digest();
    const signature = new Signature({keyType: publicKey.keyType, data: key.sign(digest).signature});
    const signed = new SignedTransaction({transaction, signature});
    const submission = {hash: base_encode(digest), signerId: this.caller.accountId, signedTransaction: Buffer.from(signed.encode()).toString('base64')};
    this.submissions.set(submission.hash, submission);
    await this.persist();
    return submission;
  }

  async submit(method: string, args: Record<string, string>): Promise<{succeeded: boolean; result: Execution}> {
    const submission = await this.withSigner(async () => {
      const staged = await this.stageTransaction(method, args);
      await rpc(this.url, 'broadcast_tx_async', [staged.signedTransaction]);
      // Hold the signer until the nonce is consumed, so header/proof calls
      // cannot accidentally reuse a staged payment transaction's nonce.
      await rpc(this.url, 'tx', {tx_hash: staged.hash, sender_account_id: staged.signerId, wait_until: 'INCLUDED'});
      return staged;
    });
    const result = await this.refreshSubmission(submission, 'EXECUTED_OPTIMISTIC');
    const status = result.status;
    return {succeeded: typeof status === 'object' && status !== null && ('SuccessValue' in status || 'SuccessReceiptId' in status), result};
  }

  private async refreshSubmission(submission: Submission, waitUntil: string): Promise<Execution> {
    const result = await rpc<Execution>(this.url, 'tx', {tx_hash: submission.hash, sender_account_id: submission.signerId, wait_until: waitUntil});
    const captured = await this.observe({result});
    // INCLUDED may have no source receipt yet. Retain the transaction until
    // all required effects are journaled or the node reports full execution.
    if (captured || ['EXECUTED_OPTIMISTIC', 'EXECUTED', 'FINAL'].includes(result.final_execution_status ?? '')) {
      this.submissions.delete(submission.hash);
      await this.persist();
    }
    return result;
  }

  async recoverSubmitted(): Promise<void> {
    const pending = [...this.submissions.values()];
    if (pending.length === 0) return;
    const submission = pending[this.recoveryCursor % pending.length];
    this.recoveryCursor = (this.recoveryCursor + 1) % pending.length;
    try {
      await this.refreshSubmission(submission, 'INCLUDED');
    } catch {
      // An interrupted submission may not have reached the node. Replaying
      // these identical signed bytes cannot execute a second transaction.
      try {
        await this.withSigner(async () => {
          await rpc(this.url, 'broadcast_tx_async', [submission.signedTransaction]);
          await rpc(this.url, 'tx', {tx_hash: submission.hash, sender_account_id: submission.signerId, wait_until: 'INCLUDED'});
        });
      } catch { /* Recheck its original hash next tick. */ }
    }
  }

  async observe(result: Observation): Promise<boolean> {
    let recorded = false;
    let captured = false;
    if (!Array.isArray(result.result.receipts_outcome) || result.result.receipts_outcome.length > 512) throw new Error('Invalid receipt observation size');
    for (const source of result.result.receipts_outcome) {
      if (source.outcome.executor_id !== this.contract.accountId) continue;
      const status = source.outcome.status;
      if (!status || typeof status !== 'object' || !('SuccessValue' in status || 'SuccessReceiptId' in status)) continue;
      if (!Array.isArray(source.outcome.logs) || source.outcome.logs.length > 64 || !Array.isArray(source.outcome.receipt_ids) || source.outcome.receipt_ids.length > 128) continue;
      try { if (base_decode(source.id).length !== 32 || source.outcome.receipt_ids.some(id => base_decode(id).length !== 32)) continue; } catch { continue; }
      let childIndex = 0;
      let valid = true;
      const effects: {event: AttemptEvent; index: number}[] = [];
      for (const log of source.outcome.logs) {
        if (log === 'RECKON_ORACLE_PROMISE') { childIndex += 1; continue; }
        const event = typeof log === 'string' && log.startsWith(EVENT_PREFIX) ? parseAttemptEvent(log) : null;
        if (!event) { valid = false; break; }
        effects.push({event, index: childIndex});
        childIndex += 2;
      }
      const children = source.outcome.receipt_ids;
      if (!valid || children.length !== childIndex + 1 || !children.every(id => typeof id === 'string')) continue;
      for (const {event, index} of effects) {
        const transferId = children[index];
        if (transferId === children[index + 1]) continue;
        captured = true;
        const previous = this.attempts.get(event.prediction_id);
        if (!previous || BigInt(previous.attemptId) <= BigInt(event.attempt_id)) {
          this.attempts.set(event.prediction_id, {attemptId: event.attempt_id, sourceId: source.id, transferId, beneficiary: event.beneficiary_account_id});
          recorded = true;
        }
      }
    }
    if (recorded) await this.persist();
    return captured;
  }

  async forget(predictionId: string, attemptId?: string): Promise<void> {
    if ((attemptId === undefined || this.attempts.get(predictionId)?.attemptId === attemptId) && this.attempts.delete(predictionId)) await this.persist();
  }

  async proofs(predictionId: string, payment: PendingPayment): Promise<{source_proof: OutcomeProof; transfer_proof: OutcomeProof}> {
    const attempt = this.attempts.get(predictionId);
    if (!attempt || attempt.attemptId !== payment.attempt_id || attempt.beneficiary !== payment.beneficiary_account_id) throw new Error('The payment receipt has not been observed yet');
    for (let attemptNumber = 0; attemptNumber < 8; attemptNumber++) {
      const head = await this.advanceHead();
      const proof = (receiptId: string, receiver: string) => rpc<OutcomeProof>(this.url, 'light_client_proof', {
        type: 'receipt', receipt_id: receiptId, receiver_id: receiver, light_client_head: head.hash,
      });
      try {
        const [source_proof, transfer_proof] = await Promise.all([
          proof(attempt.sourceId, this.contract.accountId), proof(attempt.transferId, attempt.beneficiary),
        ]);
        return {source_proof: {...source_proof, light_client_head: head.hash}, transfer_proof: {...transfer_proof, light_client_head: head.hash}};
      } catch (error) {
        if (attemptNumber === 7) throw error;
        // Execution may finish before its outcome commitment is finalized.
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    throw new Error('Finalized payment proofs are not yet available');
  }

  private async advanceHead(): Promise<Head> {
    let head = await this.contract.view<Head>('receipt_verifier_head', {});
    const target = await rpc<{header: {height: number}}>(this.url, 'block', {finality: 'final'});
    // Cross at most eight epochs per call; future keeper ticks resume here.
    for (let count = 0; count < 8 && BigInt(head.height) < BigInt(target.header.height); count++) {
      const header = await rpc<Header | null>(this.url, 'next_light_client_block', {last_block_hash: head.hash});
      if (!header || BigInt(header.inner_lite.height) <= BigInt(head.height)) break;
      const update = await this.withSigner(() => this.caller.callRaw(this.contract, 'update_receipt_verifier', {header}, {gas: 250n * 10n ** 12n}));
      if (!update.succeeded) throw new Error('The contract rejected the finalized header');
      head = await this.contract.view<Head>('receipt_verifier_head', {});
    }
    return head;
  }

  async reconcile(predictionId: string, payment: PendingPayment): Promise<TransactionResult> {
    const proofs = await this.proofs(predictionId, payment);
    const result = await this.withSigner(() => this.caller.callRaw(this.contract, 'reconcile_payment', {prediction_id: predictionId, ...proofs}, {gas: 250n * 10n ** 12n}));
    if (result.succeeded) await this.forget(predictionId, payment.attempt_id);
    return result;
  }
}
