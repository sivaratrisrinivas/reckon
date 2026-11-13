import { test, expect } from '@playwright/test';

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
