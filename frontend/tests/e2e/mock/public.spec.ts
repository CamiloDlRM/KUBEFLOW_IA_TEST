/** What a signed-out visitor can reach: landing, docs, sign-in and sign-up, confirmation links. */
import { test, expect } from '../fixtures/test';
import { error } from '../fixtures/api';

test.use({ me: null });

test.describe('landing', () => {
  test('a visitor at / sees the marketing page, not the dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Welcome to Maia!' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'How we work?' })).toBeVisible();
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Dashboard' })).toHaveCount(0);
  });

  test('"Get started" leads to the sign-in form', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Get started' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign in to Maia!' })).toBeVisible();
  });

  test('the banner links to the docs', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('banner').getByRole('link', { name: 'Documentation' }).click();
    await expect(page).toHaveURL(/\/docs$/);
  });
});

test.describe('protected routes', () => {
  for (const path of ['/projects', '/pipelines', '/models', '/account', '/admin', '/repos/new', '/repos/1/notebook']) {
    test(`${path} redirects a visitor to /login`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
    });
  }
});

test.describe('docs', () => {
  test('the user manual renders and its search filters sections', async ({ page }) => {
    await page.goto('/docs');
    await expect(page.getByRole('heading', { name: /How Maia works/ })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Chapters' })).toBeVisible();
    const search = page.getByRole('searchbox', { name: 'Search the user manual' });
    await search.fill('grafana');
    await expect(search).toHaveValue('grafana');
  });

  test('"Back to Maia" returns to the landing page', async ({ page }) => {
    await page.goto('/docs');
    await page.getByRole('banner').getByRole('link', { name: 'Back to Maia' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome to Maia!' })).toBeVisible();
  });
});

test.describe('confirm-change', () => {
  test('a valid token applies the change and asks to sign in again', async ({ page, mockApi }) => {
    await page.goto('/confirm-change?token=abc');
    await expect(page.getByRole('heading', { name: 'Change applied' })).toBeVisible();
    expect(mockApi.callsTo('POST /auth/confirm-change')[0].body).toEqual({ token: 'abc' });
    await page.getByRole('link', { name: 'Go to sign in' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('an expired token shows the server error', async ({ page, mockApi }) => {
    mockApi.on('POST /auth/confirm-change', error(400, 'This link has expired'));
    await page.goto('/confirm-change?token=old');
    await expect(page.getByText('This link has expired')).toBeVisible();
  });

  test('no token at all says so without calling the API', async ({ page, mockApi }) => {
    await page.goto('/confirm-change');
    await expect(page.getByText('No token found in the URL.')).toBeVisible();
    expect(mockApi.callsTo('POST /auth/confirm-change')).toHaveLength(0);
  });
});
