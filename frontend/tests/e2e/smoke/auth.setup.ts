/**
 * Runs once before the smoke suite: waits for the stack, signs in through the
 * real login form as the seeded admin, and saves the browser state the smoke
 * tests start from.
 */
import { test as setup, expect } from '@playwright/test';
import { ADMIN, API_URL, STORAGE_STATE } from './env';

setup('the backend is up and the seeded admin can sign in', async ({ page, request }) => {
  // `docker compose up --wait` already waited for /health; /ready also needs
  // Redis. MLflow and the model server are not part of this stack.
  await expect
    .poll(async () => (await request.get(`${API_URL}/health`).catch(() => null))?.status(), {
      message: `backend at ${API_URL} is not answering /health`,
      timeout: 60_000,
    })
    .toBe(200);

  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Username' }).fill(ADMIN.username);
  await page.getByRole('textbox', { name: 'Password' }).fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: 'Dashboard', level: 2 })).toBeVisible();
  // The admin's dashboard is the one with service health.
  await expect(page.getByText('Service Health')).toBeVisible();

  await page.context().storageState({ path: STORAGE_STATE });
});
