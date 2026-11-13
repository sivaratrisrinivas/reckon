import {test, expect, type APIRequestContext} from '@playwright/test';

async function prepareForecast(request: APIRequestContext): Promise<void> {
  await request.post('/test/forecast-scenario', {data: {scenario: 'publish'}});
  await request.post('/test/reset-forecast-limits');
}

test('sandbox time reduces life and retires bankroll in the browser', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByText('LOCAL SANDBOX · TEST MONEY')).toBeVisible();
  await expect(page.locator('#spendable')).toContainText('NEAR');
  const displayedSpendable = await page.locator('#spendable').textContent();
  const displayedLife = await page.locator('#remaining').textContent();
  const before = await (await request.get('/api/life')).json();
  expect((await request.post('/test/advance')).status()).toBe(204);
  await expect.poll(async () => BigInt((await (await request.get('/api/life')).json()).spendable_bankroll)).toBeLessThan(BigInt(before.spendable_bankroll));
  const after = await (await request.get('/api/life')).json();
  expect(BigInt(after.retired_bankroll)).toBeGreaterThan(BigInt(before.retired_bankroll));
  expect(BigInt(after.remaining_life_ns)).toBeLessThan(BigInt(before.remaining_life_ns));
  await expect.poll(async () => page.locator('#spendable').textContent()).not.toBe(displayedSpendable);
  await expect.poll(async () => page.locator('#remaining').textContent()).not.toBe(displayedLife);
  await expect.poll(async () => page.locator('#retired').textContent()).not.toBe('0.0000 NEAR');
  await expect(page.locator('#reserve')).toHaveText('20.0 NEAR');
  await expect(page.getByRole('heading', {name: 'Ask Reckon'})).toBeVisible();
});

test('death is permanent while an outstanding challenged round settles and remains readable', async ({page, request}) => {
  await prepareForecast(request);
  const lifeBefore = await (await request.get('/api/life')).json() as {dead: boolean; remaining_life_ns: string};
  expect(lifeBefore.dead).toBe(false);
  const secondsToReserve = Number(BigInt(lifeBefore.remaining_life_ns) / 1_000_000_000n) - 240;
  expect(secondsToReserve).toBeGreaterThan(0);
  expect((await request.post('/test/advance', {data: {seconds: secondsToReserve}})).status()).toBe(204);
  const lifeAfterReserve = await (await request.get('/api/life')).json() as {dead: boolean; remaining_life_ns: string};
  expect(lifeAfterReserve.dead, `the test setup must leave time to publish and challenge: ${JSON.stringify(lifeAfterReserve)}`).toBe(false);

  await request.post('/api/wallet/fund');
  await page.goto('/');
  await page.getByRole('button', {name: 'Ask Reckon'}).click();
  await expect(page.locator('#forecast-status')).toContainText(/Prediction #\d+ is published/);
  const prediction = (await (await request.get('/api/predictions/active')).json()).prediction;
  const approval = page.getByRole('dialog', {name: 'Approve this challenge'});
  await expect(approval).toBeVisible();
  await approval.getByRole('button', {name: 'Approve stake in local wallet'}).click();
  await expect(page.locator('#forecast-status')).toContainText('accepted on chain', {timeout: 30_000});

  expect((await request.post('/test/settlement-scenario', {data: {scenario: 'above'}})).status()).toBe(204);
  expect((await request.post('/test/advance', {data: {seconds: 120}})).status()).toBe(204);
  await expect.poll(async () => (await (await request.get('/api/life')).json()).dead).toBe(false);
  const lifeBeforeDeath = await (await request.get('/api/life')).json() as {dead: boolean; remaining_life_ns: string};
  const secondsToDeath = Number(BigInt(lifeBeforeDeath.remaining_life_ns) / 1_000_000_000n) + 1;
  expect((await request.post('/test/advance', {data: {seconds: secondsToDeath}})).status()).toBe(204);
  await expect.poll(async () => (await (await request.get('/api/life')).json()).dead).toBe(true);
  expect((await request.post('/test/accrue')).status()).toBe(204);
  await page.reload();
  await expect(page.locator('#life-state')).toHaveText('Depleted · permanently dead');
  await expect(page.locator('#death-date')).toContainText('Death date:');
  await expect(page.getByRole('button', {name: 'Ask Reckon'})).toBeHidden();
  await expect(page.locator('#challenge-panel')).toBeHidden();
  await expect(page.locator('#fingerprint')).toHaveText(prediction.evidence_hash);

  // The prediction deadline has passed, but this remains inside the bounded settlement window.
  const deathAdvance = await request.post('/test/advance', {data: {seconds: 1}});
  expect(deathAdvance.status()).toBe(204);
  const deathBlockNs = BigInt(deathAdvance.headers()['x-test-sandbox-timestamp'] ?? '0');
  const secondsUntilDeadline = Number((BigInt(prediction.deadline_ns) - deathBlockNs + 999_999_999n) / 1_000_000_000n) + 5;
  expect(secondsUntilDeadline).toBeGreaterThan(0);
  expect(secondsUntilDeadline).toBeLessThan(120);
  expect((await request.post('/test/advance', {data: {seconds: secondsUntilDeadline}})).status()).toBe(204);
  await expect(page.locator('#settlement-state')).toContainText('Resolved YES', {timeout: 20_000});
  await expect(page.locator('#settlement-state')).toContainText('Payment confirmed on chain');
  await expect(page.locator('.record-entry').last()).toContainText('Outcome YES');
  await expect(page.locator('.record-entry').last()).toContainText('Payment receipt confirmed on chain');
  await page.reload();
  await expect(page.locator('.record-entry').last()).toContainText('Outcome YES');
  await expect(page.getByRole('button', {name: 'Ask Reckon'})).toBeHidden();
  await expect(page.locator('#challenge-panel')).toBeHidden();
});
