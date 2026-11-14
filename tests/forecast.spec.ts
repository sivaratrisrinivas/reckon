import {createHash} from 'node:crypto';
import {chmod, readFile, writeFile, mkdtemp, rm, access} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {test, expect, type APIRequestContext, type Page} from '@playwright/test';

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

async function recordCounts(request: APIRequestContext): Promise<{published: bigint; valid: bigint}> {
  const summary = await (await request.get('/api/predictions/summary')).json() as {published: string; valid_outcomes: string};
  return {published: BigInt(summary.published), valid: BigInt(summary.valid_outcomes)};
}

test('invalid evidence and abstention publish nothing; one browser request publishes fixed terms and downloadable evidence', async ({page, request}) => {
  await expect((await request.get('/api/predictions/active')).status()).toBe(200);
  expect((await (await request.get('/api/predictions/active')).json()).prediction).toBeNull();
  expect((await request.get('/api/predictions?start_id=1&limit=51')).status()).toBe(400);

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
  await page.getByRole('button', {name: 'Just watch'}).click();
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
  await expect(page.locator('#settlement-rule')).toContainText('first valid response completed within 120 seconds sets the result');
  await page.getByRole('button', {name: 'Challenge Prediction'}).click();
  const walletApproval = page.getByRole('dialog', {name: 'Approve this challenge'});
  await expect(walletApproval).toBeVisible();
  await expect(walletApproval.locator('#approval-stake')).toHaveText(formatNear(prediction.challenger_stake));
  await expect(walletApproval.locator('#approval-return')).toHaveText(formatNear((BigInt(prediction.challenger_stake) + BigInt(prediction.agent_stake)).toString()));
  await expect(walletApproval.locator('#approval-side')).toHaveText(prediction.decision === 'yes' ? 'NO' : 'YES');
  await expect(walletApproval.locator('#approval-network')).toContainText('Local NEAR sandbox · test money');
  await expect(walletApproval.locator('#approval-loss')).toContainText('You can lose the full stake');
  await expect(walletApproval.locator('#approval-settlement-rule')).toBeVisible();
  await walletApproval.getByRole('button', {name: 'Approve stake in local wallet'}).click();
  await expect(page.locator('#forecast-status')).toContainText('accepted on chain', {timeout: 30_000});
  await expect(page.locator('#transaction-state')).toContainText(/confirmed; the contract accepted|contract confirms your position/);
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

  await page.reload();
  await expect(page.getByRole('button', {name: /reveal/i})).toHaveCount(0);
  const balanceAfterChallenge = BigInt((await (await request.get('/api/wallet/balance')).json()).available_balance);
  expect((await request.post('/test/settlement-scenario', {data: {scenario: 'equal'}})).status()).toBe(204);
  expect((await request.post('/test/advance', {data: {seconds: 300}})).status()).toBe(204);
  await expect(page.locator('#settlement-state')).toContainText('Resolved NO', {timeout: 20_000});
  await expect(page.locator('#record-summary')).toContainText('1 published · 1 valid outcome');
  await expect(page.locator('.record-entry').last()).toContainText('Outcome NO');
  expect(BigInt((await (await request.get('/api/wallet/balance')).json()).available_balance)).toBe(balanceAfterChallenge);
  await page.reload();
  await expect(page.locator('.record-entry').last()).toContainText('Outcome NO');
  await expect(page.locator('.record-entry').last()).toContainText('No outgoing payment required');
});

test('unchallenged round resolves into public accuracy without moving betting funds', async ({page, request}) => {
  const before = await recordCounts(request);
  await scenario(request, 'publish');
  await page.goto('/');
  const walletBefore = BigInt((await (await request.get('/api/wallet/balance')).json()).available_balance);
  await page.getByRole('button', {name: 'Just watch'}).click();
  await expect(page.locator('#forecast-status')).toContainText(/Prediction #\d+ is published/);
  await expect(page.locator('#prediction')).toBeVisible();
  const prediction = (await (await request.get('/api/predictions/active')).json()).prediction;
  expect(prediction.challenger_account_id).toBeNull();
  await expect(page.locator('#challenge-panel')).toBeVisible();

  expect((await request.post('/test/settlement-scenario', {data: {scenario: 'below'}})).status()).toBe(204);
  expect((await request.post('/test/advance', {data: {seconds: 300}})).status()).toBe(204);
  await expect(page.locator('#settlement-state')).toContainText('Resolved NO', {timeout: 20_000});
  await expect(page.locator('#record-summary')).toContainText(`${before.published + 1n} published · ${before.valid + 1n} valid outcomes`);
  await expect(page.locator('.record-entry').last()).toContainText('Outcome NO');
  await expect(page.locator('.record-entry').last()).toContainText('No outgoing payment required');
  expect(BigInt((await (await request.get('/api/wallet/balance')).json()).available_balance)).toBe(walletBefore);
  await page.reload();
  await expect(page.locator('.record-entry').last()).toContainText('Outcome NO');
  await expect(page.locator('.record-entry').last()).toContainText('No outgoing payment required');
  await expect(page.getByRole('button', {name: /reveal/i})).toHaveCount(0);
});

async function publishAndChallenge(page: Page, request: APIRequestContext) {
  await scenario(request, 'publish');
  await page.goto('/');
  const balanceBefore = BigInt((await (await request.get('/api/wallet/balance')).json()).available_balance);
  await page.getByRole('button', {name: 'Just watch'}).click();
  await expect(page.locator('#forecast-status')).toContainText(/Prediction #\d+ is published/);
  await expect(page.locator('#prediction')).toBeVisible();
  const prediction = (await (await request.get('/api/predictions/active')).json()).prediction;
  await page.getByRole('button', {name: 'Challenge Prediction'}).click();
  await page.getByRole('dialog', {name: 'Approve this challenge'}).getByRole('button', {name: 'Approve stake in local wallet'}).click();
  await expect(page.locator('#forecast-status')).toContainText('accepted on chain', {timeout: 30_000});
  const balanceAfterChallenge = BigInt((await (await request.get('/api/wallet/balance')).json()).available_balance);
  expect(balanceAfterChallenge).toBeLessThan(balanceBefore);
  return {prediction, balanceBefore, balanceAfterChallenge};
}

test('challenger win returns both stakes and the public result survives reload', async ({page, request}) => {
  const before = await recordCounts(request);
  const {prediction, balanceBefore} = await publishAndChallenge(page, request);
  expect((await request.post('/test/settlement-scenario', {data: {scenario: 'above'}})).status()).toBe(204);
  expect((await request.post('/test/advance', {data: {seconds: 300}})).status()).toBe(204);
  await expect(page.locator('#settlement-state')).toContainText('Resolved YES', {timeout: 20_000});
  await expect(page.locator('#settlement-state')).toContainText('Payment confirmed on chain');
  await expect(page.locator('#record-summary')).toContainText(`${before.valid + 1n} valid outcomes`);
  await expect(page.locator('.record-entry').last()).toContainText('Payment receipt confirmed on chain');
  expect(BigInt((await (await request.get('/api/wallet/balance')).json()).available_balance)).toBeGreaterThan(balanceBefore);
  expect((await (await request.get('/api/predictions/active')).json()).prediction).toBeNull();
  expect((await (await request.get(`/api/predictions?start_id=${prediction.id}&limit=1`)).json())[0].outcome).toBe('yes');
  await page.reload();
  await expect(page.locator('.record-entry').last()).toContainText('Outcome YES');
  await expect(page.getByRole('button', {name: /reveal/i})).toHaveCount(0);
});

test('stalled oracle observation voids after the bounded window and refunds the challenger', async ({page, request}) => {
  const before = await recordCounts(request);
  const {balanceAfterChallenge} = await publishAndChallenge(page, request);
  expect((await request.post('/test/settlement-scenario', {data: {scenario: 'stalled'}})).status()).toBe(204);
  const advanced = await request.post('/test/advance', {data: {seconds: 330}});
  expect(advanced.status()).toBe(204);
  const stalled = (await (await request.get('/api/predictions/active')).json()).prediction;
  expect(BigInt(advanced.headers()['x-test-sandbox-timestamp'] ?? '0')).toBeGreaterThanOrEqual(BigInt(stalled.deadline_ns));
  await expect.poll(async () => (await (await request.get('/api/predictions/active')).json()).prediction?.settlement_status, {timeout: 20_000}).toBe('observing');
  await expect(page.locator('#settlement-state')).toContainText('The keeper requested the declared oracle', {timeout: 20_000});
  const observing = (await (await request.get('/api/predictions/active')).json()).prediction;
  expect(observing.settlement_status).toBe('observing');
  expect(observing.settlement_request_id).toBeTruthy();
  expect((await request.post('/test/advance', {data: {seconds: 120}})).status()).toBe(204);
  await expect(page.locator('#settlement-state')).toContainText('was voided', {timeout: 20_000});
  await expect(page.locator('#settlement-state')).toContainText('refund remains paid on chain');
  await expect(page.locator('#record-summary')).toContainText(`${before.published + 1n} published · ${before.valid} valid outcomes`);
  expect(BigInt((await (await request.get('/api/wallet/balance')).json()).available_balance)).toBeGreaterThan(balanceAfterChallenge);
  await page.reload();
  await expect(page.locator('.record-entry').last()).toContainText('VOID');
  await expect(page.locator('.record-entry').last()).toContainText('Payment receipt confirmed on chain');
});

test('failed payout stays visible and can be recovered without changing the final result', async ({page, request}) => {
  const {prediction} = await publishAndChallenge(page, request);
  expect((await request.post('/test/payment-scenario', {data: {scenario: 'fail'}})).status()).toBe(204);
  expect((await request.post('/test/settlement-scenario', {data: {scenario: 'above'}})).status()).toBe(204);
  expect((await request.post('/test/advance', {data: {seconds: 300}})).status()).toBe(204);

  await expect(page.locator('#settlement-state')).toContainText('Payment pending', {timeout: 20_000});
  await expect(page.locator('#payment-recovery')).toBeVisible();
  await expect(page.locator('#payment-recovery-state')).toContainText('remains owed');
  await expect(page.locator('#retry-payment-button')).toBeEnabled();

  expect((await request.post('/test/payment-scenario', {data: {scenario: 'restore'}})).status()).toBe(204);
  await page.locator('.record-recovery').click();
  await expect(page.locator('#settlement-state')).toContainText('Payment confirmed on chain', {timeout: 20_000});
  const recovered = (await (await request.get(`/api/predictions?start_id=${prediction.id}&limit=1`)).json())[0];
  expect(recovered.outcome).toBe('yes');
  expect(recovered.payment.status).toBe('paid');
  expect(recovered.payment.beneficiary_account_id).toBe((await (await request.get('/api/wallet')).json()).account_id);
  await expect(page.locator('#payment-recovery')).toBeHidden();
});

test('a missing payment callback can be recovered from the browser without a second transfer', async ({page, request}) => {
  const {prediction, balanceAfterChallenge} = await publishAndChallenge(page, request);
  expect((await request.post('/test/payment-scenario', {data: {scenario: 'callback-fail'}})).status()).toBe(204);
  expect((await request.post('/test/settlement-scenario', {data: {scenario: 'above'}})).status()).toBe(204);
  expect((await request.post('/test/advance', {data: {seconds: 300}})).status()).toBe(204);
  await expect(page.locator('#settlement-state')).toContainText('Payment pending', {timeout: 30_000});
  const pending = (await (await request.get(`/api/predictions?start_id=${prediction.id}&limit=1`)).json())[0];
  expect(pending.payment.transfer_in_flight).toBe(true);
  const balanceAfterTransfer = BigInt((await (await request.get('/api/wallet/balance')).json()).available_balance);
  expect(balanceAfterTransfer - balanceAfterChallenge).toBe(BigInt(pending.payment.amount));
  await page.getByRole('button', {name: 'Verify payment receipt', exact: true}).first().click();
  await expect(page.locator('#settlement-state')).toContainText('Payment confirmed on chain', {timeout: 30_000});
  expect(BigInt((await (await request.get('/api/wallet/balance')).json()).available_balance)).toBe(balanceAfterTransfer);
  expect((await request.post('/test/payment-scenario', {data: {scenario: 'callback-restore'}})).status()).toBe(204);
});

test('the keeper reconciles a missing payment callback automatically after its timeout', async ({page, request}) => {
  const {prediction} = await publishAndChallenge(page, request);
  expect((await request.post('/test/payment-scenario', {data: {scenario: 'callback-fail'}})).status()).toBe(204);
  expect((await request.post('/test/settlement-scenario', {data: {scenario: 'above'}})).status()).toBe(204);
  expect((await request.post('/test/advance', {data: {seconds: 300}})).status()).toBe(204);
  await expect(page.locator('#settlement-state')).toContainText('Payment pending', {timeout: 30_000});
  const transferredBalance = BigInt((await (await request.get('/api/wallet/balance')).json()).available_balance);
  // The keeper may relay a receipt proof only after the 300-second callback timeout, measured
  // in chain time from the attempt. Before it, an unconfirmed transfer must stay pending.
  expect((await request.post('/test/advance', {data: {seconds: 200}})).status()).toBe(204);
  await page.waitForTimeout(7_000); // Several one-second keeper ticks, beyond its first retry delay.
  const early = (await (await request.get(`/api/predictions?start_id=${prediction.id}&limit=1`)).json())[0];
  expect(early.payment.status).toBe('pending');
  expect(early.payment.transfer_in_flight).toBe(true);
  await expect(page.locator('#settlement-state')).toContainText('Payment pending');
  expect((await request.post('/test/advance', {data: {seconds: 130}})).status()).toBe(204);
  await expect(page.locator('#settlement-state')).toContainText('Payment confirmed on chain', {timeout: 30_000});
  const paid = (await (await request.get(`/api/predictions?start_id=${prediction.id}&limit=1`)).json())[0];
  expect(paid.payment.status).toBe('paid');
  expect(BigInt((await (await request.get('/api/wallet/balance')).json()).available_balance)).toBe(transferredBalance);
  expect((await request.post('/test/payment-scenario', {data: {scenario: 'callback-restore'}})).status()).toBe(204);
});

test('challenge ask checks the local wallet before inference and waits for explicit stake approval', async ({page, request}) => {
  await scenario(request, 'publish');
  await request.post('/api/wallet/fund');
  await page.goto('/');
  await expect(page.locator('#wallet-state')).toContainText('EPHEMERAL SANDBOX KEY');
  const balanceBefore = BigInt((await (await request.get('/api/wallet/balance')).json()).available_balance);
  const callsBefore = (await (await request.get('/test/forecast-stats')).json()).fixture_model_calls;
  const startedAt = Date.now();
  let appClicks = 0;

  await page.getByRole('button', {name: 'Ask Reckon'}).click();
  appClicks += 1;
  const approval = page.getByRole('dialog', {name: 'Approve this challenge'});
  await expect(approval).toBeVisible();
  const published = (await (await request.get('/api/predictions/active')).json()).prediction;
  expect(published.challenger_account_id).toBeNull();
  expect(BigInt((await (await request.get('/api/wallet/balance')).json()).available_balance)).toBe(balanceBefore);
  expect((await (await request.get('/test/forecast-stats')).json()).fixture_model_calls - callsBefore).toBe(1);

  await approval.getByRole('button', {name: 'Approve stake in local wallet'}).click();
  appClicks += 1;
  await expect(page.locator('#forecast-status')).toContainText('accepted on chain', {timeout: 30_000});
  expect(appClicks).toBeLessThanOrEqual(2);
  const externalWalletActions = 0;
  const externalFaucetActions = 0;
  expect(externalWalletActions).toBe(0);
  expect(externalFaucetActions).toBe(0);
  const elapsedMs = Date.now() - startedAt;
  expect(elapsedMs).toBeLessThan(60_000);
  console.log(`NEWCOMER_FLOW_MEASUREMENT ${JSON.stringify({
    path: 'funded_local_wallet',
    reckon_clicks: appClicks,
    external_wallet_actions: externalWalletActions,
    external_faucet_actions: externalFaucetActions,
    elapsed_ms: elapsedMs,
  })}`);
  await request.post('/test/settlement-scenario', {data: {scenario: 'above'}});
  expect((await request.post('/test/advance', {data: {seconds: 300}})).status()).toBe(204);
  await expect(page.locator('#settlement-state')).toContainText('Resolved YES', {timeout: 20_000});
});

test('wrong-network wallet stops before inference and publication', async ({page, request}) => {
  await scenario(request, 'publish');
  await page.goto('/');
  await request.post('/test/wallet-scenario', {data: {scenario: 'wrong-network'}});
  const callsBefore = (await (await request.get('/test/forecast-stats')).json()).fixture_model_calls;

  await page.getByRole('button', {name: 'Ask Reckon'}).click();
  await expect(page.locator('#forecast-status')).toContainText('expected the local sandbox');
  expect((await (await request.get('/test/forecast-stats')).json()).fixture_model_calls).toBe(callsBefore);
  expect((await (await request.get('/api/predictions/active')).json()).prediction).toBeNull();
  expect((await request.post('/test/wallet-scenario', {data: {scenario: 'sandbox'}})).status()).toBe(204);
});

test('insufficient local funds use one labelled top-up and resume only the active challenge request', async ({page, request}) => {
  await scenario(request, 'publish');
  await request.post('/test/wallet-scenario', {data: {scenario: 'insufficient'}});
  await page.goto('/');
  const callsBefore = (await (await request.get('/test/forecast-stats')).json()).fixture_model_calls;
  const startedAt = Date.now();
  let appClicks = 0;

  await page.getByRole('button', {name: 'Ask Reckon'}).click();
  appClicks += 1;
  await expect(page.locator('#wallet-preparation')).toBeVisible();
  expect((await (await request.get('/test/forecast-stats')).json()).fixture_model_calls).toBe(callsBefore);
  expect((await (await request.get('/api/predictions/active')).json()).prediction).toBeNull();
  await page.getByRole('button', {name: 'Fund local test wallet'}).click();
  appClicks += 1;

  const approval = page.getByRole('dialog', {name: 'Approve this challenge'});
  await expect(approval).toBeVisible();
  const balanceBeforeApproval = BigInt((await (await request.get('/api/wallet/balance')).json()).available_balance);
  const prediction = (await (await request.get('/api/predictions/active')).json()).prediction;
  expect(prediction.challenger_account_id).toBeNull();
  expect(balanceBeforeApproval).toBeGreaterThanOrEqual(25n * 10n ** 24n);
  await approval.getByRole('button', {name: 'Approve stake in local wallet'}).click();
  appClicks += 1;
  await expect(page.locator('#forecast-status')).toContainText('accepted on chain', {timeout: 30_000});
  expect(appClicks).toBeLessThanOrEqual(3);
  const localFundingActions = 1;
  const externalWalletActions = 0;
  const externalFaucetActions = 0;
  expect(localFundingActions).toBe(1);
  expect(externalWalletActions).toBe(0);
  expect(externalFaucetActions).toBe(0);
  const elapsedMs = Date.now() - startedAt;
  expect(elapsedMs).toBeLessThan(60_000);
  console.log(`NEWCOMER_FLOW_MEASUREMENT ${JSON.stringify({
    path: 'insufficient_local_wallet',
    reckon_clicks: appClicks,
    local_funding_actions: localFundingActions,
    external_wallet_actions: externalWalletActions,
    external_faucet_actions: externalFaucetActions,
    elapsed_ms: elapsedMs,
  })}`);
  await request.post('/test/settlement-scenario', {data: {scenario: 'above'}});
  expect((await request.post('/test/advance', {data: {seconds: 300}})).status()).toBe(204);
  await expect(page.locator('#settlement-state')).toContainText('Resolved YES', {timeout: 20_000});
});

test('cancelled approval and a reload during funding preparation never launch an unexpected forecast', async ({page, request}) => {
  await scenario(request, 'publish');
  await page.goto('/');
  const balanceBefore = BigInt((await (await request.get('/api/wallet/balance')).json()).available_balance);
  await page.getByRole('button', {name: 'Ask Reckon'}).click();
  const approval = page.getByRole('dialog', {name: 'Approve this challenge'});
  await expect(approval).toBeVisible();
  await approval.getByRole('button', {name: 'Cancel'}).click();
  await expect(page.locator('#forecast-status')).toContainText('approval cancelled');
  expect(BigInt((await (await request.get('/api/wallet/balance')).json()).available_balance)).toBe(balanceBefore);
  expect((await (await request.get('/api/predictions/active')).json()).prediction.challenger_account_id).toBeNull();

  await request.post('/test/wallet-scenario', {data: {scenario: 'insufficient'}});
  await request.post('/test/settlement-scenario', {data: {scenario: 'below'}});
  expect((await request.post('/test/advance', {data: {seconds: 380}})).status()).toBe(204);
  await page.reload();
  await expect(page.locator('#settlement-state')).toContainText('Resolved NO', {timeout: 20_000});
  const callsBeforeReloadIntent = (await (await request.get('/test/forecast-stats')).json()).fixture_model_calls;
  await page.getByRole('button', {name: 'Ask Reckon'}).click();
  await expect(page.locator('#wallet-preparation')).toBeVisible();
  await page.reload();
  await expect(page.locator('#wallet-preparation')).toBeHidden();
  expect((await (await request.get('/test/forecast-stats')).json()).fixture_model_calls).toBe(callsBeforeReloadIntent);
  expect((await (await request.get('/api/predictions/active')).json()).prediction).toBeNull();
  await expect(page.getByRole('button', {name: 'Just watch'})).toBeVisible();
});

test('expired local wallet preparation cannot launch a forecast after funding', async ({page, request}) => {
  await scenario(request, 'publish');
  await request.post('/test/wallet-scenario', {data: {scenario: 'insufficient'}});
  await page.clock.install();
  await page.goto('/');
  const callsBefore = (await (await request.get('/test/forecast-stats')).json()).fixture_model_calls;

  await page.getByRole('button', {name: 'Ask Reckon'}).click();
  await expect(page.locator('#wallet-preparation')).toBeVisible();
  await page.clock.fastForward(60_001);
  await page.getByRole('button', {name: 'Fund local test wallet'}).click();

  await expect(page.locator('#forecast-status')).toContainText('preparation expired');
  await expect(page.locator('#wallet-preparation')).toBeHidden();
  expect((await (await request.get('/test/forecast-stats')).json()).fixture_model_calls).toBe(callsBefore);
  expect((await (await request.get('/api/predictions/active')).json()).prediction).toBeNull();
});

test('a lost local challenger race is reported as a failed attempt', async ({page, request}) => {
  await scenario(request, 'publish');
  await request.post('/api/wallet/fund');
  await page.goto('/');
  const balanceBefore = BigInt((await (await request.get('/api/wallet/balance')).json()).available_balance);
  await page.getByRole('button', {name: 'Ask Reckon'}).click();
  const approval = page.getByRole('dialog', {name: 'Approve this challenge'});
  await expect(approval).toBeVisible();
  const prediction = (await (await request.get('/api/predictions/active')).json()).prediction;
  expect((await request.post('/test/challenge-race')).status()).toBe(204);
  await approval.getByRole('button', {name: 'Approve stake in local wallet'}).click();
  await expect(page.locator('#transaction-state')).toContainText('another wallet', {timeout: 30_000});
  const after = (await (await request.get(`/api/predictions?start_id=${prediction.id}&limit=1`)).json())[0];
  expect(after.challenger_account_id).not.toBe((await (await request.get('/api/wallet')).json()).account_id);
  const balanceAfter = BigInt((await (await request.get('/api/wallet/balance')).json()).available_balance);
  expect(balanceBefore - balanceAfter).toBeLessThan(BigInt(prediction.challenger_stake));
  expect(await page.locator('#forecast-status').textContent()).toContain('taken');
  await request.post('/test/settlement-scenario', {data: {scenario: 'below'}});
  expect((await request.post('/test/advance', {data: {seconds: 310}})).status()).toBe(204);
  await expect(page.locator('#settlement-state')).toContainText('Resolved NO', {timeout: 20_000});
});
