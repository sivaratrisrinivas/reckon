import type {Worker} from 'near-workspaces';

export * from '../rehearsal-rpc.js';

export type SandboxLife = {
  spendable_bankroll: string;
  committed_bankroll: string;
  challenger_custody: string;
  retired_bankroll: string;
  operational_reserve: string;
  pending_payment_liabilities: string;
  remaining_life_ns: string;
  dead: boolean;
};

export function sandboxUrl(worker: Worker): string {
  return (worker.provider as unknown as {connection: {url: string}}).connection.url;
}

export const predictionArgs = (id: number, decision: 'yes' | 'no' = 'no', evidenceUrl?: string) => ({
  reference_multiplier: '340823333',
  reference_decimals: 8,
  decision,
  confidence_ppm: 850_000,
  evidence_hash: id.toString(16).padStart(64, '0'),
  evidence_url: evidenceUrl ?? `https://evidence.reckon.invalid/${id.toString(16).padStart(64, '0')}.json`,
});
