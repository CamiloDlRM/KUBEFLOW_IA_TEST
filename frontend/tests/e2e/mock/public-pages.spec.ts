import { test, expect } from '../fixtures/test';

test.describe('public pages, as a visitor', () => {
  test.use({ me: null });

  test('the landing page leads to sign in', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'From code to deployment' })).toBeVisible();
    await page.getByRole('link', { name: 'User Manual' }).click();
    await expect(page).toHaveURL(/\/user-manual$/);
  });

  test('the user manual renders without a session', async ({ page }) => {
    await page.goto('/user-manual');

    await expect(page).toHaveTitle('User manual · Maia');
    await expect(page.getByRole('heading', { name: /How Maia works,/ })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Search the user manual' }).first()).toBeVisible();
  });

  test('the technical docs render without a session', async ({ page }) => {
    await page.goto('/tech-docs');

    await expect(page).toHaveTitle('Technical documentation · Maia');
    await expect(page.getByRole('heading', { name: /How Maia is built,/ })).toBeVisible();
  });

  test('the manual links to the technical docs', async ({ page }) => {
    await page.goto('/user-manual');
    await page.getByRole('link', { name: 'Technical documentation' }).click();

    await expect(page).toHaveURL(/\/tech-docs$/);
  });

  for (const [from, to] of [
    ['/docs', '/user-manual'],
    ['/user_manual', '/user-manual'],
    ['/tech_docs', '/tech-docs'],
  ]) {
    test(`${from} redirects to ${to}`, async ({ page }) => {
      await page.goto(from);
      await expect(page).toHaveURL(new RegExp(`${to}$`));
    });
  }

  test('an unknown address sends a visitor to login', async ({ page }) => {
    await page.goto('/no/such/page');
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe('unknown addresses, signed in', () => {
  test('show the not-found page with a way back', async ({ page }) => {
    await page.goto('/no/such/page');

    await expect(page.getByRole('heading', { name: 'I could not find this page' })).toBeVisible();
    await expect(page.getByText('/no/such/page')).toBeVisible();
    await page.getByRole('link', { name: 'Back to Dashboard' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 2 })).toBeVisible();
  });
});
