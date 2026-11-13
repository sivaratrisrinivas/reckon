import {createHash} from 'node:crypto';
import {chmod, readFile, writeFile, mkdtemp, rm, access} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {test, expect, type APIRequestContext} from '@playwright/test';

async function scenario(request: APIRequestContext, value: string): Promise<void> {
  await request.post('/test/forecast-scenario', {data: {scenario: value}});
  await request.post('/test/reset-forecast-limits');
}

function formatNear(amount: string): string {
  const near = 10n ** 24n;
  const value = BigInt(amount);
  const whole = value / near;
  const fraction = (value % near).toString().padStart(24, '0').replace(/0+$/, '');
  return `${whole}.${fraction || '0'} NEAR`;
}

test('invalid evidence and abstention publish nothing; one browser request publishes fixed terms and downloadable evidence', async ({page, request}) => {
  await expect((await request.get('/api/predictions/active')).status()).toBe(200);
  expect((await (await request.get('/api/predictions/active')).json()).prediction).toBeNull();

  for (const name of ['stale-market', 'invalid-reference', 'invalid-output', 'unsupported-confidence', 'unavailable-model', 'unavailable-storage']) {
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
  const walletBefore = await (await request.get('/api/wallet')).json();
  await expect(page.locator('#wallet-state')).toContainText(walletBefore.account_id);
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
  expect(prediction.evidence_url).toBe(`https://evidence.reckon.invalid/${prediction.evidence_hash}.json`);
  expect(BigInt(prediction.challenge_deadline_ns) - BigInt(prediction.published_at_ns)).toBe(30_000_000_000n);
  expect(BigInt(prediction.deadline_ns) - BigInt(prediction.published_at_ns)).toBe(300_000_000_000n);
  expect(prediction.agent_stake).toBeTruthy();
  expect(prediction.challenger_stake).toBeTruthy();

  await expect(page.locator('#challenge-panel')).toBeVisible();
  await expect(page.locator('#challenge-stake')).toHaveText(formatNear(prediction.challenger_stake));
  await expect(page.locator('#challenge-return')).toHaveText(formatNear((BigInt(prediction.challenger_stake) + BigInt(prediction.agent_stake)).toString()));
  await expect(page.locator('#challenger-side')).toHaveText(prediction.decision === 'yes' ? 'NO' : 'YES');
  await expect(page.locator('#challenge-confidence')).toContainText(`${(prediction.confidence_ppm / 10_000).toFixed(2)}%`);
  await expect(page.locator('#challenge-deadline')).not.toBeEmpty();
  await expect(page.locator('#challenge-network')).toContainText('Local NEAR sandbox · test money');
  await expect(page.locator('#challenge-loss')).toContainText('You can lose the full stake');
  await expect(page.locator('#settlement-rule')).toContainText('first successful valid oracle request initiated after the prediction deadline');
  await page.getByRole('button', {name: 'Challenge Prediction'}).click();
  const walletApproval = page.getByRole('dialog', {name: 'Local wallet approval'});
  await expect(walletApproval).toBeVisible();
  await expect(walletApproval.locator('#approval-stake')).toHaveText(formatNear(prediction.challenger_stake));
  await expect(walletApproval.locator('#approval-return')).toHaveText(formatNear((BigInt(prediction.challenger_stake) + BigInt(prediction.agent_stake)).toString()));
  await expect(walletApproval.locator('#approval-side')).toHaveText(prediction.decision === 'yes' ? 'NO' : 'YES');
  await expect(walletApproval.locator('#approval-network')).toContainText('Local NEAR sandbox · test money');
  await expect(walletApproval.locator('#approval-loss')).toContainText('You can lose the full stake');
  await expect(walletApproval.locator('#approval-settlement-rule')).toBeVisible();
  await walletApproval.getByRole('button', {name: 'Approve stake in local wallet'}).click();
  await expect(page.locator('#forecast-status')).toContainText('accepted on chain', {timeout: 30_000});
  await expect(page.locator('#transaction-state')).toContainText('confirmed; the contract accepted');
  const accepted = (await (await request.get('/api/predictions/active')).json()).prediction;
  expect(accepted.challenger_account_id).toBe(walletBefore.account_id);
  expect(accepted.agent_stake_committed).toBe(true);
  expect(BigInt((await (await request.get('/api/wallet')).json()).available_balance)).toBeLessThan(BigInt(walletBefore.available_balance));
  await expect(page.locator('#challenge-panel')).toBeHidden();

  expect(published.evidence_url).toBe(prediction.evidence_url);
  const downloadUrl = await page.getByRole('link', {name: 'Download evidence snapshot'}).getAttribute('href');
  if (!downloadUrl) throw new Error('Evidence download link is missing');
  const evidenceResponse = await request.get(downloadUrl);
  expect(evidenceResponse.status()).toBe(200);
  const evidence = await evidenceResponse.text();
  expect(createHash('sha256').update(evidence).digest('hex')).toBe(prediction.evidence_hash);
  expect(JSON.parse(evidence).provider_mode).toBe('scripted deterministic providers for local sandbox only');
  expect(JSON.parse(evidence).limitations).toContain('The model inference is off-chain and this fingerprint does not prove that the recorded model response was executed.');
  await expect(page.getByText('It has not been published to durable public hosting.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', {name: 'Download evidence snapshot'})).toHaveAttribute('href', `/api/evidence/${prediction.evidence_hash}`);

  const archiveParent = await mkdtemp(join('.local/', 'archive-test-'));
  const archive = join(archiveParent, 'export');
  const runArchive = () => promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/archive-evidence.ts', 'http://127.0.0.1:4389', archive]);
  await runArchive();
  expect(await readFile(join(archive, `${prediction.evidence_hash}.json`), 'utf8')).toBe(evidence);
  const manifest = JSON.parse(await readFile(join(archive, 'manifest.json'), 'utf8'));
  expect(manifest.predictions).toEqual([{prediction_id: prediction.id, evidence_url: prediction.evidence_url, sha256: prediction.evidence_hash, file: `${prediction.evidence_hash}.json`}]);
  await expect(runArchive()).rejects.toThrow();
  expect(await readFile(join(archive, `${prediction.evidence_hash}.json`), 'utf8')).toBe(evidence);
  await rm(archive, {recursive: true});

  const evidencePath = join('.local/evidence', `${prediction.evidence_hash}.json`);
  const originalEvidence = await readFile(evidencePath, 'utf8');
  await chmod(evidencePath, 0o644);
  try {
    await writeFile(evidencePath, `${originalEvidence} `);
    const tampered = await request.get(downloadUrl);
    expect(tampered.status()).toBe(409);
    expect(await tampered.json()).toEqual({error: 'Evidence fingerprint does not match this snapshot'});
    await expect(runArchive()).rejects.toThrow();
    await expect(access(archive)).rejects.toThrow();
  } finally {
    await writeFile(evidencePath, originalEvidence);
    await chmod(evidencePath, 0o444);
    await rm(archiveParent, {recursive: true, force: true});
  }
});
