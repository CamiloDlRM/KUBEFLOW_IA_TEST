import { test, expect } from '@playwright/test';
import { API_URL } from '../fixtures/smoke';

test('the backend is alive and its dependencies answer', async ({ request }) => {
  const health = await request.get(`${API_URL}/health`);
  expect(health.ok()).toBe(true);

  const body = await (await request.get(`${API_URL}/ready`)).json();
  // No model-server runs in the smoke stack, so only these two must be up.
  expect(body.redis).toBe('ok');
  expect(body.mlflow).toBe('ok');
});

test('an admin sees service health on the dashboard', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Service Health' })).toBeVisible();
});
