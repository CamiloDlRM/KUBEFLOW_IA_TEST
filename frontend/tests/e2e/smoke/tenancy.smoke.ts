/** Members see only their own work; another tenant's ids answer 404, never 403. */
import { test, expect } from '@playwright/test';
import { ADMIN, MEMBER, SEEDED, api, projectIdByName, signInThroughUi, tokenFor } from '../fixtures/smoke';

test.use({ storageState: { cookies: [], origins: [] } });

test('a member does not see the admin project', async ({ page }) => {
  await signInThroughUi(page, MEMBER);
  await page.goto('/projects');

  await expect(page.getByRole('link', { name: new RegExp(SEEDED.memberProject) })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(SEEDED.adminProject) })).toHaveCount(0);
});

test('the admin project and run read as not found to a member', async ({ request }) => {
  const adminToken = await tokenFor(request, ADMIN);
  const memberToken = await tokenFor(request, MEMBER);
  const projectId = await projectIdByName(request, adminToken, SEEDED.adminProject);

  expect((await api(request, memberToken).get(`/projects/${projectId}`)).status()).toBe(404);
  expect((await api(request, memberToken).get(`/pipelines/${SEEDED.runId}`)).status()).toBe(404);
  // The admin sees everyone's.
  expect((await api(request, adminToken).get(`/pipelines/${SEEDED.runId}`)).status()).toBe(200);
});

test('a member opening the admin project in the UI gets not found', async ({ page, request }) => {
  const adminToken = await tokenFor(request, ADMIN);
  const projectId = await projectIdByName(request, adminToken, SEEDED.adminProject);

  await signInThroughUi(page, MEMBER);
  await page.goto(`/projects/${projectId}`);
  await expect(page.getByText(/not found/i)).toBeVisible();
});
