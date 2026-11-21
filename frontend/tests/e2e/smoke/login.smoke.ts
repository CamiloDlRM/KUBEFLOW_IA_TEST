import { test, expect } from '@playwright/test';
import { ADMIN, MEMBER, signInThroughUi } from '../fixtures/smoke';

test.use({ storageState: { cookies: [], origins: [] } });

test('a wrong password is refused by the real backend', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Username').fill(ADMIN.username);
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('alert')).toContainText('Incorrect username or password');
  await expect(page).toHaveURL(/\/login$/);
});

test('a member signs in and signs out', async ({ page }) => {
  await signInThroughUi(page, MEMBER);
  await expect(page.locator('aside')).toContainText('e2e-member');

  await page.locator('aside').getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/projects');
  await expect(page).toHaveURL(/\/login$/);
});
