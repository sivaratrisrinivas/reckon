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

for (const viewport of [{width: 1280, height: 720}, {width: 1024, height: 640}, {width: 390, height: 844}]) {
  test(`Ask Reckon is fully above the fold at ${viewport.width}x${viewport.height} without scrolling`, async ({browser}) => {
    const page = await browser.newPage({viewport});
    await page.goto('/');
    await expect(page.locator('#remaining')).not.toHaveText('Connecting…');
    expect(await page.evaluate(() => globalThis.scrollY)).toBe(0);
    await expect(page.getByRole('button', {name: 'Ask Reckon'})).toBeInViewport({ratio: 1});
    await page.close();
  });
}

test('the header keeps the honesty label short and puts the wallet key detail behind a disclosure', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('#wallet-state')).toContainText('EPHEMERAL SANDBOX KEY');
  await expect(page.locator('#wallet-state')).toBeHidden();
  await page.getByText('Wallet', {exact: true}).click();
  await expect(page.locator('#wallet-state')).toBeVisible();
});

test('the small-screen layout never scrolls sideways', async ({browser}) => {
  const page = await browser.newPage({viewport: {width: 360, height: 740}});
  await page.goto('/');
  await expect(page.getByRole('button', {name: 'Ask Reckon'})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.close();
});
