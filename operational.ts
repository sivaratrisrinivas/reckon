// Operational readiness of the agent account, kept separate from bankroll death.
// The contract cannot read its own access keys, so the service reads the publication key's remaining allowance
// and the account's funds over RPC and reports them next to the contract's own `life` view.

export type OperationalUnavailability =
  | 'publication_key_allowance_exhausted'
  | 'publication_key_missing'
  | 'operational_reserve_depleted';

export type OperationalInputs = {
  dead: boolean;
  /** Remaining allowance of the publication key; null when the key is not on the account. */
  keyAllowance: bigint | null;
  /** Allowance the network requires up front for one publication (prepaid gas is reserved, unused gas is credited back). */
  requiredAllowance: bigint;
  /** Allowance one publication actually consumes once unused prepaid gas is credited back. */
  burnPerPublication: bigint;
  accountAmount: bigint;
  storageUsage: bigint;
  storageByteCost: bigint;
  /** Spendable + committed + challenger custody + retired + pending payment liabilities. */
  recordedObligations: bigint;
};

export type OperationalState = {
  dead: boolean;
  publication_available: boolean;
  operational_unavailability: OperationalUnavailability | null;
  reason: string | null;
  publication_key: {allowance_yocto: string | null; required_allowance_yocto: string; publications_remaining: number};
  reserve: {free_reserve_yocto: string; minimum_free_reserve_yocto: string; adequate: boolean};
};

const SUFFIX = 'Reckon is not dead and existing predictions still settle.';
const REASONS: Record<OperationalUnavailability, string> = {
  publication_key_allowance_exhausted: `Publication is unavailable: the prediction key's gas allowance is exhausted and adding funds cannot restore it. ${SUFFIX}`,
  publication_key_missing: `Publication is unavailable: the prediction key is not on the account. ${SUFFIX}`,
  operational_reserve_depleted: `Publication is unavailable: the operational reserve is below the minimum needed to pay for gas. ${SUFFIX}`,
};

export function assessOperations(inputs: OperationalInputs): OperationalState {
  const freeReserve = inputs.accountAmount - inputs.storageUsage * inputs.storageByteCost - inputs.recordedObligations;
  // The reserve must at least cover the allowance the network reserves for one publication.
  const reserveAdequate = freeReserve >= inputs.requiredAllowance;
  const allowance = inputs.keyAllowance;
  let unavailability: OperationalUnavailability | null = null;
  if (allowance === null) unavailability = 'publication_key_missing';
  else if (allowance < inputs.requiredAllowance) unavailability = 'publication_key_allowance_exhausted';
  else if (!reserveAdequate) unavailability = 'operational_reserve_depleted';
  const publicationsRemaining = allowance === null || allowance < inputs.requiredAllowance
    ? 0
    : Number((allowance - inputs.requiredAllowance) / inputs.burnPerPublication) + 1;
  return {
    dead: inputs.dead,
    publication_available: !inputs.dead && unavailability === null,
    operational_unavailability: unavailability,
    reason: unavailability ? REASONS[unavailability] : null,
    publication_key: {
      allowance_yocto: allowance === null ? null : allowance.toString(),
      required_allowance_yocto: inputs.requiredAllowance.toString(),
      publications_remaining: publicationsRemaining,
    },
    reserve: {
      free_reserve_yocto: freeReserve.toString(),
      minimum_free_reserve_yocto: inputs.requiredAllowance.toString(),
      adequate: reserveAdequate,
    },
  };
}

/** Maps a network rejection raised while publishing to the same cause the preflight reports. */
export function explainPublicationFailure(error: unknown): {cause: OperationalUnavailability; reason: string} | null {
  const message = error instanceof Error ? `${error.message} ${JSON.stringify(error.cause ?? '')}` : String(error);
  if (message.includes('NotEnoughAllowance')) {
    return {cause: 'publication_key_allowance_exhausted', reason: REASONS.publication_key_allowance_exhausted};
  }
  return null;
}

// Measured on the local NEAR sandbox 2.14.0 (protocol 88): the network required 10 x prepaid gas x gas price plus
// about 0.0009 NEAR of transaction fees as allowance before it would accept a publication. These are local sandbox
// values; the rehearsal must reconfirm them from a NotEnoughAllowance error on testnet before any lock.
export const ALLOWANCE_RESERVATION_FACTOR = 10n;
export const ALLOWANCE_FEE_OVERHEAD = 10n ** 21n;
// Allowance one local publication consumed after refunds (0.000216 NEAR); rounded up for estimates only.
export const ESTIMATED_BURN_PER_PUBLICATION = 3n * 10n ** 20n;

export function requiredPublicationAllowance(prepaidGas: bigint, gasPrice: bigint): bigint {
  return ALLOWANCE_RESERVATION_FACTOR * prepaidGas * gasPrice + ALLOWANCE_FEE_OVERHEAD;
}

type Rpc = (method: string, params: object) => Promise<unknown>;

export async function readOperationalInputs(rpc: Rpc, accountId: string, predictionPublicKey: string, prepaidGas: bigint, recordedObligations: bigint, dead: boolean): Promise<OperationalInputs> {
  const [key, account, price, config] = await Promise.all([
    rpc('query', {request_type: 'view_access_key', finality: 'optimistic', account_id: accountId, public_key: predictionPublicKey}) as Promise<{permission?: 'FullAccess' | {FunctionCall: {allowance: string | null}}}>,
    rpc('query', {request_type: 'view_account', finality: 'optimistic', account_id: accountId}) as Promise<{amount: string; storage_usage: number}>,
    rpc('gas_price', [null]) as Promise<{gas_price: string}>,
    rpc('EXPERIMENTAL_protocol_config', {finality: 'final'}) as Promise<{runtime_config: {storage_amount_per_byte: string}}>,
  ]);
  const permission = key.permission;
  let allowance: bigint | null = null;
  if (permission && permission !== 'FullAccess') {
    if (permission.FunctionCall.allowance === null) throw new Error('The prediction key must have a finite allowance');
    allowance = BigInt(permission.FunctionCall.allowance);
  }
  return {
    dead,
    keyAllowance: allowance,
    requiredAllowance: requiredPublicationAllowance(prepaidGas, BigInt(price.gas_price)),
    burnPerPublication: ESTIMATED_BURN_PER_PUBLICATION,
    accountAmount: BigInt(account.amount),
    storageUsage: BigInt(account.storage_usage),
    storageByteCost: BigInt(config.runtime_config.storage_amount_per_byte),
    recordedObligations,
  };
}
