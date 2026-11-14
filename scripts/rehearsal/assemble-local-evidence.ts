// Offline: combines captured test output into the labelled local evidence files under docs/evidence/.
// It reads log files and local tool versions only; it contacts no network and needs no key.
//
//   tsx scripts/rehearsal/assemble-local-evidence.ts --measurement-log <f> --complete-round-log <f> --payment-proof-log <f> [--out-dir docs/evidence]
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile, writeFile} from 'node:fs/promises';
import {PROPOSED_ASSUMPTIONS, sizeAllowance, sizeReserve, type RecordedLiveObservations, type SizingMeasurements} from '../../rehearsal-sizing.js';
import {parseOptions} from './guards.js';
import {required} from './common.js';

const LABEL = 'local sandbox with fixture oracle, not live';

async function markedJson(path: string, marker: string): Promise<Record<string, unknown>> {
  const line = (await readFile(path, 'utf8')).split('\n').find(candidate => candidate.startsWith(`${marker} `));
  if (!line) throw new Error(`${path} has no ${marker} line`);
  return JSON.parse(line.slice(marker.length + 1)) as Record<string, unknown>;
}

const run = (command: string, args: string[]) => execFileSync(command, args, {encoding: 'utf8'}).trim();
type OperationRecord = {tokens_burnt_yocto: string; contract_net_yocto: string; payer_net_yocto: string; gas_burnt: string; storage_delta_bytes: string};
const biggest = (values: bigint[]) => values.reduce((largest, value) => value > largest ? value : largest, 0n);

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const outDir = typeof options.get('--out-dir') === 'string' ? options.get('--out-dir') as string : 'docs/evidence';
  const measurement = await markedJson(required(options, '--measurement-log'), 'REHEARSAL_MEASUREMENT');
  const completeRound = await markedJson(required(options, '--complete-round-log'), 'COMPLETE_ROUND_MEASUREMENT');
  const paymentProof = await markedJson(required(options, '--payment-proof-log'), 'PAYMENT_PROOF_MEASUREMENT');
  const wasmPath = 'contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm';
  const wasm = await readFile(wasmPath);
  const cargoLock = await readFile('contract/Cargo.lock', 'utf8');
  const nearSdk = /name = "near-sdk"\nversion = "([^"]+)"/.exec(cargoLock)?.[1] ?? 'unknown';
  const provenance = {
    captured_on: new Date().toISOString().slice(0, 10),
    git_commit: run('git', ['rev-parse', 'HEAD']),
    node: process.version,
    rustc: run('rustc', ['--version']),
    near_sdk: nearSdk,
    near_sandbox: run(`${process.env.NEAR_SANDBOX_BINARY_PATH ?? '.local/sandbox'}/near-sandbox`, ['--version']).split('\n')[0],
    contract_wasm_sha256: createHash('sha256').update(wasm).digest('hex'),
    contract_wasm_bytes: wasm.byteLength,
    commands: [
      'npm run build:contract',
      'npx tsx tests/rehearsal-measurements.ts   (prints REHEARSAL_MEASUREMENT)',
      'npx tsx tests/settlement-contract.ts   (prints COMPLETE_ROUND_MEASUREMENT)',
      'sh scripts/with-archive-sandbox.sh npx tsx tests/payment-reconciliation.ts   (prints PAYMENT_PROOF_MEASUREMENT)',
      'npx tsx scripts/rehearsal/assemble-local-evidence.ts --measurement-log ... --complete-round-log ... --payment-proof-log ...',
    ],
    commands_run_through: './scripts/with-local-env.sh under the shared heavy-command lock',
  };

  const series = measurement.publication_series as OperationRecord[];
  const record = measurement.record as Record<string, string>;
  const environment = measurement.environment as Record<string, string>;
  const requiredByGas = measurement.required_allowance_per_publication_yocto_by_prepaid_gas as Record<string, string>;
  const sizingMeasurements: SizingMeasurements = {
    publication_burn_yocto: biggest(series.map(item => BigInt(item.tokens_burnt_yocto))),
    publication_net_account_cost_yocto: biggest(series.map(item => BigInt(item.contract_net_yocto))),
    required_allowance_yocto: Object.fromEntries(Object.entries(requiredByGas).map(([name, cost]) => [name.replace('_tgas', ''), BigInt(cost)])),
    state_bytes_per_prediction: BigInt(record.state_bytes_per_prediction_average),
    storage_byte_cost_yocto: BigInt(environment.storage_byte_cost_yocto),
    code_bytes: BigInt(environment.contract_wasm_bytes),
  };
  // Recorded by earlier human-run testnet probes (docs/research/price-settlement-feasibility.md); the worst of five worker charges.
  const live: RecordedLiveObservations = {oracle_worker_charge_worst_yocto: 1_482_900_100_000_000_000_000n, oracle_attached_deposit_yocto: 20_000_000_000_000_000_000_000n};
  const text = (value: Record<string, bigint | string>) => Object.fromEntries(Object.entries(value).map(([name, item]) => [name, item.toString()]));

  await writeFile(`${outDir}/rehearsal-local-measurements.json`, `${JSON.stringify({
    label: LABEL,
    warning: 'These numbers come from the production Wasm on a local NEAR sandbox with a fixture oracle that charges no worker fee and answers in a few blocks. They are not testnet measurements and do not establish live oracle cost, latency, gas price or model cost.',
    provenance,
    measured_by_this_task: measurement,
    reused_existing_measurements: {
      complete_round: {source: 'tests/settlement-contract.ts COMPLETE_ROUND_MEASUREMENT', value: completeRound},
      payment_receipt_reconciliation: {source: 'tests/payment-reconciliation.ts PAYMENT_PROOF_MEASUREMENT (archive sandbox, local only; the live initializer has no verifier)', value: paymentProof},
    },
  }, null, 2)}\n`);

  const sizing = {
    label: LABEL,
    status: 'PROPOSED: derived from local measurements and the assumptions below; not approved, not live-verified, not to be written into an immutable configuration',
    provenance,
    measured_inputs: {
      ...text({
        publication_burn_yocto: sizingMeasurements.publication_burn_yocto, publication_net_account_cost_yocto: sizingMeasurements.publication_net_account_cost_yocto,
        state_bytes_per_prediction: sizingMeasurements.state_bytes_per_prediction, storage_byte_cost_yocto: sizingMeasurements.storage_byte_cost_yocto, code_bytes: sizingMeasurements.code_bytes,
      }),
      required_allowance_yocto_by_prepaid_gas_tgas: text(sizingMeasurements.required_allowance_yocto),
    },
    recorded_live_observations_not_measured_here: {
      source: 'docs/evidence/testnet-latency-cost-samples.json and docs/research/price-settlement-feasibility.md (earlier human-run testnet probes)',
      ...text(live),
      note: 'Worst of five recorded oracle worker charges (0.0014829001 NEAR) and the 0.02 NEAR deposit attached to each refresh. The local fixture charges nothing.',
    },
    assumptions_all_proposed: Object.fromEntries(Object.entries(PROPOSED_ASSUMPTIONS).map(([name, value]) => [name, typeof value === 'bigint' ? value.toString() : value])),
    publication_key_allowance: {
      with_30_tgas_prepaid_gas: sizeAllowance(sizingMeasurements, PROPOSED_ASSUMPTIONS, '30'),
      with_250_tgas_prepaid_gas_as_the_service_attaches_today: sizeAllowance(sizingMeasurements, PROPOSED_ASSUMPTIONS, '250'),
      local_development_setting_yocto: (5n * 10n ** 24n).toString(),
      note: 'The network reserves a multiple of the attached gas from the allowance before accepting a call and credits unused gas back, so the floor depends on the attached gas while consumption depends on the gas burnt.',
    },
    operational_reserve: {
      with_30_tgas_prepaid_gas: sizeReserve(sizingMeasurements, live, PROPOSED_ASSUMPTIONS, '30'),
      with_250_tgas_prepaid_gas_as_the_service_attaches_today: sizeReserve(sizingMeasurements, live, PROPOSED_ASSUMPTIONS, '250'),
      local_development_setting_yocto: (20n * 10n ** 24n).toString(),
      excluded: 'Model inference cost (never measured), the keeper account that pays gas for settlement and recovery calls, and any funds at risk in bankroll, commitments or challenger custody.',
    },
    still_proposed_pending_live_measurement: ['settlement window 120 s', 'reference age (candle 180 s, oracle 600 s)', 'request cooldown 30 s', 'minimum stakes 0.01 and 0.001 NEAR', 'confidence range and rounding', 'model-call budget and spending limits', 'publication key allowance', 'operational reserve'],
  };
  await writeFile(`${outDir}/rehearsal-local-sizing.json`, `${JSON.stringify(sizing, null, 2)}\n`);
  console.log(`Wrote ${outDir}/rehearsal-local-measurements.json and ${outDir}/rehearsal-local-sizing.json`);
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
