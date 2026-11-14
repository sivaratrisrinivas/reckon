import assert from 'node:assert/strict';
import {assessOperations, explainPublicationFailure, type OperationalInputs} from '../operational.js';

const NEAR = 10n ** 24n;
const milli = (thousandths: bigint) => (NEAR * thousandths) / 1_000n;
// Worked example. Funds held: 120 NEAR. Code and state storage: 440,000 bytes at 0.00001 NEAR per byte = 4.4 NEAR.
// Recorded obligations: 100 NEAR. Free reserve = 120 - 4.4 - 100 = 15.6 NEAR.
const healthy: OperationalInputs = {
  dead: false,
  keyAllowance: 5n * NEAR,
  requiredAllowance: milli(250n),
  burnPerPublication: milli(1n) / 5n, // 0.0002 NEAR
  accountAmount: 120n * NEAR,
  storageUsage: 440_000n,
  storageByteCost: 10n ** 19n,
  recordedObligations: 100n * NEAR,
};

const ok = assessOperations(healthy);
assert.equal(ok.publication_available, true);
assert.equal(ok.operational_unavailability, null);
assert.equal(ok.reason, null);
assert.equal(ok.reserve.free_reserve_yocto, (15_600n * 10n ** 21n).toString());
assert.equal(ok.reserve.adequate, true);
// (5 - 0.25) NEAR / 0.0002 NEAR = 23,750 further publications after the first.
assert.equal(ok.publication_key.publications_remaining, 23_751);

const exhausted = assessOperations({...healthy, keyAllowance: milli(200n)});
assert.equal(exhausted.publication_available, false);
assert.equal(exhausted.operational_unavailability, 'publication_key_allowance_exhausted');
assert.equal(exhausted.dead, false);
assert.equal(exhausted.publication_key.publications_remaining, 0);
assert.match(exhausted.reason ?? '', /allowance is exhausted/);
assert.match(exhausted.reason ?? '', /not dead/);
assert.doesNotMatch(exhausted.reason ?? '', /permanently dead/);

// The boundary is exact: an allowance equal to the requirement can still publish once.
assert.equal(assessOperations({...healthy, keyAllowance: milli(250n)}).publication_key.publications_remaining, 1);
assert.equal(assessOperations({...healthy, keyAllowance: milli(250n) - 1n}).publication_available, false);

const missing = assessOperations({...healthy, keyAllowance: null});
assert.equal(missing.operational_unavailability, 'publication_key_missing');
assert.equal(missing.publication_available, false);

// Funds held 105 NEAR - 4.4 NEAR storage - 100.5 NEAR recorded obligations = 0.1 NEAR free, below the 0.25 NEAR minimum.
const thin = assessOperations({...healthy, accountAmount: 105n * NEAR, recordedObligations: 100_500n * 10n ** 21n});
assert.equal(thin.reserve.free_reserve_yocto, (100n * 10n ** 21n).toString());
assert.equal(thin.reserve.adequate, false);
assert.equal(thin.operational_unavailability, 'operational_reserve_depleted');
assert.match(thin.reason ?? '', /reserve/);
// Obligations that exceed funds produce a negative reserve, never an exception.
assert.equal(assessOperations({...healthy, accountAmount: 90n * NEAR}).reserve.free_reserve_yocto, (-14_400n * 10n ** 21n).toString());

// Death is reported separately and is never an operational cause.
const dead = assessOperations({...healthy, dead: true});
assert.equal(dead.dead, true);
assert.equal(dead.operational_unavailability, null);
assert.equal(dead.publication_available, false);
const deadAndExhausted = assessOperations({...healthy, dead: true, keyAllowance: 0n});
assert.equal(deadAndExhausted.dead, true);
assert.equal(deadAndExhausted.operational_unavailability, 'publication_key_allowance_exhausted', 'both conditions stay visible');

// A rejection by the network while publishing maps to the same operational cause as the preflight.
assert.equal(explainPublicationFailure(new Error('{"InvalidTxError":{"InvalidAccessKeyError":{"NotEnoughAllowance":{"allowance":"1"}}}}'))?.cause, 'publication_key_allowance_exhausted');
assert.equal(explainPublicationFailure(new Error('Smart contract panicked: Reckon is permanently dead')), null);
console.log('Operational assessment separates allowance exhaustion, reserve depletion and death');
