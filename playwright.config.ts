import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: 'tests', timeout: 120_000, use: {baseURL: 'http://127.0.0.1:4389', browserName: 'chromium'}, webServer: {command: 'RECKON_TEST=1 npm start', url: 'http://127.0.0.1:4389', timeout: 120_000, reuseExistingServer: false} });
