/* Playwright config for basic post-install API checks and optional UI tests.
   The tests read `E2E_BASE_URL` and `E2E_ADMIN_TOKEN` from environment or GitHub secrets.
*/
import { devices } from '@playwright/test';
/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
  testDir: './e2e',
  timeout: 30 * 1000,
  expect: { timeout: 5000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'api' },
    // Add browser projects below if you want UI tests
    // { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
};

export default config;
