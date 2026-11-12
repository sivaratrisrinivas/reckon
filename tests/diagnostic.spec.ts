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
