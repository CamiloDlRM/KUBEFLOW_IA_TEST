import { defineConfig, devices } from '@playwright/test';

/**
 * Two suites:
 * - `mock`: the UI against a fake backend (tests/e2e/fixtures/api.ts). Starts
 *   its own Vite server on port 3100, so it never touches a running stack.
 * - `smoke`: the UI against the real stack of docker-compose.e2e.yml
 *   (SMOKE_BASE_URL, default http://localhost:3300). `setup` signs in once and
 *   the smoke specs reuse that session.
 */
const MOCK_PORT = 3100;
const isCI = !!process.env.CI;
const video = process.env.E2E_VIDEO ? 'on-first-retry' : 'off';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : undefined,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    ...devices['Desktop Chrome'],
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Recording the login page's WebGL canvas stalls context teardown.
    video,
  },
  projects: [
    {
      name: 'mock',
      testDir: './tests/e2e/mock',
      use: { baseURL: `http://localhost:${MOCK_PORT}` },
    },
    {
      name: 'smoke-setup',
      testDir: './tests/e2e/smoke',
      testMatch: /auth\.setup\.ts/,
      use: { baseURL: process.env.SMOKE_BASE_URL || 'http://localhost:3300' },
    },
    {
      name: 'smoke',
      testDir: './tests/e2e/smoke',
      testMatch: /.*\.smoke\.ts/,
      dependencies: ['smoke-setup'],
      use: {
        baseURL: process.env.SMOKE_BASE_URL || 'http://localhost:3300',
        storageState: 'playwright/.auth/smoke-admin.json',
      },
    },
  ],
  // Only the mock suite needs it; smoke runs against the compose stack.
  webServer: process.argv.some((arg) => arg.includes('smoke'))
    ? undefined
    : {
        command: `npx vite --port ${MOCK_PORT} --strictPort`,
        url: `http://localhost:${MOCK_PORT}`,
        reuseExistingServer: !isCI,
        timeout: 120_000,
        env: {
          VITE_API_URL: 'http://localhost:8000',
          VITE_WS_URL: 'ws://localhost:8000',
        },
      },
});
