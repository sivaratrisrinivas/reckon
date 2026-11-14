// Offline: compares a live rehearsal log with the local sandbox numbers. No network, no keys.
//
//   tsx scripts/rehearsal/compare-evidence.ts --log .local/rehearsal/<account>/log.json [--local docs/evidence/rehearsal-local-measurements.json]
//
// A ratio above the headroom assumed in docs/evidence/rehearsal-local-sizing.json (gas burn x2, gas price x4) means the
// proposed allowance or reserve must be re-derived from the live number before anything is made immutable.
import {readFile} from 'node:fs/promises';
import {parseOptions} from './guards.js';
import {required} from './common.js';

type Entry = Record<string, unknown> & {step?: string; method?: string};
type Operation = {gas_burnt: string; tokens_burnt_yocto: string; contract_net_yocto: string};

function ratio(live: unknown, local: unknown): string {
  if (live === null || live === undefined || local === null || local === undefined) return 'n/a';
  const a = BigInt(String(live));
  const b = BigInt(String(local));
  if (b === 0n) return 'n/a';
  return `${(Number(a * 1000n / b) / 1000).toFixed(2)}x`;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const log = JSON.parse(await readFile(required(options, '--log'), 'utf8')) as Entry[];
  const localPath = typeof options.get('--local') === 'string' ? options.get('--local') as string : 'docs/evidence/rehearsal-local-measurements.json';
  const local = JSON.parse(await readFile(localPath, 'utf8')) as {measured_by_this_task: {operations: Record<string, Operation>; required_allowance_per_publication_yocto_by_prepaid_gas: Record<string, string>; record: Record<string, string>}};
  const operations = local.measured_by_this_task.operations;
  const rows: [string, unknown, unknown][] = [];
  const first = (method: string) => log.find(entry => entry.method === method);
  const publication = first('publish_prediction');
  if (publication) {
    rows.push(['publication gas burnt', publication.gas_burnt, operations.publication_by_key.gas_burnt]);
    rows.push(['publication tokens burnt (yocto)', publication.tokens_burnt_yocto, operations.publication_by_key.tokens_burnt_yocto]);
    rows.push(['publication allowance consumed (yocto)', publication.allowance_consumed_yocto, operations.publication_by_key.tokens_burnt_yocto]);
    const account = String(publication.account);
    rows.push(['publication net balance fall of the agent (yocto)', (publication.net_balance_fall_yocto as Record<string, string>)[account], operations.publication_by_key.contract_net_yocto]);
  }
  const take = first('challenge_prediction');
  if (take) rows.push(['take gas burnt', take.gas_burnt, operations.take.gas_burnt]);
  const retry = first('retry_payment');
  if (retry) rows.push(['retry_payment gas burnt', retry.gas_burnt, operations.retry_payment_success.gas_burnt]);
  const voided = first('void_unsettled_prediction');
  if (voided) rows.push(['void gas burnt', voided.gas_burnt, operations.void_with_refund_paid.gas_burnt]);
  const probe = log.find(entry => entry.step === 'probe-allowance');
  if (probe) {
    const live = probe.required_allowance_yocto_by_prepaid_gas as Record<string, string>;
    for (const [gas, value] of Object.entries(live)) rows.push([`required allowance at ${gas.replace('_', ' ')} (yocto)`, value, local.measured_by_this_task.required_allowance_per_publication_yocto_by_prepaid_gas[gas]]);
  }
  const snapshots = log.filter(entry => entry.step === 'snapshot');
  const roundTrip = log.filter(entry => entry.step === 'wait-resolved').map(entry => entry.oracle_round_trip_chain_seconds);
  console.log('metric | live | local sandbox | live / local');
  for (const [name, live, localValue] of rows) console.log(`${name} | ${String(live)} | ${String(localValue)} | ${ratio(live, localValue)}`);
  console.log(`snapshots recorded: ${snapshots.length}; oracle round trips (chain seconds, live only): ${JSON.stringify(roundTrip)}`);
  console.log('Local oracle round trip is a few blocks with no worker fee; compare the live values with the 120 s window and the recorded 50.356 s maximum.');
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
