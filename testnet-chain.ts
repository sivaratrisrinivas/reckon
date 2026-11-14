import {Account, Connection, InMemorySigner, KeyPair, keyStores, providers} from 'near-api-js';
import {functionCall} from 'near-api-js/lib/transaction.js';
import type {OnChainPrediction, PredictionChain, PredictionQuote} from './forecast.js';

// Prepaid gas is priced upfront at 1e9 yoctoNEAR per gas (0.001 NEAR per Tgas) and the unused part is
// refunded, so a key allowance must exceed the largest prepaid amount even though little is spent.
export const PUBLISH_GAS_DEFAULT = 50n * 10n ** 12n;
// request_settlement forwards 200 Tgas to the oracle itself, so the caller must cover it.
export const SETTLEMENT_GAS_DEFAULT = 240n * 10n ** 12n;
export const RECOVERY_GAS_DEFAULT = 80n * 10n ** 12n;

export type KeeperMethod = 'request_settlement' | 'void_unsettled_prediction' | 'retry_payment';

export type NearChainOptions = {
  networkId: string;
  rpcUrl: string;
  contractId: string;
  /** Secret of the restricted key that may only call publish_prediction on the agent account. */
  predictionSecretKey: string;
  keeperAccountId: string;
  /** Secret of the keeper key; the keeper never needs to move funds. */
  keeperSecretKey: string;
  publishGas?: bigint;
  settlementGas?: bigint;
  recoveryGas?: bigint;
};

export type CallResult = {
  transactionHash: string;
  succeeded: boolean;
  failure: string | null;
  gasBurnt: bigint;
};

export type AccessKeyDescription =
  | {kind: 'full-access'}
  | {kind: 'function-call'; allowance: bigint | null; receiverId: string; methodNames: string[]};

/**
 * Signs with keys the service holds and reads with the configured RPC. Used for testnet mode:
 * the prediction key can only publish; the keeper key can only settle, void and retry payments.
 * No key for the agent account's full-access authority is ever loaded here.
 */
export class NearChain {
  private readonly provider: providers.JsonRpcProvider;
  private readonly predictionAccount: Account;
  private readonly keeperAccount: Account;

  constructor(private readonly options: NearChainOptions) {
    this.provider = new providers.JsonRpcProvider({url: options.rpcUrl});
    const keyStore = new keyStores.InMemoryKeyStore();
    // Both signers share one in-memory store; a key is selected by account id and network.
    this.predictionAccount = this.accountFor(keyStore, options.contractId, options.predictionSecretKey);
    this.keeperAccount = this.accountFor(keyStore, options.keeperAccountId, options.keeperSecretKey);
  }

  private accountFor(keyStore: keyStores.InMemoryKeyStore, accountId: string, secretKey: string): Account {
    void keyStore.setKey(this.options.networkId, accountId, KeyPair.fromString(secretKey as `ed25519:${string}`));
    const connection = new Connection(this.options.networkId, this.provider, new InMemorySigner(keyStore), '');
    return new Account(connection, accountId);
  }

  async view<T>(method: string, args: Record<string, unknown> = {}, finality: 'optimistic' | 'final' = 'optimistic'): Promise<T> {
    const response = await this.provider.query({
      request_type: 'call_function',
      finality,
      account_id: this.options.contractId,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
    }) as unknown as {result: number[]};
    return JSON.parse(Buffer.from(response.result).toString('utf8')) as T;
  }

  predictionChain(): PredictionChain {
    return {
      activePrediction: () => this.view<OnChainPrediction | null>('active_prediction'),
      quotePrediction: confidencePpm => this.view<PredictionQuote>('quote_prediction', {confidence_ppm: confidencePpm}),
      publishPrediction: async input => {
        const result = await this.send(this.predictionAccount, 'publish_prediction', input, this.options.publishGas ?? PUBLISH_GAS_DEFAULT);
        if (!result.succeeded) throw new Error(result.failure ?? 'Prediction publication failed');
        const prediction = await this.view<OnChainPrediction | null>('active_prediction');
        if (!prediction || prediction.evidence_hash !== input.evidence_hash) throw new Error('Published prediction was not found on chain');
        return prediction;
      },
    };
  }

  keeperCall(method: KeeperMethod, args: Record<string, string>): Promise<CallResult> {
    const gas = method === 'request_settlement'
      ? this.options.settlementGas ?? SETTLEMENT_GAS_DEFAULT
      : this.options.recoveryGas ?? RECOVERY_GAS_DEFAULT;
    return this.send(this.keeperAccount, method, args, gas);
  }

  async accessKeyAllowance(accountId: string, publicKey: string): Promise<AccessKeyDescription | null> {
    let response: {permission: 'FullAccess' | {FunctionCall: {allowance: string | null; receiver_id: string; method_names: string[]}}};
    try {
      response = await this.provider.query({
        request_type: 'view_access_key',
        finality: 'optimistic',
        account_id: accountId,
        public_key: publicKey,
      }) as unknown as typeof response;
    } catch (error) {
      if (error instanceof Error && /does not exist|UnknownAccessKey/.test(`${error.name} ${error.message}`)) return null;
      throw error;
    }
    if (response.permission === 'FullAccess') return {kind: 'full-access'};
    const permission = response.permission.FunctionCall;
    return {
      kind: 'function-call',
      allowance: permission.allowance === null ? null : BigInt(permission.allowance),
      receiverId: permission.receiver_id,
      methodNames: permission.method_names,
    };
  }

  async optimisticBlockTimestampNs(): Promise<bigint> {
    const block = await this.provider.block({finality: 'optimistic'});
    return BigInt(block.header.timestamp_nanosec);
  }

  private async send(account: Account, method: string, args: Record<string, unknown>, gas: bigint): Promise<CallResult> {
    const outcome = await account.signAndSendTransaction({
      receiverId: this.options.contractId,
      actions: [functionCall(method, args, gas, 0n)],
      returnError: true,
    });
    const failure = findFailure(outcome);
    return {
      transactionHash: outcome.transaction_outcome.id,
      succeeded: failure === null,
      failure,
      gasBurnt: totalGasBurnt(outcome),
    };
  }
}

type OutcomeLike = {
  status: unknown;
  transaction_outcome: {id: string; outcome: {gas_burnt: number | string}};
  receipts_outcome: Array<{outcome: {gas_burnt: number | string; status: unknown}}>;
};

function findFailure(outcome: OutcomeLike): string | null {
  const statuses = [outcome.status, ...outcome.receipts_outcome.map(receipt => receipt.outcome.status)];
  for (const status of statuses) {
    if (typeof status === 'object' && status !== null && 'Failure' in status && status.Failure) {
      return JSON.stringify(status.Failure);
    }
  }
  return null;
}

function totalGasBurnt(outcome: OutcomeLike): bigint {
  return [outcome.transaction_outcome.outcome, ...outcome.receipts_outcome.map(receipt => receipt.outcome)]
    .reduce((sum, entry) => sum + BigInt(entry.gas_burnt), 0n);
}
