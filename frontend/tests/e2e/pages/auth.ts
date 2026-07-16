import type { Page } from '@playwright/test';

/**
 * Seed a session token so the frontend route guard lets e2e tests through.
 * The guard only checks token presence; API endpoints remain open.
 */
export async function seedAuth(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('mlops_token', 'e2e-test-token');
    localStorage.setItem('mlops_email', 'e2e@mlops.local');
  });
}
