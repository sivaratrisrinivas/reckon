import {chromium} from '@playwright/test';
import process from 'node:process';

if (process.platform !== 'linux') {
  process.stdout.write('Skipping the Linux Chromium runtime check on this platform.\n');
  process.exit(0);
}

let browser;
try {
  browser = await chromium.launch({headless: true});
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const missingLibraries = [...message.matchAll(/error while loading shared libraries:\s*([^:]+):/g)]
    .map((match) => match[1]);

  process.stderr.write('Playwright Chromium is not ready, so the browser suite was not started.\n');
  if (missingLibraries.length) {
    process.stderr.write(`Missing Linux libraries: ${[...new Set(missingLibraries)].join(', ')}\n`);
  } else {
    process.stderr.write(`${message.split('\n')[0]}\n`);
  }
  process.stderr.write('Install Chromium and its Linux dependencies with:\n');
  process.stderr.write('  ./scripts/with-local-env.sh npx playwright install --with-deps chromium --only-shell\n');
  process.exitCode = 1;
} finally {
  await browser?.close();
}
