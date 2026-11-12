import { test, expect } from '@playwright/test';

test('recorded diagnostic discloses the failed model response and provides evidence', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'View testnet integration diagnostic' }).click();
  await expect(page.getByRole('heading', { name: 'Integration diagnostic' })).toBeVisible();
  await expect(page.getByText('Model response unavailable')).toBeVisible();
  await expect(page.getByText('No prediction was created.')).toBeVisible();
  const response = await page.request.get('/diagnostic-evidence.json');
  expect(response.ok()).toBeTruthy();
  const evidence = await response.json();
  expect(evidence.choice.finish_reason).toBe('length');
  expect(evidence.choice.message.content).toBeNull();
});

test('latest probe reports an unavailable response without presenting a prediction', async ({ page }) => {
  await page.route('**/api/diagnostic/latest', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({status: 'unavailable', started_at: '2026-11-12T22:00:00Z', reason: 'Provider timed out'}),
  }));
  await page.goto('/diagnostic');
  await expect(page.getByRole('status')).toContainText('Provider timed out');
  await expect(page.getByText('No prediction was created.')).toBeVisible();
  await expect(page.getByRole('link', {name: 'View latest probe evidence (JSON)'})).toBeVisible();
});
