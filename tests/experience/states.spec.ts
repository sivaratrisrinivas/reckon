import {brotliCompressSync, constants, gzipSync} from 'node:zlib';
import {readFile} from 'node:fs/promises';
import {test, expect, type APIRequestContext, type Page} from '@playwright/test';
import {
  activeDescription, activePrediction, advance, auditState, contrastRatio, ensureIdle, formatNear, life, observeLayoutShift,
  paymentScenario, scenario, settlementScenario, tabTo, visiblePrimaryActions, walletScenario, type PredictionView,
} from './support.js';

// Every state in this file is produced by the real service, the real sandbox contract and the existing
// RECKON_TEST fixtures at the provider boundaries. The suite shares one sandbox and ends in permanent death, so
// tests run in file order on one worker and each one leaves the agent idle for the next.

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
  const surfaces = await page.evaluate(() => {
    const read = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return {background: read('--bg'), surface: read('--surface'), strongBorder: read('--border-strong')};
  });
  for (const surface of [surfaces.background, surfaces.surface]) {
    expect(contrastRatio(focus.color, surface), `focus ring against ${surface}`).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(surfaces.strongBorder, surface), `control border against ${surface}`).toBeGreaterThanOrEqual(3);
  }
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

const STATE_LABEL = '#state-label';

async function hold(page: Page, pattern: string): Promise<() => void> {
  let release: () => void = () => undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(pattern, async route => {
    await gate;
    await route.continue();
  });
  return release;
}

test('wallet preparation, thinking, abstention and cooldown each name their state with one primary action', async ({page, request}) => {
  await ensureIdle(request);
  await scenario(request, 'abstain');
  await walletScenario(request, 'insufficient');
  await page.goto('/');
  await expect(page.locator(STATE_LABEL)).toHaveText('Idle');

  await tabTo(page, '#ask-button');
  await page.keyboard.press('Enter');
  await expect(page.locator('#wallet-preparation')).toBeVisible();
  await expect(page.locator(STATE_LABEL)).toHaveText('Wallet preparation');
  expect(await activeDescription(page), 'focus moves to the one action the state needs').toContain('Fund local test wallet');
  await expect(page.locator('#wallet-preparation-state')).toContainText('No inference or publication has started');
  await auditState(page, 'preparation', {maximumPrimaryActions: 1});

  const release = await hold(page, '**/api/forecast');
  await tabTo(page, '#fund-wallet-button'); // The keyboard walk moved focus; return to the one action.
  await page.keyboard.press('Enter'); // Fund local test wallet, keyboard only.
  await expect(page.locator(STATE_LABEL)).toHaveText('Thinking');
  await expect(page.locator('#glyph')).toHaveAttribute('data-state', 'thinking');
  expect(await activeDescription(page), 'focus is not dropped to the page body').not.toBe('body');
  expect(await visiblePrimaryActions(page)).toEqual([]);
  await expect(page.locator('#forecast-status')).toContainText('Checking recent market evidence');
  await auditState(page, 'thinking', {maximumPrimaryActions: 0});
  release();

  await expect(page.locator(STATE_LABEL)).toHaveText('Abstained');
  await expect(page.locator('#forecast-status')).toContainText('No prediction was published');
  await expect(page.locator('#prediction')).toBeHidden();
  await auditState(page, 'abstained', {maximumPrimaryActions: 1});

  await page.getByRole('button', {name: 'Ask Reckon'}).click();
  await expect(page.locator(STATE_LABEL)).toHaveText('Cooldown');
  await expect(page.locator('#forecast-status')).toContainText('try again in about');
  await auditState(page, 'cooldown', {maximumPrimaryActions: 1, sweepViewports: false});
});

test('operational unavailability names the dependency and is not presented as death', async ({page, request}) => {
  await ensureIdle(request);
  await scenario(request, 'unavailable-model');
  await page.goto('/');
  await page.getByRole('button', {name: 'Ask Reckon'}).click();
  await expect(page.locator(STATE_LABEL)).toHaveText('Unavailable');
  await expect(page.locator('#forecast-status')).toContainText('Configured model inference is unavailable');
  await expect(page.locator('#forecast-status')).not.toContainText(/dead|death/i);
  await expect(page.locator('#life-state')).toHaveText('Alive · upkeep continues');
  await expect(page.getByRole('button', {name: 'Ask Reckon'})).toBeVisible();
  await auditState(page, 'operationally unavailable', {maximumPrimaryActions: 1});
  await scenario(request, 'publish');
});

async function publishWithWatch(page: Page, request: APIRequestContext): Promise<PredictionView> {
  await scenario(request, 'publish');
  await page.goto('/');
  await expect(page.locator('#wallet-state')).toContainText('EPHEMERAL SANDBOX KEY');
  await page.getByRole('button', {name: 'Just watch'}).click();
  await expect(page.locator(STATE_LABEL)).toHaveText('Challenge open');
  return (await activePrediction(request))!;
}

async function challengeByClicks(page: Page): Promise<void> {
  await page.getByRole('button', {name: 'Challenge Prediction'}).click();
  await page.getByRole('dialog', {name: 'Approve this challenge'}).getByRole('button', {name: 'Approve stake in local wallet'}).click();
  await expect(page.locator(STATE_LABEL)).toHaveText('Challenge accepted', {timeout: 30_000});
}

test('challenge open on a phone keeps every consent term and the one action on a single screen', async ({page, request}) => {
  await ensureIdle(request);
  await request.post('/api/wallet/fund');
  await page.setViewportSize({width: 390, height: 844});
  const prediction = await publishWithWatch(page, request);

  await expect(page.locator('#challenge-stake')).toHaveText(formatNear(prediction.challenger_stake));
  const terms = ['challenger-side', 'challenge-confidence', 'challenge-stake', 'challenge-return', 'challenge-deadline', 'challenge-network', 'challenge-loss', 'challenge-button'];
  await page.locator('#challenge-heading').evaluate(heading => heading.scrollIntoView({block: 'start'}));
  const outside = await page.evaluate(ids => ids.flatMap(id => {
    const box = document.getElementById(id)!.getBoundingClientRect();
    return box.top < 0 || box.bottom > innerHeight ? [`${id} spans ${Math.round(box.top)}-${Math.round(box.bottom)} px of ${innerHeight}`] : [];
  }), terms);
  expect(outside, 'stake, return, deadline, network, loss risk and the action share one 390x844 screen').toEqual([]);
  await expect(page.locator('#challenge-panel')).toMatchAriaSnapshot(`
    - heading "Take the opposing side" [level=4]
    - button "Challenge Prediction"
  `);
  await auditState(page, 'challenge open', {maximumPrimaryActions: 1});
  await ensureIdle(request);
});

test('the approval dialog is keyboard operable, focuses its title, and Escape cancels without moving a stake', async ({page, request}) => {
  await ensureIdle(request);
  await request.post('/api/wallet/fund');
  await publishWithWatch(page, request);
  const balanceBefore = BigInt((await (await request.get('/api/wallet/balance')).json()).available_balance);

  await tabTo(page, '#challenge-button');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', {name: 'Approve this challenge'});
  await expect(dialog).toBeVisible();
  await expect(page.locator(STATE_LABEL)).toHaveText('Awaiting your approval');
  expect(await page.evaluate(() => document.activeElement?.id), 'a held Enter key must not reach the stake button').toBe('wallet-dialog-title');
  await expect(dialog).toMatchAriaSnapshot(`
    - heading "Approve this challenge" [level=3]
    - button "Approve stake in local wallet"
    - button "Cancel"
  `);
  await auditState(page, 'approval dialog', {maximumPrimaryActions: 1, sweepViewports: false, keyboard: false});
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('approve-challenge');
  for (let presses = 0; presses < 4; presses += 1) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => {
      const active = document.activeElement;
      return active === document.body || active?.closest('dialog') !== null;
    }), 'Tab never reaches the inert page behind the modal').toBe(true);
  }

  await page.locator('#cancel-challenge').focus();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#forecast-status')).toContainText('approval cancelled');
  expect(await activeDescription(page), 'focus returns to the control that opened the dialog').toContain('Challenge Prediction');
  expect(BigInt((await (await request.get('/api/wallet/balance')).json()).available_balance)).toBe(balanceBefore);
  expect((await activePrediction(request))!.challenger_account_id).toBeNull();
  await ensureIdle(request);
});

test('the challenge window closing updates the scene in place and never moves keyboard focus', async ({page, request}) => {
  await ensureIdle(request);
  await publishWithWatch(page, request);
  await tabTo(page, '#challenge-button');
  await page.evaluate(() => {
    const target = globalThis as unknown as {__focusEvents: string[]};
    target.__focusEvents = [];
    document.addEventListener('focusout', event => target.__focusEvents.push(`out ${(event.target as Element).id}`));
    document.addEventListener('focusin', event => target.__focusEvents.push(`in ${(event.target as Element).id}`));
  });

  await advance(request, 40);
  await expect(page.locator(STATE_LABEL)).toHaveText('Challenge closed', {timeout: 15_000});
  await expect(page.locator('#forecast-status')).toContainText('Its original deadline was not extended');
  await expect(page.locator('#challenge-button')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#challenge-button')).toHaveText('Challenge window closed');
  expect(await activeDescription(page), 'the focused control keeps focus').toContain('Challenge window closed');
  expect(await page.evaluate(() => (globalThis as unknown as {__focusEvents: string[]}).__focusEvents)).toEqual([]);
  expect(await visiblePrimaryActions(page), 'a closed window leaves no primary action').toEqual([]);
  await auditState(page, 'challenge closed', {maximumPrimaryActions: 0});

  await page.keyboard.press('Tab');
  await expect(page.locator('#challenge-panel')).toBeHidden();
  await ensureIdle(request);
  await expect(page.locator(STATE_LABEL)).toHaveText('Resolved', {timeout: 30_000});
  await expect(page.locator('#settlement-state')).toContainText('No outgoing payment was required');
  await auditState(page, 'resolved without a challenger', {maximumPrimaryActions: 1});
});

test('a wallet transaction is acknowledged at once, never called accepted before the chain confirms, and waiting is silent', async ({page, request}) => {
  await ensureIdle(request);
  await request.post('/api/wallet/fund');
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', {rate: 4});
  let delayRpc = true;
  await page.route('**/api/rpc', async route => {
    if (delayRpc) await new Promise(resolve => setTimeout(resolve, 600));
    await route.continue().catch(() => undefined);
  });
  await publishWithWatch(page, request);

  const feedback = (selector: string) => page.evaluate(target => new Promise<number>(resolve => {
    const element = document.querySelector(target) as HTMLElement;
    let pressedAt = 0;
    element.addEventListener('click', () => { pressedAt = performance.now(); }, {capture: true, once: true});
    new MutationObserver((_records, observer) => {
      observer.disconnect();
      requestAnimationFrame(() => resolve(performance.now() - pressedAt));
    }).observe(element, {attributes: true, childList: true, characterData: true, subtree: true});
  }), selector);

  const challengeFeedback = feedback('#challenge-button');
  await page.locator('#challenge-button').click();
  expect(await challengeFeedback, 'Challenge Prediction acknowledges the press within 100 ms while the deadline check is slow').toBeLessThan(100);
  await expect(page.getByRole('dialog', {name: 'Approve this challenge'})).toBeVisible();

  const approveFeedback = feedback('#approve-challenge');
  await page.locator('#approve-challenge').click();
  expect(await approveFeedback, 'Approve acknowledges the press within 100 ms').toBeLessThan(100);

  await expect(page.locator('#transaction-state')).toContainText(/signed and submitted|Signing and submitting/);
  await expect(page.locator('#forecast-status')).not.toContainText('accepted on chain');
  await expect(page.locator(STATE_LABEL)).toHaveText('Challenge submitted');
  await expect(page.locator(STATE_LABEL)).toHaveText('Challenge accepted', {timeout: 30_000});
  await client.send('Emulation.setCPUThrottlingRate', {rate: 1});
  delayRpc = false;
  await auditState(page, 'waiting for the deadline', {maximumPrimaryActions: 0});

  // Waiting is a steady state: nothing may be announced while the visitor waits.
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
  await page.waitForTimeout(7_000);
  expect(await page.evaluate(() => (globalThis as unknown as {__announcements: string[]}).__announcements)).toEqual([]);
  await ensureIdle(request);
});

test('a challenged round settles, then voids, with each state stated in text and shape and no action while progress is automatic', async ({page, request}) => {
  await ensureIdle(request);
  await request.post('/api/wallet/fund');
  await publishWithWatch(page, request);
  await challengeByClicks(page);
  await settlementScenario(request, 'stalled');
  await advance(request, 330);
  await expect(page.locator(STATE_LABEL)).toHaveText('Settling', {timeout: 30_000});
  await expect(page.locator('#settlement-state')).toContainText('The keeper requested the declared oracle');
  expect(await visiblePrimaryActions(page)).toEqual([]);
  await auditState(page, 'settling', {maximumPrimaryActions: 0});

  await advance(request, 120);
  await expect(page.locator(STATE_LABEL)).toHaveText('Void', {timeout: 30_000});
  await expect(page.locator('#forecast-status')).toContainText('Missing oracle data did not select a winner');
  await expect(page.locator('#settlement-state')).toContainText('refund remains paid on chain');
  await expect(page.getByRole('button', {name: 'Ask Reckon'})).toBeVisible();
  await auditState(page, 'void', {maximumPrimaryActions: 1});
});

test('a challenger win is announced as resolved with confirmed payment and no reveal step', async ({page, request}) => {
  await ensureIdle(request);
  await request.post('/api/wallet/fund');
  await publishWithWatch(page, request);
  await challengeByClicks(page);
  await settlementScenario(request, 'above');
  await advance(request, 300);
  await expect(page.locator(STATE_LABEL)).toHaveText('Resolved', {timeout: 30_000});
  await expect(page.locator('#forecast-status')).toContainText('resolved YES. Payment confirmed on chain');
  await expect(page.locator('#settlement-state')).toContainText('Payment confirmed on chain');
  await expect(page.getByRole('button', {name: /reveal/i})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Ask Reckon'})).toBeVisible();
  await auditState(page, 'resolved', {maximumPrimaryActions: 1});
});

test('a failed payout stays pending in words and shape until the receipt confirms, and recovery works from the keyboard', async ({page, request}) => {
  await ensureIdle(request);
  await request.post('/api/wallet/fund');
  await publishWithWatch(page, request);
  await challengeByClicks(page);
  await paymentScenario(request, 'fail');
  await settlementScenario(request, 'above');
  await advance(request, 300);

  await expect(page.locator(STATE_LABEL)).toHaveText('Payment pending', {timeout: 30_000});
  await expect(page.locator('#forecast-status')).toContainText('resolved YES. Payment is pending and not yet confirmed on chain');
  await expect(page.locator('#forecast-status')).not.toContainText(/Payment confirmed|paid/i);
  // The failed transfer's callback lands after the pending label first appears (in flight, then failed).
  await expect(page.locator('#payment-recovery-state')).toContainText('remains owed', {timeout: 30_000});
  await expect(page.locator('#payment-recovery-state')).toContainText('does not create a new wager');
  await expect(page.locator('#retry-payment-button')).toHaveText('Retry payment');
  await expect(page.getByRole('button', {name: 'Ask Reckon'})).toBeVisible();
  await auditState(page, 'payment failure', {maximumPrimaryActions: 1});
  expect(await visiblePrimaryActions(page), 'recovery of the existing obligation is the one primary action').toEqual(['Retry payment']);

  await paymentScenario(request, 'restore');
  await tabTo(page, '#retry-payment-button');
  await page.keyboard.press('Enter');
  await expect(page.locator(STATE_LABEL)).toHaveText('Resolved', {timeout: 30_000});
  await expect(page.locator('#forecast-status')).toContainText('Payment confirmed on chain');
  expect(await activeDescription(page), 'focus stays in the scene after recovery').not.toBe('body');
});

test('a transfer attempt in flight offers receipt verification, not a second transfer', async ({page, request}) => {
  await ensureIdle(request);
  await request.post('/api/wallet/fund');
  await publishWithWatch(page, request);
  await challengeByClicks(page);
  await paymentScenario(request, 'callback-fail');
  await settlementScenario(request, 'above');
  await advance(request, 300);

  await expect(page.locator(STATE_LABEL)).toHaveText('Payment pending', {timeout: 30_000});
  await expect(page.locator('#retry-payment-button')).toHaveText('Verify payment receipt');
  await expect(page.locator('#payment-recovery-state')).toContainText('may already have succeeded');
  await expect(page.locator('#forecast-status')).not.toContainText(/Payment confirmed|paid/i);
  await auditState(page, 'transfer in flight', {maximumPrimaryActions: 1, sweepViewports: false});
  expect(await visiblePrimaryActions(page)).toEqual(['Verify payment receipt']);
  await tabTo(page, '#retry-payment-button');
  // The keeper holds its recovery slot for part of every second, so a press can be told another recovery is in
  // progress (409). The page says so and the visitor presses again; the test does the same.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.keyboard.press('Enter');
    const resolved = await expect(page.locator(STATE_LABEL)).toHaveText('Resolved', {timeout: 8_000}).then(() => true, () => false);
    if (resolved) break;
    await expect(page.locator('#forecast-status')).toContainText('not accepted');
    expect(await activeDescription(page), 'focus stays on the recovery button after a refused press').toContain('Verify payment receipt');
  }
  await expect(page.locator(STATE_LABEL)).toHaveText('Resolved');
  await expect(page.locator('#forecast-status')).toContainText('Payment confirmed on chain');
  await paymentScenario(request, 'callback-restore');
});

test('conservative 2D shows identical essential information and actions without WebGL, with reduced motion, forced colours, a throttled CPU and no optional assets', async ({browser, request}) => {
  await ensureIdle(request);
  await request.post('/api/wallet/fund');
  await scenario(request, 'publish');
  expect((await request.post('/api/forecast', {data: {}})).status()).toBe(201);

  const conditions: {name: string; options?: Parameters<typeof browser.newContext>[0]; throttle?: number}[] = [
    {name: 'baseline'},
    {name: 'webgl-unavailable'},
    {name: 'reduced-motion', options: {reducedMotion: 'reduce'}},
    {name: 'forced-colors', options: {forcedColors: 'active'}},
    {name: 'cpu-throttled-6x', throttle: 6},
    {name: 'phone-viewport', options: {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true}},
  ];
  const captured = await Promise.all(conditions.map(async condition => {
    const context = await browser.newContext(condition.options);
    const page = await context.newPage();
    const requested: string[] = [];
    page.on('request', candidate => requested.push(new URL(candidate.url()).pathname));
    if (condition.name === 'webgl-unavailable') {
      await page.addInitScript(() => {
        const target = globalThis as unknown as {__contexts: string[]; WebGLRenderingContext?: unknown; WebGL2RenderingContext?: unknown};
        target.__contexts = [];
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
          target.__contexts.push(type);
          return /webgl/.test(type) ? null : (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
        } as typeof original;
        delete target.WebGLRenderingContext;
        delete target.WebGL2RenderingContext;
      });
    }
    if (condition.throttle) {
      const client = await context.newCDPSession(page);
      await client.send('Emulation.setCPUThrottlingRate', {rate: condition.throttle});
    }
    await page.goto('/');
    await expect(page.locator('#state-label')).toHaveText('Challenge open', {timeout: 25_000});
    // The public record loads separately; compare only once it has rendered every published row.
    await expect.poll(() => page.evaluate(async () => {
      const summary = await (await fetch('/api/predictions/summary')).json() as {published: string};
      return document.querySelectorAll('#prediction-record .record-entry').length === Math.min(50, Number(summary.published));
    }), {timeout: 25_000}).toBe(true);
    const essential = await page.evaluate(() => {
      const visible = (element: Element) => element.getClientRects().length > 0;
      const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();
      return {
        label: text(document.getElementById('state-label')!),
        headings: [...document.querySelectorAll('h1, h2, h3, h4')].filter(visible).map(text),
        terms: [...document.querySelectorAll('#prediction dt, #challenge-panel dt')].filter(visible).map(term => `${text(term)}: ${text(term.nextElementSibling!)}`),
        loss: text(document.getElementById('challenge-loss')!),
        actions: [...document.querySelectorAll('button, a[href]')].filter(visible).map(text),
        canvases: document.querySelectorAll('canvas').length,
        canvasContexts: (globalThis as unknown as {__contexts?: string[]}).__contexts ?? [],
      };
    });
    const tree = await page.locator('#prediction').ariaSnapshot();
    await context.close();
    return {name: condition.name, essential, tree, requested};
  }));

  const baseline = captured[0];
  expect(baseline.essential.terms.length).toBeGreaterThanOrEqual(12);
  expect(baseline.essential.actions).toContain('Challenge Prediction');
  const comparable = (entry: typeof baseline) => ({...entry.essential, canvases: undefined, canvasContexts: undefined});
  for (const entry of captured.slice(1)) {
    expect(comparable(entry), `${entry.name}: essential information and actions match the baseline`).toEqual(comparable(baseline));
    expect(entry.tree, `${entry.name}: accessibility tree of the prediction`).toBe(baseline.tree);
  }
  for (const entry of captured) {
    expect(entry.essential.canvases, `${entry.name}: no canvas is ever created`).toBe(0);
    expect(entry.essential.canvasContexts, `${entry.name}: no WebGL or canvas context is requested`).toEqual([]);
    const optional = entry.requested.filter(path => !['/', '/app.js', '/style.css', '/favicon.ico'].includes(path) && !path.startsWith('/api/'));
    expect(optional, `${entry.name}: nothing beyond the core document, script and stylesheet is fetched`).toEqual([]);
  }
  await ensureIdle(request);
});

test('reduced motion removes every transition and animation while the state and its terms stay intact', async ({browser, request}) => {
  await ensureIdle(request);
  await scenario(request, 'publish');
  expect((await request.post('/api/forecast', {data: {}})).status()).toBe(201);
  const motion = async (reducedMotion: 'reduce' | 'no-preference') => {
    const context = await browser.newContext({reducedMotion});
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.locator(STATE_LABEL)).toHaveText('Challenge open', {timeout: 25_000});
    const result = await page.evaluate(() => {
      const elements = [...document.querySelectorAll('*')];
      return {
        running: document.getAnimations().length,
        transitioned: elements.filter(element => parseFloat(getComputedStyle(element).transitionDuration) > 0).length,
        animated: elements.filter(element => getComputedStyle(element).animationName !== 'none').length,
        terms: document.querySelectorAll('#challenge-panel dt').length,
      };
    });
    await context.close();
    return result;
  };
  const reduced = await motion('reduce');
  expect(reduced.running).toBe(0);
  expect(reduced.transitioned).toBe(0);
  expect(reduced.animated).toBe(0);
  const normal = await motion('no-preference');
  expect(normal.transitioned, 'the default experience keeps only brief control feedback').toBeGreaterThan(0);
  expect(reduced.terms).toBe(normal.terms);
  await ensureIdle(request);
});

test('death is stated in text and shape, keeps the public record readable and offers no new forecast', async ({page, request}) => {
  await ensureIdle(request);
  await settlementScenario(request, 'below');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const state = await life(request);
    if (state.dead) break;
    await advance(request, Math.min(10_000, Number(BigInt(state.remaining_life_ns) / 1_000_000_000n) + 5));
  }
  expect((await life(request)).dead).toBe(true);
  expect((await request.post('/test/accrue')).status()).toBe(204);

  await page.goto('/');
  await expect(page.locator(STATE_LABEL)).toHaveText('Dead');
  await expect(page.locator('#life-state')).toHaveText('Depleted · permanently dead');
  await expect(page.locator('#death-date')).toContainText('Death date:');
  await expect(page.locator('#glyph')).toHaveAttribute('data-state', 'dead');
  await expect(page.locator('#forecast-status')).toContainText('permanently dead');
  await expect(page.getByRole('button', {name: 'Ask Reckon'})).toBeHidden();
  await expect(page.getByRole('button', {name: 'Just watch'})).toBeHidden();
  expect(await visiblePrimaryActions(page)).toEqual([]);
  await expect(page.getByRole('heading', {name: 'Published predictions and results'})).toBeVisible();
  expect(await page.locator('.record-entry').count()).toBeGreaterThan(0);
  await expect(page.getByRole('link', {name: 'Download evidence snapshot'})).toBeVisible();
  await auditState(page, 'dead', {maximumPrimaryActions: 0});
});
