import {brotliCompressSync, constants, gzipSync} from 'node:zlib';
import {readFile} from 'node:fs/promises';
import {test, expect} from '@playwright/test';
import {
  activeDescription, auditState, layoutShift, observeLayoutShift, tabTo,
} from './support.js';

// Every state in this file is produced by the real service, the real sandbox contract and the existing
// RECKON_TEST fixtures at the provider boundaries. The suite shares one sandbox and ends in permanent death, so
// tests run in file order on one worker and each one leaves the agent idle for the next.

const MAXIMUM_CUMULATIVE_LAYOUT_SHIFT = 0.1;

test.beforeEach(async ({page}) => {
  await observeLayoutShift(page);
});

test('idle scene shows consent context, one primary action and a non-colour state label without a click', async ({page}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', {level: 1})).toHaveText('An AI that pays when it is wrong.');
  await expect(page.locator('#remaining')).toHaveText(/^\d+m \d{2}s$/);
  await expect(page.getByText('LOCAL SANDBOX · TEST MONEY')).toBeVisible();
  await expect(page.locator('#state-label')).toHaveText('Idle');
  await expect(page.locator('#wallet-state')).toContainText('EPHEMERAL SANDBOX KEY');
  await expect(page.getByRole('button', {name: 'Ask Reckon'})).toBeVisible();
  const mark = await page.locator('#state-label').evaluate(element => getComputedStyle(element, '::before').content);
  expect(mark, 'the state label carries a shape mark as well as text').not.toBe('none');
  await auditState(page, 'idle', {maximumPrimaryActions: 1});
  expect((await layoutShift(page)).total).toBeLessThanOrEqual(MAXIMUM_CUMULATIVE_LAYOUT_SHIFT);
});

test('keyboard reaches the primary action first and shows a visible focus indicator', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('#state-label')).toHaveText('Idle');
  const tabs = await tabTo(page, '#ask-button');
  expect(tabs, 'only the wordmark link precedes the primary action').toBeLessThanOrEqual(2);
  const focus = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement as Element);
    return {style: style.outlineStyle, width: parseFloat(style.outlineWidth), color: style.outlineColor};
  });
  expect(focus.style).not.toBe('none');
  expect(focus.width).toBeGreaterThanOrEqual(2);
  await tabTo(page, '#watch-button');
  expect(await activeDescription(page)).toContain('Just watch');
});

test('steady state produces no live-region announcements', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('#state-label')).toHaveText('Idle');
  await expect(page.locator('#wallet-state')).toContainText('EPHEMERAL SANDBOX KEY');
  await expect(page.locator('#record-summary')).not.toHaveText('Loading the public on-chain record.');
  await page.evaluate(() => {
    const log: string[] = [];
    (globalThis as unknown as {__announcements: string[]}).__announcements = log;
    const observer = new MutationObserver(records => {
      for (const record of records) log.push(`${(record.target as Element).id || record.target.nodeName}: ${record.target.textContent}`);
    });
    for (const region of document.querySelectorAll('[role="status"], [aria-live]')) {
      observer.observe(region, {childList: true, characterData: true, subtree: true});
    }
  });
  await page.waitForTimeout(7_000); // Beyond one life poll (3 s) and one record poll (5 s).
  expect(await page.evaluate(() => (globalThis as unknown as {__announcements: string[]}).__announcements)).toEqual([]);
});

test('initial core JS, CSS and fonts stay inside the compressed transfer budgets', async ({request}) => {
  const html = await (await request.get('/')).text();
  const script = await (await request.get('/app.js')).body();
  const stylesheet = await (await request.get('/style.css')).body();
  const sizes = (body: Buffer) => ({
    gzip: gzipSync(body, {level: 9}).length,
    brotli: brotliCompressSync(body, {params: {[constants.BROTLI_PARAM_QUALITY]: 11}}).length,
  });
  expect(sizes(script).gzip).toBeLessThanOrEqual(200 * 1024);
  expect(sizes(script).brotli).toBeLessThanOrEqual(200 * 1024);
  expect(sizes(stylesheet).gzip).toBeLessThanOrEqual(30 * 1024);
  expect(sizes(stylesheet).brotli).toBeLessThanOrEqual(30 * 1024);
  // The page ships no font files, so the 100 KB font budget is met by system fonts alone.
  expect(html).not.toMatch(/@font-face|\.woff2?|\.ttf|\.otf/);
  expect((await readFile('public/style.css', 'utf8'))).not.toMatch(/@font-face|url\(/);
});
