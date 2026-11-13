import {createHash} from 'node:crypto';
import {chmod, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {test, expect, type APIRequestContext} from '@playwright/test';

async function scenario(request: APIRequestContext, value: string): Promise<void> {
  await request.post('/test/forecast-scenario', {data: {scenario: value}});
  await request.post('/test/reset-forecast-limits');
}

test('invalid evidence and abstention publish nothing; one browser request publishes fixed terms and downloadable evidence', async ({page, request}) => {
  await expect((await request.get('/api/predictions/active')).status()).toBe(200);
  expect((await (await request.get('/api/predictions/active')).json()).prediction).toBeNull();

  for (const name of ['stale-market', 'invalid-reference', 'invalid-output', 'unsupported-confidence', 'unavailable-model']) {
    await scenario(request, name);
    const response = await request.post('/api/forecast', {data: {}});
    expect(response.status(), `${name} must fail without publishing`).toBe(503);
    const result = await response.json();
    expect(result.status).toBe('unavailable');
    expect((await (await request.get('/api/predictions/active')).json()).prediction).toBeNull();
  }

  await scenario(request, 'abstain');
  const abstention = await request.post('/api/forecast', {data: {}});
  expect(abstention.status()).toBe(200);
  expect((await abstention.json()).status).toBe('abstained');
  expect((await (await request.get('/api/predictions/active')).json()).prediction).toBeNull();
  const modelCallsAfterAbstention = (await (await request.get('/test/forecast-stats')).json()).fixture_model_calls;
  const cooldown = await request.post('/api/forecast', {data: {}});
  expect(cooldown.status()).toBe(429);
  expect((await cooldown.json()).status).toBe('cooldown');
  expect((await (await request.get('/test/forecast-stats')).json()).fixture_model_calls).toBe(modelCallsAfterAbstention);

  await scenario(request, 'slow-publish');
  await page.goto('/');
  await expect(page.getByText('FORECAST INPUTS · SCRIPTED LOCAL FIXTURES')).toBeVisible();
  const before = (await (await request.get('/test/forecast-stats')).json()).fixture_model_calls;
  await page.getByRole('button', {name: 'Ask Reckon'}).click();
  await expect(page.getByRole('status').filter({hasText: 'Checking recent market evidence'})).toBeVisible();

  const sharedRequest = await request.post('/api/forecast', {data: {}});
  expect(sharedRequest.status()).toBe(201);
  const published = await sharedRequest.json();
  await expect(page.getByText(/^Prediction #1 is published/)).toBeVisible();
  await expect(page.getByText('NO', {exact: true})).toBeVisible();
  await expect(page.getByText('85.00%', {exact: true})).toBeVisible();
  await expect(page.getByRole('link', {name: 'Download evidence snapshot'})).toBeVisible();
  expect(published.status).toBe('published');
  expect((await (await request.get('/test/forecast-stats')).json()).fixture_model_calls - before).toBe(1);

  const prediction = (await (await request.get('/api/predictions/active')).json()).prediction;
  expect(prediction.evidence_hash).toBe(published.prediction.evidence_hash);
  expect(BigInt(prediction.challenge_deadline_ns) - BigInt(prediction.published_at_ns)).toBe(30_000_000_000n);
  expect(BigInt(prediction.deadline_ns) - BigInt(prediction.published_at_ns)).toBe(300_000_000_000n);
  expect(prediction.agent_stake).toBeTruthy();
  expect(prediction.challenger_stake).toBeTruthy();

  const evidenceResponse = await request.get(published.evidence_url);
  expect(evidenceResponse.status()).toBe(200);
  const evidence = await evidenceResponse.text();
  expect(createHash('sha256').update(evidence).digest('hex')).toBe(prediction.evidence_hash);
  expect(JSON.parse(evidence).provider_mode).toBe('scripted deterministic providers for local sandbox only');
  expect(JSON.parse(evidence).limitations).toContain('The model inference is off-chain and this fingerprint does not prove that the recorded model response was executed.');
  await expect(page.getByText('It has not been published to durable public hosting.')).toBeVisible();

  const evidencePath = join('.local/evidence', `${prediction.evidence_hash}.json`);
  const originalEvidence = await readFile(evidencePath, 'utf8');
  await chmod(evidencePath, 0o644);
  try {
    await writeFile(evidencePath, `${originalEvidence} `);
    const tampered = await request.get(published.evidence_url);
    expect(tampered.status()).toBe(409);
    expect(await tampered.json()).toEqual({error: 'Evidence fingerprint does not match this snapshot'});
  } finally {
    await writeFile(evidencePath, originalEvidence);
    await chmod(evidencePath, 0o444);
  }
});
