import { defineConfig, devices } from '@playwright/test';

/**
 * Two suites:
 *
 * - `mock`: every page against a fake API (tests/e2e/fixtures/api.ts). Starts
 *   its own Vite dev server; nothing else has to be running.
 * - `smoke`: a few flows against the real stack (backend, postgres, redis,
 *   minio, mlflow) — see docker-compose.e2e.yml. Expects the frontend at
 *   BASE_URL and the API at E2E_API_URL; starts no server of its own.
 *
 *   npm run test:e2e         → mock
 *   npm run test:e2e:smoke   → smoke
 */
const CI = !!process.env.CI;
const MOCK_PORT = Number(process.env.E2E_MOCK_PORT ?? 3100);
const runningSmoke = process.argv.some((a) => a.includes('smoke'));
/** Written by tests/e2e/smoke/auth.setup.ts (see STORAGE_STATE in smoke/env.ts). */
const SMOKE_STORAGE_STATE = 'playwright/.auth/smoke-admin.json';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 7_500 },
  use: {
    // Stops the sign-in page's WebGL animation (MicroSlats honours it) and the
    // landing's marquees, so screenshots and assertions see a still page.
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Off by default: recording the sign-in page's WebGL canvas stalls context
    // teardown past the test timeout in headless Chromium. The trace already
    // holds a screenshot per action; E2E_VIDEO=1 turns recording back on.
    video: process.env.E2E_VIDEO ? 'retain-on-failure' : 'off',
  },
  projects: [
    {
      name: 'mock',
      testDir: './tests/e2e/mock',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${MOCK_PORT}`,
      },
    },
    // Signs in once through the real login and saves the session for `smoke`.
    {
      name: 'smoke-setup',
      testDir: './tests/e2e/smoke',
      testMatch: /auth\.setup\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
      },
    },
    {
      name: 'smoke',
      testDir: './tests/e2e/smoke',
      dependencies: ['smoke-setup'],
      // In order, not in parallel: the tests share one admin and one
      // database, and a real backend is slower than a mock.
      fullyParallel: false,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
        storageState: SMOKE_STORAGE_STATE,
      },
    },
  ],
  // The mock suite's own dev server, on a port of its own so it never picks up
  // a developer's `npm run dev` that may point at a real backend. The API URL
  // is the origin the fake backend intercepts; nothing listens there.
  webServer: runningSmoke
    ? undefined
    : {
        command: `npx vite --port ${MOCK_PORT} --strictPort`,
        url: `http://localhost:${MOCK_PORT}`,
        reuseExistingServer: !CI,
        timeout: 120_000,
        env: {
          VITE_API_URL: 'http://localhost:8000',
          VITE_WS_URL: 'ws://localhost:8000',
        },
      },
});
