import {execFile} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import os from 'node:os';
import process from 'node:process';
import {promisify} from 'node:util';
import {brotliCompressSync, constants, gzipSync} from 'node:zlib';
import {test, expect, type CDPSession, type Page} from '@playwright/test';
import {advance, ensureIdle, scenario, settlementScenario} from './support.js';

// Emulated-device measurement run. It only runs through `npm run measure:experience` (RECKON_MEASURE=1), against a
// fresh service, and writes docs/evidence/accessibility-performance.json. Nothing here is a real-device result.

interface Profile {
  id: 'mobile' | 'laptop';
  description: string;
  viewport: {width: number; height: number};
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  cpuThrottlingRate: number;
}

const PROFILES: Profile[] = [
  {
    id: 'mobile',
    description: 'Emulated mid-range mobile: 390x844 CSS px, device scale factor 3, touch, mobile viewport, 4x CPU throttling',
    viewport: {width: 390, height: 844}, deviceScaleFactor: 3, isMobile: true, hasTouch: true, cpuThrottlingRate: 4,
  },
  {
    id: 'laptop',
    description: 'Emulated integrated-graphics laptop: 1440x900 CSS px, device scale factor 1, no CPU throttling',
    viewport: {width: 1440, height: 900}, deviceScaleFactor: 1, isMobile: false, hasTouch: false, cpuThrottlingRate: 1,
  },
];

const FRAME_BUDGET_MS = 1000 / 60;
const ON_TIME_FRAME_MS = 18.5; // one 60 Hz frame plus about 10% scheduling jitter
const MISSED_FRAME_MS = 25; // more than 1.5 frame intervals: at least one display refresh was skipped
const TARGETS = {coreJsKb: 200, coreCssKb: 30, fontsKb: 100, feedbackMs: 100, layoutShift: 0.1, maximumMissedFrameShare: 0.05};

interface ProbeApi {
  start(): void;
  stop(): number[];
  state(): {shift: number; shiftWithoutRecentInput: number; shiftEntries: number; paints: Record<string, number>; events: {name: string; duration: number}[]; longFrames: {duration: number; blocking: number}[]};
}

async function installProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const target = globalThis as unknown as {__probe: ProbeApi};
    const frames: number[] = [];
    let last = 0;
    let recording = false;
    let shift = 0;
    let shiftWithoutRecentInput = 0;
    let shiftEntries = 0;
    const paints: Record<string, number> = {};
    const events: {name: string; duration: number}[] = [];
    const longFrames: {duration: number; blocking: number}[] = [];
    const tick = (now: number) => {
      if (!recording) return;
      if (last) frames.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    const observe = (type: string, handler: (entries: PerformanceEntryList) => void, extra: object = {}) => {
      try {
        new PerformanceObserver(list => handler(list.getEntries())).observe({type, buffered: true, ...extra} as PerformanceObserverInit);
      } catch { /* The entry type is not supported by this browser build. */ }
    };
    observe('layout-shift', entries => {
      for (const entry of entries as unknown as {value: number; hadRecentInput: boolean}[]) {
        shift += entry.value;
        shiftEntries += 1;
        if (!entry.hadRecentInput) shiftWithoutRecentInput += entry.value;
      }
    });
    observe('paint', entries => { for (const entry of entries) paints[entry.name] = entry.startTime; });
    observe('largest-contentful-paint', entries => { for (const entry of entries) paints['largest-contentful-paint'] = entry.startTime; });
    observe('event', entries => { for (const entry of entries) events.push({name: entry.name, duration: entry.duration}); }, {durationThreshold: 16});
    observe('long-animation-frame', entries => {
      for (const entry of entries as unknown as {duration: number; blockingDuration: number}[]) longFrames.push({duration: entry.duration, blocking: entry.blockingDuration});
    });
    target.__probe = {
      start() { frames.length = 0; last = 0; recording = true; requestAnimationFrame(tick); },
      stop() { recording = false; return frames.slice(); },
      state: () => ({shift, shiftWithoutRecentInput, shiftEntries, paints: {...paints}, events: events.slice(), longFrames: longFrames.slice()}),
    };
  });
}

function summarize(intervals: number[]) {
  const sorted = [...intervals].sort((a, b) => a - b);
  const at = (share: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] : 0;
  const mean = intervals.reduce((sum, value) => sum + value, 0) / (intervals.length || 1);
  return {
    frames: intervals.length,
    mean_ms: round(mean),
    p50_ms: round(at(0.5)),
    p95_ms: round(at(0.95)),
    p99_ms: round(at(0.99)),
    max_ms: round(sorted.at(-1) ?? 0),
    frames_over_on_time_threshold: intervals.filter(value => value > ON_TIME_FRAME_MS).length,
    missed_frames: intervals.filter(value => value > MISSED_FRAME_MS).length,
    skipped_display_refreshes: intervals.reduce((sum, value) => sum + Math.max(0, Math.round(value / FRAME_BUDGET_MS) - 1), 0),
    mean_fps: intervals.length ? round(1000 / mean) : 0,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

const sizeOf = (body: Buffer) => ({
  raw_bytes: body.length,
  gzip_bytes: gzipSync(body, {level: 9}).length,
  brotli_bytes: brotliCompressSync(body, {params: {[constants.BROTLI_PARAM_QUALITY]: 11}}).length,
});

async function activeWindow(page: Page, name: string, action: () => Promise<void>, settleMs = 500) {
  await page.evaluate(() => (globalThis as unknown as {__probe: ProbeApi}).__probe.start());
  await action();
  await page.waitForTimeout(settleMs);
  const intervals = await page.evaluate(() => (globalThis as unknown as {__probe: ProbeApi}).__probe.stop());
  return {intervals, summary: {window: name, ...summarize(intervals)}};
}

/** Time from the press to the first visible acknowledgement (the frame after the first DOM change). */
async function pressFeedback(page: Page, selector: string): Promise<number> {
  const feedback = page.evaluate(target => new Promise<number>(resolve => {
    const element = document.querySelector(target) as HTMLElement;
    let pressedAt = 0;
    element.addEventListener('click', () => { pressedAt = performance.now(); }, {capture: true, once: true});
    new MutationObserver((_records, observer) => {
      observer.disconnect();
      requestAnimationFrame(() => resolve(performance.now() - pressedAt));
    }).observe(element, {attributes: true, childList: true, characterData: true, subtree: true});
  }), selector);
  await page.locator(selector).click();
  return round(await feedback);
}

async function runProfile(profile: Profile, browser: import('@playwright/test').Browser, request: import('@playwright/test').APIRequestContext) {
  await ensureIdle(request);
  await request.post('/api/wallet/fund');
  await scenario(request, 'publish');
  await settlementScenario(request, 'above');

  const context = await browser.newContext({
    viewport: profile.viewport, deviceScaleFactor: profile.deviceScaleFactor, isMobile: profile.isMobile, hasTouch: profile.hasTouch,
  });
  const page = await context.newPage();
  const client: CDPSession = await context.newCDPSession(page);
  await client.send('Network.enable');
  await client.send('Performance.enable');
  const requests = new Map<string, {url: string; type: string; encoded: number; decoded: number}>();
  client.on('Network.responseReceived', event => requests.set(event.requestId, {url: event.response.url, type: event.type, encoded: 0, decoded: 0}));
  client.on('Network.dataReceived', event => { const entry = requests.get(event.requestId); if (entry) entry.decoded += event.dataLength; });
  client.on('Network.loadingFinished', event => { const entry = requests.get(event.requestId); if (entry) entry.encoded = event.encodedDataLength; });
  const transferred = () => {
    const totals: Record<string, number> = {};
    let all = 0;
    for (const entry of requests.values()) {
      totals[entry.type] = (totals[entry.type] ?? 0) + entry.encoded;
      all += entry.encoded;
    }
    return {total_bytes: all, by_resource_type: totals, requests: requests.size};
  };
  await installProbe(page);
  await client.send('Emulation.setCPUThrottlingRate', {rate: profile.cpuThrottlingRate});

  const loadStartedAt = Date.now();
  await page.goto('/');
  // A later profile loads the previous round's result instead of the idle scene; either is a usable first scene.
  await expect(page.locator('#state-label')).toHaveText(/^(Idle|Resolved|Void)$/);
  await expect(page.locator('#wallet-state')).toContainText('EPHEMERAL SANDBOX KEY');
  const firstUsableSceneMs = Date.now() - loadStartedAt;
  await page.waitForTimeout(1_000);
  const initialTransfer = transferred();
  const initialProbe = await page.evaluate(() => (globalThis as unknown as {__probe: ProbeApi}).__probe.state());
  const wallClockTiming = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    return {dom_content_loaded_ms: navigation.domContentLoadedEventEnd, load_event_ms: navigation.loadEventEnd};
  });

  const windows = [];
  const feedback: Record<string, number> = {};
  // Journey: request, approve, wait, result. Each step is one active window.
  windows.push(await activeWindow(page, 'request-to-approval', async () => {
    feedback['Ask Reckon'] = await pressFeedback(page, '#ask-button');
    await expect(page.getByRole('dialog', {name: 'Approve this challenge'})).toBeVisible({timeout: 30_000});
  }));
  windows.push(await activeWindow(page, 'approval-to-accepted', async () => {
    feedback['Approve stake in local wallet'] = await pressFeedback(page, '#approve-challenge');
    await expect(page.locator('#state-label')).toHaveText('Challenge accepted', {timeout: 30_000});
  }));

  // Quiet window: with nothing changing the page must not do continuous rendering work.
  const before = await client.send('Performance.getMetrics');
  await page.waitForTimeout(3_000);
  const after = await client.send('Performance.getMetrics');
  const metric = (snapshot: typeof before, name: string) => snapshot.metrics.find(entry => entry.name === name)?.value ?? 0;
  const quiet = Object.fromEntries(['LayoutCount', 'RecalcStyleCount', 'TaskDuration', 'ScriptDuration'].map(name => [name, round(metric(after, name) - metric(before, name))]));

  windows.push(await activeWindow(page, 'waiting-to-result', async () => {
    await advance(request, 300);
    await expect(page.locator('#state-label')).toHaveText('Resolved', {timeout: 30_000});
  }, 800));

  windows.push(await activeWindow(page, 'scroll-whole-page', async () => {
    if (profile.hasTouch) {
      await client.send('Input.synthesizeScrollGesture', {x: profile.viewport.width / 2, y: profile.viewport.height * 0.8, yDistance: -3000, speed: 1800, gestureSourceType: 'touch'});
    } else {
      for (let step = 0; step < 12; step += 1) {
        await page.mouse.wheel(0, 250);
        await page.waitForTimeout(40);
      }
    }
  }, 600));

  const journeyTransfer = transferred();
  const finalProbe = await page.evaluate(() => (globalThis as unknown as {__probe: ProbeApi}).__probe.state());
  await context.close();

  const allIntervals = windows.flatMap(entry => entry.intervals);
  const active = summarize(allIntervals);
  return {
    profile: {id: profile.id, description: profile.description, viewport: profile.viewport, device_scale_factor: profile.deviceScaleFactor, touch: profile.hasTouch, cpu_throttling_rate: profile.cpuThrottlingRate},
    first_usable_scene_ms: firstUsableSceneMs,
    navigation_timing: wallClockTiming,
    paint_ms: initialProbe.paints,
    transferred_initial_load: initialTransfer,
    transferred_whole_journey: journeyTransfer,
    active_frames_overall: active,
    active_frame_windows: windows.map(entry => entry.summary),
    local_feedback_ms: feedback,
    quiet_window_3s: {description: 'Browser work counters over 3 s with nothing changing, no animation frame probe running', ...quiet},
    layout_shift: {
      cumulative_total: round(finalProbe.shift * 10_000) / 10_000,
      cumulative_without_recent_input: round(finalProbe.shiftWithoutRecentInput * 10_000) / 10_000,
      entries: finalProbe.shiftEntries,
      before_first_usable_scene: round(initialProbe.shift * 10_000) / 10_000,
    },
    event_timing_over_16ms: finalProbe.events,
    long_animation_frames: finalProbe.longFrames,
  };
}

test('emulated reference profiles meet or honestly report the frame, feedback, shift and byte targets', async ({browser, request}) => {
  test.setTimeout(900_000);
  const exec = promisify(execFile);
  const metafile = '.local/runtime/bundle-meta.json';
  await exec('node_modules/.bin/esbuild', ['public/app.js', '--bundle', '--minify', '--format=esm', '--platform=browser', '--target=es2022', `--metafile=${metafile}`, '--outfile=.local/runtime/measure-bundle.js', '--log-level=error']);
  const meta = JSON.parse(await readFile(metafile, 'utf8')) as {outputs: Record<string, {inputs: Record<string, {bytesInOutput: number}>}>};
  const inputs = Object.values(meta.outputs)[0].inputs;
  const walletCryptoBytes = Object.entries(inputs).filter(([path]) => /node_modules\/(@noble|@scure)/.test(path)).reduce((sum, [, entry]) => sum + entry.bytesInOutput, 0);

  const script = Buffer.from(await (await request.get('/app.js')).body());
  const stylesheet = Buffer.from(await (await request.get('/style.css')).body());
  const document = Buffer.from(await (await request.get('/')).body());
  const assets = {
    core_js: {...sizeOf(script), wallet_crypto_share_of_minified_bytes: walletCryptoBytes},
    core_css: sizeOf(stylesheet),
    html_document: sizeOf(document),
    fonts: {raw_bytes: 0, gzip_bytes: 0, brotli_bytes: 0, note: 'No web font files ship. The page uses the system UI font stack.'},
    lazy_wallet_chunk: {raw_bytes: 0, note: 'Wallet signing code is part of the core bundle; there is no separately loaded wallet chunk.'},
    optional_graphics: {raw_bytes: 0, note: 'No optional 3D or WebGL asset exists.'},
  };

  const results = [];
  for (const profile of PROFILES) results.push(await runProfile(profile, browser, request));

  const chromiumVersion = browser.version();
  const evidence = {
    measurement_kind: 'emulated measurement, not a real-device result',
    real_device_results: false,
    generated_at: new Date().toISOString(),
    environment: {
      browser: `Chromium headless shell ${chromiumVersion} (Playwright)`,
      host_os: `${os.type()} ${os.release()} (${os.arch()})`,
      host_cpu: `${os.cpus()[0]?.model ?? 'unknown'} x${os.cpus().length}`,
      node: process.version,
      server: 'local service serving fixture providers over loopback, assets uncompressed',
    },
    targets: TARGETS,
    pass_criteria: {
      frames: `at least 95% of active frames within ${MISSED_FRAME_MS} ms (missed frame = interval over ${MISSED_FRAME_MS} ms) and p95 under ${ON_TIME_FRAME_MS} ms`,
      feedback: 'every pressed control shows a visible acknowledgement in the next frame within 100 ms',
      layout_shift: 'cumulative layout shift over the whole journey, counting shifts after input as well',
    },
    assets,
    profiles: results,
    limitations: [
      'Emulated profiles on one development host, not a real mid-range phone: CPU throttling slows JavaScript and layout but does not reproduce a phone GPU, memory pressure, thermal limits or touch hardware.',
      'The headless shell composites in software with no display, so frame intervals come from requestAnimationFrame and are not presented frames on a screen.',
      'Network is loopback with uncompressed responses; transfer sizes are as served locally. Gzip and brotli figures are computed offline from the same bytes.',
      'Provider inputs are scripted fixtures and the chain is a local sandbox, so inference, oracle and RPC latency are not representative of testnet.',
      'The journey covers one funded-wallet round on each profile; other states are covered functionally by the state suite, not measured for frame time.',
    ],
  };

  const checks = results.map(result => {
    const feedbackWorst = Math.max(...Object.values(result.local_feedback_ms));
    const missedShare = result.active_frames_overall.missed_frames / (result.active_frames_overall.frames || 1);
    return {
      profile: result.profile.id,
      frame_time_target_met: missedShare <= TARGETS.maximumMissedFrameShare && result.active_frames_overall.p95_ms <= ON_TIME_FRAME_MS,
      missed_frame_share: round(missedShare),
      feedback_target_met: feedbackWorst <= TARGETS.feedbackMs,
      worst_feedback_ms: feedbackWorst,
      layout_shift_target_met: result.layout_shift.cumulative_total <= TARGETS.layoutShift,
    };
  });
  const byteChecks = {
    core_js_target_met: assets.core_js.gzip_bytes <= TARGETS.coreJsKb * 1024 && assets.core_js.brotli_bytes <= TARGETS.coreJsKb * 1024,
    core_css_target_met: assets.core_css.gzip_bytes <= TARGETS.coreCssKb * 1024 && assets.core_css.brotli_bytes <= TARGETS.coreCssKb * 1024,
    fonts_target_met: assets.fonts.gzip_bytes <= TARGETS.fontsKb * 1024,
  };
  await mkdir('docs/evidence', {recursive: true});
  await writeFile('docs/evidence/accessibility-performance.json', `${JSON.stringify({...evidence, target_results: {profiles: checks, bytes: byteChecks}}, null, 2)}\n`);

  for (const check of checks) {
    expect(check.frame_time_target_met, `${check.profile}: frame-time target (missed-frame share ${check.missed_frame_share})`).toBe(true);
    expect(check.feedback_target_met, `${check.profile}: worst control feedback ${check.worst_feedback_ms} ms`).toBe(true);
    expect(check.layout_shift_target_met, `${check.profile}: layout shift`).toBe(true);
  }
  expect(byteChecks).toEqual({core_js_target_met: true, core_css_target_met: true, fonts_target_met: true});
});
