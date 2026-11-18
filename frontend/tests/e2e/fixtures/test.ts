/**
 * The `test` every mock spec imports.
 *
 * - `mockApi` (automatic): the fake backend from `api.ts`, installed before the
 *   page loads. A test reaches it to override a route or inspect what was sent.
 * - `me` (option): who is signed in. Defaults to a member; `test.use({ me:
 *   admin() })` signs in an admin and `test.use({ me: null })` a visitor.
 *
 * Signing in is what the app itself does after a login: a JWT in localStorage
 * under `mlops_token` (TOKEN_KEY in src/api/client.ts), which AuthContext
 * checks with `GET /auth/me`. The token is seeded once per test, so a test
 * that logs out stays logged out across reloads.
 *
 * After each test the fixture fails it if the page threw an uncaught error or
 * called an endpoint no handler answered.
 */
import { test as base, expect } from '@playwright/test';
import type { UserResponse } from '../../../src/types';
import { MockApi, error } from './api';
import { user } from './data';

export const TOKEN_KEY = 'mlops_token';
export const E2E_TOKEN = 'e2e-token';

interface Fixtures {
  me: UserResponse | null;
  mockApi: MockApi;
  /** Uncaught errors the page threw. Fails the test unless a test empties it. */
  pageErrors: Error[];
}

export const test = base.extend<Fixtures>({
  me: [user(), { option: true }],

  pageErrors: async ({ page }, use) => {
    const errors: Error[] = [];
    page.on('pageerror', (err) => errors.push(err));
    await use(errors);
    expect(errors.map((e) => e.message), 'the page threw uncaught errors').toEqual([]);
  },

  mockApi: [
    async ({ page, me, pageErrors: _pageErrors }, use) => {
      const api = new MockApi();
      if (me) {
        api.on('GET /auth/me', me);
        await page.addInitScript(
          ([key, token]) => {
            if (!sessionStorage.getItem('e2e-seeded')) {
              sessionStorage.setItem('e2e-seeded', '1');
              localStorage.setItem(key, token);
            }
          },
          [TOKEN_KEY, E2E_TOKEN] as const,
        );
      } else {
        api.on('GET /auth/me', error(401, 'Not authenticated'));
      }
      await api.install(page);
      await use(api);
      expect(api.unhandled, `requests with no mock handler:\n${api.unhandled.join('\n')}`).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
