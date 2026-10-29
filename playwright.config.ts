import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/browser.spec.ts',
  timeout: 150_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  use: { channel: 'msedge', baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:3000', screenshot: 'only-on-failure', trace: 'retain-on-failure' }
});
