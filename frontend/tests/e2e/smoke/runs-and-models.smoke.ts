import { test, expect } from '@playwright/test';
import { SEEDED } from '../fixtures/smoke';

test('the seeded run is listed and opens', async ({ page }) => {
  await page.goto('/pipelines');
  await expect(page.getByRole('link', { name: /notebooks\/train\.ipynb/ }).first()).toBeVisible();

  await page.goto(`/pipelines/${SEEDED.runId}`);
  await expect(page.getByRole('heading', { name: /Pipeline/, level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Deployed Model' })).toBeVisible();
});

test('the seeded model is listed with its version', async ({ page }) => {
  await page.goto('/models');

  await expect(page.getByRole('row', { name: new RegExp(SEEDED.model) })).toContainText('v1');
});
