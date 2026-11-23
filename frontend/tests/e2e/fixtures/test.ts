/**
 * The `test` every mock spec imports instead of `@playwright/test`'s.
 *
 * - `me`: who is signed in. Defaults to an admin; `null` is a visitor.
 *   Set it per file or per describe with `test.use({ me: user() })`.
 * - `mockApi`: the fake backend (see `api.ts`), with defaults installed.
 *   Override a route only after the page rendered what the override replaces.
 * - The test fails on any request no handler answered and on any uncaught
 *   page error. `allowUnhandled` lists requests a test expects to go
 *   unanswered (rare: prefer adding a default to `installDefaults`).
 */
import { test as base, expect } from '@playwright/test';
import type { UserResponse } from '../../../src/types';
import { MockApi, installDefaults } from './api';
import { admin } from './data';

const TOKEN_KEY = 'mlops_token';

interface Fixtures {
  me: UserResponse | null;
  allowUnhandled: string[];
  mockApi: MockApi;
}

export const test = base.extend<Fixtures>({
  me: [admin(), { option: true }],
  allowUnhandled: [[], { option: true }],

  mockApi: [
    async ({ page, me, allowUnhandled }, use, testInfo) => {
      const api = new MockApi(page);
      installDefaults(api, me);
      await api.install();

      if (me) {
        await page.addInitScript(
          ([key, token]) => {
            // Only on the first load: a test that signs out must stay signed out after a reload.
            if (!sessionStorage.getItem('e2e-signed-in')) {
              localStorage.setItem(key, token);
              sessionStorage.setItem('e2e-signed-in', '1');
            }
          },
          [TOKEN_KEY, 'e2e-token'],
        );
      }

      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));

      await use(api);

      // Checked only when the body passed: a failing test already says what went wrong.
      if (testInfo.status !== 'passed') return;
      const unexpected = api.unhandled.filter((call) => !allowUnhandled.includes(call));
      expect(unexpected, 'requests with no mock handler').toEqual([]);
      expect(pageErrors, 'uncaught page errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
export * from './data';
export { reply, fail, html } from './api';
