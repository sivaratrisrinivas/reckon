import { defineConfig } from '@playwright/test';

// The accessibility and responsive experience suite runs against its own service instance because it
// drives the agent all the way to permanent death. RECKON_MEASURE=1 selects the emulated-device
// measurement run, which also needs a fresh agent, instead of the state and accessibility checks.
const measuring = process.env.RECKON_MEASURE === '1';

export default defineConfig({
  testDir: 'tests/experience',
  testMatch: measuring ? /measure\.spec\.ts$/ : /states\.spec\.ts$/,
  timeout: 240_000,
  workers: 1,
  use: {baseURL: 'http://127.0.0.1:4389', browserName: 'chromium'},
  webServer: {
    command: 'RECKON_TEST=1 RECKON_PROVIDER_MODE=fixture RECKON_LOCAL_IDLE_LIFE_NS=9000000000000 npm start',
    url: 'http://127.0.0.1:4389',
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
