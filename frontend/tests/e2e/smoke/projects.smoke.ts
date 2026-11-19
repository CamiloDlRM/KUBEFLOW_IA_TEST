import { test, expect } from '@playwright/test';
import { ADMIN, SEEDED, api, projectIdByName, tokenFor, unique } from '../fixtures/smoke';

test('lists the seeded project with its repository', async ({ page }) => {
  await page.goto('/projects');

  const card = page.getByRole('link', { name: new RegExp(SEEDED.adminProject) });
  await expect(card).toBeVisible();
  await expect(card).toContainText('seeded-repo');
});

test('creates a project, opens it, and it persists', async ({ page, request }) => {
  const name = unique('Smoke project');
  await page.goto('/projects');

  await page.getByLabel('Name your project').fill(name);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('link', { name: new RegExp(name) }).click();
  await expect(page.getByRole('heading', { name, level: 2 })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name, level: 2 })).toBeVisible();

  const token = await tokenFor(request, ADMIN);
  const id = await projectIdByName(request, token, name);
  expect((await api(request, token).delete(`/projects/${id}`)).ok()).toBe(true);
});

test('the seeded project shows its notebook and deployment rules', async ({ page, request }) => {
  const token = await tokenFor(request, ADMIN);
  const id = await projectIdByName(request, token, SEEDED.adminProject);
  await page.goto(`/projects/${id}`);

  await expect(page.getByText('main · notebooks/train.ipynb')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Deployment rules' })).toBeVisible();
});
