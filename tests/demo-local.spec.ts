import {expect, test} from '@playwright/test';
import {spawn, type ChildProcess} from 'node:child_process';
import {existsSync, readdirSync, readFileSync} from 'node:fs';

// These tests run the reviewer's command, `npm run demo:local`, as a black box: its exit status, its
// narrated output and the processes and files it leaves behind are the observable results.

type Run = {child: ChildProcess; output: () => string; exited: Promise<number | null>};

function runDemo(args: string[] = [], environment: NodeJS.ProcessEnv = {}): Run {
  let transcript = '';
  const child = spawn('npm', ['run', '--silent', 'demo:local', ...(args.length ? ['--', ...args] : [])], {
    env: {...process.env, ...environment},
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', chunk => { transcript += chunk.toString(); });
  child.stderr?.on('data', chunk => { transcript += chunk.toString(); });
  const exited = new Promise<number | null>(done => child.once('exit', code => done(code)));
  return {child, output: () => transcript, exited};
}

function workDirectory(transcript: string): string {
  const directory = /Private work directory \(removed on exit\): (\S+)/.exec(transcript)?.[1];
  if (!directory) throw new Error(`The demo did not announce its work directory:\n${transcript}`);
  return directory;
}

function processesReferencing(directory: string): number[] {
  return readdirSync('/proc').filter(entry => /^\d+$/.test(entry)).flatMap(entry => {
    try { return readFileSync(`/proc/${entry}/cmdline`, 'utf8').includes(directory) ? [Number(entry)] : []; } catch { return []; }
  });
}

async function waitForOutput(run: Run, pattern: RegExp, timeoutMs: number): Promise<RegExpExecArray> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const match = pattern.exec(run.output());
    if (match) return match;
    if (run.child.exitCode !== null) throw new Error(`The demo exited with code ${run.child.exitCode} before printing ${pattern}:\n${run.output()}`);
    if (Date.now() > until) throw new Error(`Timed out waiting for ${pattern}:\n${run.output()}`);
    await new Promise(done => setTimeout(done, 500));
  }
}

test('refuses live provider mode before starting anything', async () => {
  const run = runDemo([], {RECKON_PROVIDER_MODE: 'live'});
  expect(await run.exited).not.toBe(0);
  expect(run.output()).toContain('never runs live provider mode');
  expect(run.output()).not.toContain('Starting the real service');
});

test('a startup failure exits unsuccessfully and leaves no data behind', async () => {
  const run = runDemo([], {NEAR_SANDBOX_BINARY_PATH: '/nonexistent-reckon-sandbox'});
  expect(await run.exited).not.toBe(0);
  expect(run.output()).toContain('Sandbox executable not found');
  expect(run.output()).toContain('DEMO RESULT: FAIL');
  expect(existsSync(workDirectory(run.output()))).toBe(false);
});

test('a run that exceeds its hard time budget fails and cleans up what it started', async () => {
  test.setTimeout(180_000);
  const run = runDemo([], {RECKON_DEMO_BUDGET_SECONDS: '15'});
  expect(await run.exited).not.toBe(0);
  expect(run.output()).toContain('hard time budget');
  const directory = workDirectory(run.output());
  expect(existsSync(directory)).toBe(false);
  expect(processesReferencing(directory)).toEqual([]);
});

test('runs a complete simulated life to verified death and cleans up', async ({page}) => {
  test.setTimeout(1_200_000);
  const run = runDemo(['--hold']);
  try {
    const [, serviceUrl] = await waitForOutput(run, /Local UI: (http:\/\/127\.0\.0\.1:\d+)/, 240_000);
    await waitForOutput(run, /HOLDING/, 900_000);
    const transcript = run.output();
    for (const disclosure of ['SIMULATED PRICES', 'SCRIPTED FORECASTS', 'ACCELERATED TIMING', 'PLAY MONEY', 'does NOT demonstrate live forecasting skill']) {
      expect(transcript).toContain(disclosure);
    }
    for (const scenario of ['1. agent win', '2. challenger win', '3. void refund', '4. payment failure', '5. permanent death']) {
      expect(transcript).toContain(scenario);
    }
    expect(transcript).toMatch(/ASSERTIONS PASSED: \d+/);
    expect(transcript).toContain('DEMO RESULT: PASS');
    expect(transcript).toContain('final live locking was NOT performed');
    expect(transcript).not.toContain('FAIL');

    // The local UI, served by the real service, shows the same simulation disclosures and the dead life.
    await page.goto(serviceUrl);
    await expect(page.getByText('SIMULATED PRICES')).toBeVisible();
    await expect(page.getByText('SCRIPTED LOCAL FIXTURES')).toBeVisible();
    await expect(page.getByText('LOCAL SANDBOX · TEST MONEY')).toBeVisible();
    await expect(page.getByText('Reckon is permanently dead')).toBeVisible();
    await expect(page.locator('#record-summary')).toContainText('5 published · 4 valid outcomes');
    await expect(page.getByText('Payment receipt confirmed on chain').first()).toBeVisible();
    await expect(page.getByRole('button', {name: 'Ask Reckon'})).toBeHidden();
  } finally {
    // Stop only the orchestrator, as Ctrl-C would, so its own exit status (not npm's signal death) is observed.
    const orchestrator = Number(/Orchestrator process id[^:]*: (\d+)/.exec(run.output())?.[1]);
    if (orchestrator > 0 && run.child.exitCode === null) process.kill(orchestrator, 'SIGINT');
    else if (run.child.pid && run.child.exitCode === null) process.kill(-run.child.pid, 'SIGINT');
  }
  expect(await run.exited).toBe(0);
  const finished = run.output();
  expect(finished).toContain('no process started by this run is still running');
  expect(finished).toContain('temporary data removed');
  const directory = workDirectory(finished);
  expect(existsSync(directory)).toBe(false);
  expect(processesReferencing(directory)).toEqual([]);
});
