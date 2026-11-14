// Reserve and publication-key allowance sizing derived from measured numbers.
// Measured inputs come from the local sandbox with a fixture oracle (not live). Every assumption below is PROPOSED:
// it needs live measurement and an explicit decision before any immutable configuration.

export type SizingMeasurements = {
  /** Largest allowance one publication consumed once unused prepaid gas was credited back. */
  publication_burn_yocto: bigint;
  /** Largest net fall in the agent account's balance for one key-signed publication. */
  publication_net_account_cost_yocto: bigint;
  /** Allowance the network requires up front, by prepaid gas in Tgas (read from NotEnoughAllowance). */
  required_allowance_yocto: Record<string, bigint>;
  state_bytes_per_prediction: bigint;
  storage_byte_cost_yocto: bigint;
  code_bytes: bigint;
};

/** Costs recorded by earlier human-run testnet probes (docs/evidence/testnet-latency-cost-samples.json), not measured here. */
export type RecordedLiveObservations = {
  oracle_worker_charge_worst_yocto: bigint;
  oracle_attached_deposit_yocto: bigint;
};

export type Assumptions = {
  horizon_days: bigint;
  publications_per_day: bigint;
  gas_price_headroom: bigint;
  gas_burn_headroom: bigint;
  failed_call_percent: bigint;
  storage_headroom_percent: bigint;
  settlement_cost_headroom: bigint;
  unmodelled_margin_percent: bigint;
  prepaid_gas_tgas: string;
  allowance_rounding_yocto: bigint;
};

export const PROPOSED_ASSUMPTIONS: Assumptions = {
  horizon_days: 30n,
  // The live model-call budget allows twelve attempts per UTC day, and a publication needs an attempt.
  publications_per_day: 12n,
  gas_price_headroom: 4n,
  gas_burn_headroom: 2n,
  failed_call_percent: 20n,
  storage_headroom_percent: 125n,
  settlement_cost_headroom: 2n,
  unmodelled_margin_percent: 25n,
  prepaid_gas_tgas: '30',
  allowance_rounding_yocto: 10n ** 22n,
};

const ceilDiv = (numerator: bigint, denominator: bigint) => (numerator + denominator - 1n) / denominator;
const roundUp = (value: bigint, step: bigint) => ceilDiv(value, step) * step;

export function sizeAllowance(measured: SizingMeasurements, assumptions: Assumptions, prepaidGasTgas: string = assumptions.prepaid_gas_tgas) {
  const required = measured.required_allowance_yocto[prepaidGasTgas];
  if (required === undefined) throw new Error(`No measured required allowance for ${prepaidGasTgas} Tgas`);
  const publications = assumptions.horizon_days * assumptions.publications_per_day;
  const failedCalls = ceilDiv(publications * assumptions.failed_call_percent, 100n);
  const calls = publications + failedCalls;
  const burnPerCall = measured.publication_burn_yocto * assumptions.gas_burn_headroom * assumptions.gas_price_headroom;
  const burnBudget = calls * burnPerCall;
  // A rise in gas price lifts the amount the network reserves before accepting a call, so the floor carries the same headroom.
  const floor = required * assumptions.gas_price_headroom;
  const allowance = roundUp(floor + burnBudget, assumptions.allowance_rounding_yocto);
  return {
    prepaid_gas_tgas: prepaidGasTgas,
    publications_covered: publications.toString(),
    failed_permitted_calls_covered: failedCalls.toString(),
    burn_per_call_with_headroom_yocto: burnPerCall.toString(),
    burn_budget_yocto: burnBudget.toString(),
    floor_the_network_reserves_with_headroom_yocto: floor.toString(),
    proposed_allowance_yocto: allowance.toString(),
    // A holder of the key can spend at most this much of the account's gas through it, whatever it attaches.
    maximum_gas_exposure_through_key_yocto: allowance.toString(),
    unusable_remainder_when_exhausted_at_most_yocto: floor.toString(),
  };
}

export function sizeReserve(measured: SizingMeasurements, live: RecordedLiveObservations, assumptions: Assumptions, prepaidGasTgas: string = assumptions.prepaid_gas_tgas) {
  const required = measured.required_allowance_yocto[prepaidGasTgas];
  if (required === undefined) throw new Error(`No measured required allowance for ${prepaidGasTgas} Tgas`);
  const publications = assumptions.horizon_days * assumptions.publications_per_day;
  const calls = publications + ceilDiv(publications * assumptions.failed_call_percent, 100n);
  const codeStorage = measured.code_bytes * measured.storage_byte_cost_yocto;
  const stateStorage = ceilDiv(publications * measured.state_bytes_per_prediction * measured.storage_byte_cost_yocto * assumptions.storage_headroom_percent, 100n);
  const publicationGas = calls * measured.publication_net_account_cost_yocto * assumptions.gas_burn_headroom * assumptions.gas_price_headroom;
  const oracleWorker = publications * live.oracle_worker_charge_worst_yocto * assumptions.settlement_cost_headroom;
  const oracleDepositFloat = live.oracle_attached_deposit_yocto;
  const gasFloor = required * assumptions.gas_price_headroom;
  const components = {
    code_storage_stake_locked_at_deployment_yocto: codeStorage,
    state_storage_stake_yocto: stateStorage,
    publication_gas_from_agent_balance_yocto: publicationGas,
    oracle_worker_charges_recorded_live_worst_case_yocto: oracleWorker,
    oracle_request_deposit_float_yocto: oracleDepositFloat,
    minimum_free_funds_for_one_publication_yocto: gasFloor,
  };
  const subtotal = Object.values(components).reduce((sum, value) => sum + value, 0n);
  const total = roundUp(ceilDiv(subtotal * (100n + assumptions.unmodelled_margin_percent), 100n), assumptions.allowance_rounding_yocto);
  return {
    prepaid_gas_tgas: prepaidGasTgas,
    components_yocto: Object.fromEntries(Object.entries(components).map(([name, value]) => [name, value.toString()])),
    subtotal_yocto: subtotal.toString(),
    proposed_operational_reserve_yocto: total.toString(),
  };
}
