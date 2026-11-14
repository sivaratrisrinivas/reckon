import {expect, type APIRequestContext, type Page} from '@playwright/test';

export interface PredictionView {
  id: string;
  challenger_stake: string;
  agent_stake: string;
  challenger_account_id: string | null;
  challenge_deadline_ns: string;
  deadline_ns: string;
  outcome: string | null;
  settlement_status: string;
  payment: {status: string; transfer_in_flight?: boolean} | null;
}

// ---- Real-service state drivers (every state comes from the sandbox contract and the test endpoints). ----

export async function scenario(request: APIRequestContext, value: string): Promise<void> {
  expect((await request.post('/test/forecast-scenario', {data: {scenario: value}})).status()).toBe(204);
  await request.post('/test/reset-forecast-limits');
}

export async function settlementScenario(request: APIRequestContext, value: string): Promise<void> {
  expect((await request.post('/test/settlement-scenario', {data: {scenario: value}})).status()).toBe(204);
}

export async function paymentScenario(request: APIRequestContext, value: string): Promise<void> {
  expect((await request.post('/test/payment-scenario', {data: {scenario: value}})).status()).toBe(204);
}

export async function walletScenario(request: APIRequestContext, value: string): Promise<void> {
  expect((await request.post('/test/wallet-scenario', {data: {scenario: value}})).status()).toBe(204);
}

export async function advance(request: APIRequestContext, seconds: number): Promise<void> {
  expect((await request.post('/test/advance', {data: {seconds}})).status()).toBe(204);
}

export async function activePrediction(request: APIRequestContext): Promise<PredictionView | null> {
  return (await (await request.get('/api/predictions/active')).json()).prediction;
}

export async function life(request: APIRequestContext): Promise<{dead: boolean; remaining_life_ns: string}> {
  return (await request.get('/api/life')).json();
}

/** Settle any round a previous test left open so the next test starts from an idle agent. */
export async function ensureIdle(request: APIRequestContext): Promise<void> {
  // Only rebuild the challenger account when a previous test left it deleted.
  if ((await request.get('/api/wallet/balance')).status() !== 200) await paymentScenario(request, 'restore').catch(() => undefined);
  await settlementScenario(request, 'below');
  // Small steps: once the deadline passes the keeper must get its oracle request in before the 120 s cutoff, or the round voids.
  for (let attempt = 0; attempt < 12 && await activePrediction(request); attempt += 1) {
    await advance(request, 50);
    await new Promise(resolve => setTimeout(resolve, 1_500));
  }
  await walletScenario(request, 'sandbox');
}

export function formatNear(amount: string): string {
  const near = 10n ** 24n;
  const value = BigInt(amount);
  const whole = value / near;
  const fraction = (value % near).toString().padStart(24, '0').replace(/0+$/, '');
  return `${whole}.${fraction || '0'} NEAR`;
}

// ---- Keyboard helpers. ----

/** Tab until the element matching the selector holds focus; fails when it is not reachable. */
export async function tabTo(page: Page, selector: string, maximumTabs = 80): Promise<number> {
  for (let tabs = 1; tabs <= maximumTabs; tabs += 1) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(candidate => document.activeElement?.matches(candidate) ?? false, selector);
    if (focused) return tabs;
  }
  throw new Error(`${selector} was not reachable with the keyboard within ${maximumTabs} Tab presses`);
}

export async function activeDescription(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return 'body';
    return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''} "${(element.textContent ?? '').trim().slice(0, 40)}"`;
  });
}

// ---- Layout shift collection (installed before every document, reports every shift including input-driven ones). ----

export async function observeLayoutShift(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const target = globalThis as unknown as {__reckonShift: number; __reckonShiftEntries: {value: number; sources: string[]}[]};
    target.__reckonShift = 0;
    target.__reckonShiftEntries = [];
    new PerformanceObserver(list => {
      for (const entry of list.getEntries() as unknown as {value: number; sources?: {node?: Node}[]}[]) {
        target.__reckonShift += entry.value;
        target.__reckonShiftEntries.push({
          value: entry.value,
          sources: (entry.sources ?? []).map(source => {
            const node = source.node as Element | undefined;
            return node?.id ? `#${node.id}` : (node?.nodeName ?? 'unknown');
          }),
        });
      }
    }).observe({type: 'layout-shift', buffered: true});
  });
}

export async function layoutShift(page: Page): Promise<{total: number; entries: {value: number; sources: string[]}[]}> {
  return page.evaluate(() => {
    const target = globalThis as unknown as {__reckonShift: number; __reckonShiftEntries: {value: number; sources: string[]}[]};
    return {total: target.__reckonShift, entries: target.__reckonShiftEntries};
  });
}

// ---- Audits. Each function returns human-readable issues; the spec asserts that the list is empty. ----

/** In-page audit of the visible controls and text at the current viewport and text size. */
export async function auditControlsAndText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const issues: string[] = [];
    const modal = document.querySelector('dialog:modal');
    const scope: ParentNode = modal ?? document;
    const isVisible = (element: Element): boolean => {
      const style = getComputedStyle(element);
      return element.getClientRects().length > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const label = (element: Element): string => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}`;
    const accessibleName = (element: Element): string => {
      const aria = element.getAttribute('aria-label');
      if (aria) return aria.trim();
      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) return labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ').trim();
      return (element.textContent ?? '').trim();
    };

    const controls = [...scope.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(isVisible);
    for (const control of controls) {
      if (!accessibleName(control)) issues.push(`${label(control)} has no accessible name`);
      const box = control.getBoundingClientRect();
      const minimum = control.tagName === 'A' ? 24 : 44;
      if (box.height < minimum - 0.5 || box.width < minimum - 0.5) {
        issues.push(`${label(control)} target is ${Math.round(box.width)}x${Math.round(box.height)} px, below ${minimum}`);
      }
      if (box.left < -0.5 || box.right > innerWidth + 0.5) issues.push(`${label(control)} extends outside the ${innerWidth}px viewport`);
    }
    const buttons = controls.filter(control => control.tagName === 'BUTTON');
    for (let first = 0; first < buttons.length; first += 1) {
      for (let second = first + 1; second < buttons.length; second += 1) {
        const a = buttons[first].getBoundingClientRect();
        const b = buttons[second].getBoundingClientRect();
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) {
          issues.push(`${label(buttons[first])} overlaps ${label(buttons[second])}`);
        }
      }
    }

    if (document.documentElement.scrollWidth > innerWidth + 1) {
      const wide = [...document.body.querySelectorAll('*')]
        .filter(element => isVisible(element) && element.getBoundingClientRect().right > innerWidth + 1)
        .slice(0, 4)
        .map(element => `${label(element)}.${element.className || '-'} right edge ${Math.round(element.getBoundingClientRect().right)}px`);
      issues.push(`page scrolls horizontally: ${document.documentElement.scrollWidth}px content in a ${innerWidth}px viewport; widest: ${wide.join('; ')}`);
    }
    for (const element of document.body.querySelectorAll('*')) {
      if (!isVisible(element) || element.closest('dialog:not([open])')) continue;
      const style = getComputedStyle(element);
      if (/(hidden|clip)/.test(style.overflowX + style.overflowY) && (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)) {
        issues.push(`${label(element)} clips its content`);
      }
    }
    return issues;
  });
}

/** Computes WCAG contrast of every visible text node from computed styles; disabled controls are exempt. */
export async function auditContrast(page: Page): Promise<string[]> {
  // A panel fading in is briefly translucent; contrast belongs to the settled state.
  await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => undefined))));
  return page.evaluate(() => {
    type Color = {r: number; g: number; b: number; a: number};
    const parse = (value: string): Color => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return {r: 0, g: 0, b: 0, a: 0};
      const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return {r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1};
    };
    const over = (top: Color, bottom: Color): Color => {
      const alpha = top.a + bottom.a * (1 - top.a);
      if (alpha === 0) return {r: 0, g: 0, b: 0, a: 0};
      const mix = (front: number, back: number) => (front * top.a + back * bottom.a * (1 - top.a)) / alpha;
      return {r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: alpha};
    };
    const luminance = (color: Color): number => {
      const channel = (value: number) => {
        const unit = value / 255;
        return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
    };
    const ratio = (first: Color, second: Color): number => {
      const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
      return (lighter + 0.05) / (darker + 0.05);
    };
    const backgroundBehind = (element: Element): Color => {
      const layers: Color[] = [];
      for (let current: Element | null = element; current; current = current.parentElement) {
        const color = parse(getComputedStyle(current).backgroundColor);
        if (color.a > 0) layers.push(color);
        if (color.a >= 1) break;
      }
      let result: Color = {r: 18, g: 18, b: 18, a: 1};
      for (const layer of layers.reverse()) result = over(layer, result);
      return result;
    };
    const effectiveOpacity = (element: Element): number => {
      let opacity = 1;
      for (let current: Element | null = element; current; current = current.parentElement) opacity *= Number(getComputedStyle(current).opacity);
      return opacity;
    };
    const issues: string[] = [];
    for (const element of document.body.querySelectorAll('*')) {
      const hasText = [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim());
      if (!hasText || element.getClientRects().length === 0) continue;
      if (element.closest('[aria-hidden="true"], :disabled, dialog:not([open])')) continue;
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden') continue;
      const background = backgroundBehind(element);
      const foreground = parse(style.color);
      const opacity = effectiveOpacity(element);
      const text = over({...foreground, a: foreground.a * opacity}, background);
      const size = parseFloat(style.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      const required = large ? 3 : 4.5;
      const measured = ratio(text, background);
      if (measured < required) {
        issues.push(`contrast ${measured.toFixed(2)} below ${required} for ${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''} "${(element.textContent ?? '').trim().slice(0, 40)}" (${style.color} on rgb(${Math.round(background.r)},${Math.round(background.g)},${Math.round(background.b)}))`);
      }
      if (size < 12 - 0.01) issues.push(`text is ${size.toFixed(1)} px, below the 12 px metadata minimum: ${(element.textContent ?? '').trim().slice(0, 40)}`);
    }
    return issues;
  });
}

/** Visible primary actions: enabled and disabled buttons styled as the one primary treatment. */
export async function visiblePrimaryActions(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const scope: ParentNode = document.querySelector('dialog:modal') ?? document;
    // A busy or inert control (aria-disabled or disabled) reports progress; it is not an available action.
    return [...scope.querySelectorAll('button.primary:not([aria-disabled="true"]):not(:disabled)')]
      .filter(button => button.getClientRects().length > 0 && getComputedStyle(button).visibility !== 'hidden')
      .map(button => (button.textContent ?? '').trim());
  });
}

/** Finds animations that would run forever or exceed the brief transition budget. */
export async function auditMotion(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const issues: string[] = [];
    for (const animation of document.getAnimations()) {
      const timing = animation.effect?.getComputedTiming();
      if (!timing) continue;
      const target = (animation.effect as KeyframeEffect).target as Element | null;
      const name = `${target?.tagName.toLowerCase() ?? 'unknown'}${target?.id ? `#${target.id}` : ''}`;
      if (timing.iterations === Infinity) issues.push(`${name} animates forever`);
      if (Number(timing.duration) > 300) issues.push(`${name} animation lasts ${timing.duration} ms, over 300 ms`);
    }
    return issues;
  });
}

const AUDIT_VIEWPORTS = [
  {width: 320, height: 640},
  {width: 390, height: 844},
  {width: 1440, height: 900},
];

export interface StateAuditOptions {
  /** Highest number of visible primary actions the state may show. */
  maximumPrimaryActions: number;
  /** Text-size and viewport sweep is costly; states that only change copy may skip it. */
  sweepViewports?: boolean;
}

/** Runs the shared accessibility audit for the state currently on screen. */
export async function auditState(page: Page, name: string, options: StateAuditOptions): Promise<void> {
  const original = page.viewportSize() ?? {width: 1280, height: 720};
  // Layout shift since the previous audit, read before the viewport and text-size sweep causes shifts of its own.
  const shifted = await page.evaluate(() => {
    const target = globalThis as unknown as {__reckonShift?: number; __reckonShiftBase?: number};
    return (target.__reckonShift ?? 0) - (target.__reckonShiftBase ?? 0);
  });
  const shiftSources = await page.evaluate(() => JSON.stringify((globalThis as unknown as {__reckonShiftEntries?: unknown[]}).__reckonShiftEntries ?? []).slice(0, 700));
  expect(shifted, `${name}: layout shift since the previous state: ${shiftSources}`).toBeLessThanOrEqual(0.1);
  const primary = await visiblePrimaryActions(page);
  expect(primary.length, `${name}: at most one primary action, found ${JSON.stringify(primary)}`).toBeLessThanOrEqual(options.maximumPrimaryActions);
  expect(await auditContrast(page), `${name}: contrast and metadata size`).toEqual([]);
  expect(await auditMotion(page), `${name}: motion`).toEqual([]);
  if (options.sweepViewports !== false) {
    for (const viewport of AUDIT_VIEWPORTS) {
      await page.setViewportSize(viewport);
      expect(await auditControlsAndText(page), `${name}: ${viewport.width}px viewport`).toEqual([]);
    }
    for (const viewport of [AUDIT_VIEWPORTS[1], AUDIT_VIEWPORTS[2]]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
      expect(await auditControlsAndText(page), `${name}: ${viewport.width}px viewport at 200% text`).toEqual([]);
      await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    }
    await page.setViewportSize(original);
  }
  await page.evaluate(() => {
    const target = globalThis as unknown as {__reckonShift?: number; __reckonShiftBase?: number};
    target.__reckonShiftBase = target.__reckonShift ?? 0;
  });
}

/** WCAG contrast ratio between two CSS colours given as #rrggbb or rgb(r, g, b). */
export function contrastRatio(foreground: string, background: string): number {
  const channels = (value: string): number[] => {
    const hex = value.trim().match(/^#([0-9a-f]{6})$/i);
    if (hex) return [0, 2, 4].map(offset => parseInt(hex[1].slice(offset, offset + 2), 16));
    const rgb = value.match(/rgba?\(([^)]+)\)/);
    if (!rgb) throw new Error(`Unsupported colour: ${value}`);
    return rgb[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3).map(Number);
  };
  const luminance = (value: string): number => {
    const [r, g, b] = channels(value).map(channel => {
      const unit = channel / 255;
      return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}
