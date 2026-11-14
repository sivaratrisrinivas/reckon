import assert from 'node:assert/strict';
import {sizeAllowance, sizeReserve, type Assumptions, type RecordedLiveObservations, type SizingMeasurements} from '../rehearsal-sizing.js';

// Round numbers so every expected value below is worked by hand rather than recomputed with the module's formula.
const unit = 10n ** 20n; // 0.0001 NEAR
const measured: SizingMeasurements = {
  publication_burn_yocto: 2n * unit, // 0.0002 NEAR
  publication_net_account_cost_yocto: unit, // 0.0001 NEAR
  required_allowance_yocto: {'30': 300n * unit, '250': 2_500n * unit}, // 0.03 and 0.25 NEAR
  state_bytes_per_prediction: 500n,
  storage_byte_cost_yocto: 10n ** 19n,
  code_bytes: 400_000n,
};
const live: RecordedLiveObservations = {oracle_worker_charge_worst_yocto: 15n * unit, oracle_attached_deposit_yocto: 200n * unit};
const assumptions: Assumptions = {
  horizon_days: 10n, publications_per_day: 10n, gas_price_headroom: 2n, gas_burn_headroom: 3n, failed_call_percent: 10n,
  storage_headroom_percent: 150n, settlement_cost_headroom: 2n, unmodelled_margin_percent: 20n, prepaid_gas_tgas: '30', allowance_rounding_yocto: 10n ** 22n,
};

// 10 days x 10 per day = 100 publications; 10% more failing calls = 10; 110 calls in total.
// Each call burns 0.0002 NEAR x 3 (burn headroom) x 2 (price headroom) = 0.0012 NEAR, so 110 calls = 0.132 NEAR.
// The floor is 0.03 NEAR x 2 = 0.06 NEAR. Allowance = 0.192 NEAR, which rounds up to 0.20 NEAR.
const allowance = sizeAllowance(measured, assumptions);
assert.equal(allowance.publications_covered, '100');
assert.equal(allowance.failed_permitted_calls_covered, '10');
assert.equal(allowance.burn_budget_yocto, (1_320n * unit).toString());
assert.equal(allowance.floor_the_network_reserves_with_headroom_yocto, (600n * unit).toString());
assert.equal(allowance.proposed_allowance_yocto, (2_000n * unit).toString());
// Attaching 250 Tgas instead raises the floor to 0.25 x 2 = 0.5 NEAR: 0.5 + 0.132 = 0.632 rounds up to 0.64 NEAR.
assert.equal(sizeAllowance(measured, assumptions, '250').proposed_allowance_yocto, (6_400n * unit).toString());
assert.throws(() => sizeAllowance(measured, assumptions, '77'), /No measured required allowance/);

// Reserve parts in units of 0.0001 NEAR.
// Code: 400,000 bytes x 0.00001 = 4 NEAR = 40,000. State: 100 x 500 bytes x 0.00001 x 1.5 = 0.75 NEAR = 7,500.
// Publication gas: 110 calls x 0.0001 NEAR x 3 x 2 = 0.066 NEAR = 660. Oracle: 100 x 0.0015 x 2 = 0.3 NEAR = 3,000.
// Deposit float 0.02 NEAR = 200. One-publication floor 0.06 NEAR = 600. Subtotal 52,000 = 5.2 NEAR; with a 20% margin 6.24 NEAR, already a multiple of the 0.01 NEAR rounding step.
const reserve = sizeReserve(measured, live, assumptions);
assert.deepEqual(reserve.components_yocto, {
  code_storage_stake_locked_at_deployment_yocto: (40_000n * unit).toString(),
  state_storage_stake_yocto: (7_500n * unit).toString(),
  publication_gas_from_agent_balance_yocto: (660n * unit).toString(),
  oracle_worker_charges_recorded_live_worst_case_yocto: (3_000n * unit).toString(),
  oracle_request_deposit_float_yocto: (200n * unit).toString(),
  minimum_free_funds_for_one_publication_yocto: (600n * unit).toString(),
});
assert.equal(reserve.subtotal_yocto, (52_000n * unit).toString());
assert.equal(reserve.proposed_operational_reserve_yocto, (62_400n * unit).toString());
console.log('Reserve and allowance sizing matches hand-worked examples');
