// A model answer whose confidence cannot be quoted is never clamped: the service asks again within
// its call budget and publishes exactly the confidence the model then commits to, or publishes nothing.
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ForecastService, type FixtureScenario, type OnChainPrediction, type PredictionChain} from '../forecast.js';

async function run(scenario: FixtureScenario) {
  const directory = await mkdtemp(join(tmpdir(), 'reckon-reask-'));
  const published: Array<{confidence_ppm: number; decision: string}> = [];
  const quoted: number[] = [];
  const chain: PredictionChain = {
    activePrediction: async () => null,
    quotePrediction: async confidencePpm => {
      quoted.push(confidencePpm);
      return {confidence_ppm: confidencePpm, agent_stake: '10000000000000000000000', challenger_stake: '2500000000000000000000', minimum_agent_stake: '10000000000000000000000', minimum_challenger_stake: '1000000000000000000000', confidence_scale: 1_000_000};
    },
    publishPrediction: async input => {
      published.push({confidence_ppm: input.confidence_ppm, decision: input.decision});
      return {id: '1', decision: input.decision, confidence_ppm: input.confidence_ppm, evidence_hash: input.evidence_hash} as unknown as OnChainPrediction;
    },
  };
  let evidence = '';
  const service = new ForecastService(chain, {
    mode: 'fixture',
    evidenceDirectory: join(directory, 'evidence'),
    publishEvidence: async (hash, canonical) => { evidence = canonical; return `https://example.invalid/${hash}.json`; },
    budgetPath: join(directory, 'budget.json'),
    lockPath: join(directory, 'forecast.lock'),
    testMode: true,
  });
  service.setTestScenario(scenario);
  const result = await service.request();
  const calls = service.testStats().fixture_model_calls;
  await rm(directory, {recursive: true, force: true});
  return {result, calls, published, quoted, evidence};
}

// Out of range first, then a committed in-range answer: published exactly as given, never clamped.
const recovered = await run('unsupported-confidence-then-valid');
assert.equal(recovered.result.status, 'published', JSON.stringify(recovered.result));
assert.equal(recovered.calls, 2, 'one re-ask after the unquotable answer');
assert.deepEqual(recovered.published, [{confidence_ppm: 800_000, decision: 'yes'}]);
assert.deepEqual(recovered.quoted, [800_000], 'only the committed answer is quoted');
const snapshot = JSON.parse(recovered.evidence);
assert.equal(snapshot.forecast.confidence_reasks.length, 1);
assert.equal(snapshot.forecast.confidence_reasks[0].rejected_confidence, 0.9000001);
assert.match(snapshot.forecast.confidence_reasks[0].prompt, /0\.10 to 0\.90/);
assert.equal(snapshot.forecast.confidence_representation.model_probability, 0.8);

// Always out of range: the re-asks are bounded and nothing is published or quoted.
const refused = await run('unsupported-confidence');
assert.equal(refused.result.status, 'unavailable');
assert.match((refused.result as {reason: string}).reason, /after 2 re-ask/);
assert.equal(refused.calls, 3, 'the first call plus at most two re-asks');
assert.deepEqual(refused.published, []);
assert.deepEqual(refused.quoted, []);

// A valid first answer makes exactly one call and records no re-asks.
const direct = await run('publish');
assert.equal(direct.result.status, 'published');
assert.equal(direct.calls, 1);
assert.deepEqual(JSON.parse(direct.evidence).forecast.confidence_reasks, []);
console.log('forecast re-ask: ok');
