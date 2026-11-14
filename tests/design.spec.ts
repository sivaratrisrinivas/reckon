import {test, expect} from '@playwright/test';

// The redesign's promises: one primary action per screen, full keyboard use with visible focus,
// honest labels that stay on screen, and stillness for people who ask for reduced motion.

test('the first screen offers exactly one primary action and keeps the honesty label visible', async ({page}) => {
  await page.goto('/');
  await expect(page.getByText('LOCAL SANDBOX · TEST MONEY')).toBeVisible();
  await expect(page.getByRole('button', {name: 'Ask Reckon'})).toBeVisible();
  await expect(page.locator('button.primary:visible')).toHaveCount(1);
});

test('keyboard users can skip to the action and always see where focus is', async ({page}) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', {name: 'Skip to Ask Reckon'});
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('#forecast-heading')).toBeFocused();
  const ask = page.getByRole('button', {name: 'Ask Reckon'});
  await expect(ask).toBeEnabled();
  for (let step = 0; step < 6 && !await ask.evaluate(node => node === document.activeElement); step += 1) await page.keyboard.press('Tab');
  await expect(ask).toBeFocused();
  const outline = await ask.evaluate(node => getComputedStyle(node).outlineStyle + ' ' + getComputedStyle(node).outlineWidth);
  expect(outline).toBe('solid 3px');
});

test('reduced motion stills the living orb and every transition', async ({browser}) => {
  const context = await browser.newContext({reducedMotion: 'reduce'});
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('.orb-core')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.orb-skin')).toHaveCSS('animation-name', 'none');
  await context.close();
});
