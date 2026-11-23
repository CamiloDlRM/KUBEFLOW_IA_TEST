import type { Page } from '@playwright/test';
import { test, expect, admin, user, fail } from '../fixtures/test';

/**
 * Both pages read the user before `/auth/me` has answered (see the fixme in
 * 'admin panel'), so they are opened from the sidebar, once the user is known.
 */
async function openAdmin(page: Page) {
  await page.goto('/');
  await page.locator('aside').getByRole('link', { name: 'Admin', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Admin Panel' })).toBeVisible();
}

async function openAccount(page: Page) {
  await page.goto('/');
  await page.locator('aside').getByRole('link', { name: 'Account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Account', level: 2 })).toBeVisible();
}

/** The account forms label their inputs without `for`, so they are found next to the label text. */
const field = (page: Page, label: string) =>
  page.getByText(label, { exact: true }).locator('xpath=following-sibling::input');

test.describe('navigation', () => {
  test('the sidebar reaches every section', async ({ page }) => {
    await page.goto('/');
    const sidebar = page.locator('aside');

    for (const [label, url] of [
      ['Projects', /\/projects$/],
      ['Pipelines', /\/pipelines$/],
      ['Models', /\/models$/],
      ['My Repos', /\/repos\/new$/],
      ['Admin', /\/admin$/],
      ['Account', /\/account$/],
    ] as const) {
      await sidebar.getByRole('link', { name: label, exact: true }).click();
      await expect(page).toHaveURL(url);
    }
  });

  test('signs out', async ({ page }) => {
    await page.goto('/');
    await page.locator('aside').getByRole('button', { name: 'Sign out' }).click();

    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate(() => localStorage.getItem('mlops_token'))).toBeNull();
    await page.goto('/projects');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('warns when the GitHub token is about to expire', async ({ page, mockApi }) => {
    mockApi.on('POST', '/auth/login', { access_token: 'e2e-token', token_type: 'bearer', github_token_status: 'expiring' });
    await page.goto('/login');
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('s3cret-pass');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('alert')).toContainText('Your GitHub token expires in less than 7 days.');
    await page.getByRole('link', { name: 'Update it in your account' }).click();
    await expect(page).toHaveURL(/\/account$/);
  });
});

test.describe('account', () => {
  test('summarises who is signed in', async ({ page }) => {
    await page.goto('/account');

    await expect(page.getByRole('heading', { name: 'Account', level: 2 })).toBeVisible();
    await expect(page.getByText('Username and password')).toBeVisible();
    await expect(page.getByText('****abcd')).toBeVisible();
    await expect(page.getByText('Valid', { exact: true })).toBeVisible();
  });

  test('/settings redirects to the account', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/account$/);
  });

  test('requests a password change confirmed by email', async ({ page, mockApi }) => {
    await openAccount(page);

    await page.getByRole('button', { name: 'Password', exact: true }).click();
    await field(page, 'Current password').fill('old-pass-123');
    await field(page, 'New password').fill('new-pass-456');
    await page.getByRole('button', { name: 'Change password' }).click();

    await expect(page.getByText('Check your email')).toBeVisible();
    expect(mockApi.calls('POST', '/auth/me/change-password')[0].body).toEqual({
      current_password: 'old-pass-123',
      new_password: 'new-pass-456',
    });
  });

  test('a wrong current password is reported', async ({ page, mockApi }) => {
    mockApi.on('POST', '/auth/me/change-password', fail(400, 'Current password is incorrect'));
    await openAccount(page);

    await page.getByRole('button', { name: 'Password', exact: true }).click();
    await field(page, 'Current password').fill('nope-nope');
    await field(page, 'New password').fill('new-pass-456');
    await page.getByRole('button', { name: 'Change password' }).click();

    await expect(page.getByText('Current password is incorrect')).toBeVisible();
  });

  test('updates the GitHub token', async ({ page, mockApi }) => {
    await openAccount(page);

    await page.getByRole('button', { name: 'GitHub token', exact: true }).click();
    await page.getByLabel('New GitHub token').fill('ghp_new');
    await page.getByRole('button', { name: 'Update GitHub token' }).click();

    await expect(page.getByText('GitHub token updated.')).toBeVisible();
    expect(mockApi.calls('PUT', '/auth/github-token')[0].body).toEqual({ github_token: 'ghp_new' });
  });
});

test.describe('account without an email', () => {
  test.use({ me: admin({ email: null }) });

  test('asks for an email first', async ({ page, mockApi }) => {
    await page.goto('/account');

    await expect(page.getByText('Not set')).toBeVisible();
    await field(page, 'Email address').fill('admin@example.com');
    await page.getByRole('button', { name: 'Save email' }).click();

    await expect.poll(() => mockApi.calls('PATCH', '/auth/me').length).toBe(1);
    expect(mockApi.calls('PATCH', '/auth/me')[0].body).toEqual({ email: 'admin@example.com' });
  });
});

test.describe('account signed in with GitHub', () => {
  test.use({ me: user({ auth_provider: 'github', username: 'octo@g' }) });

  test('has no GitHub token tab', async ({ page }) => {
    await page.goto('/account');

    await expect(page.getByText('GitHub', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'GitHub token', exact: true })).toHaveCount(0);
  });
});

test.describe('admin panel', () => {
  // Bug: Admin.tsx redirects while `currentUser` is still loading, so an admin who
  // opens /admin directly (bookmark, reload) lands on the dashboard. Remove the
  // fixme once the page waits for the user.
  test.fixme('an admin can open /admin directly', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Admin Panel' })).toBeVisible();
  });

  test('sends an invite and shows the link', async ({ page, mockApi }) => {
    await openAdmin(page);

    await expect(page.getByRole('heading', { name: 'Admin Panel' })).toBeVisible();
    await page.getByLabel('Email address').fill('teammate@example.com');
    await page.getByLabel('Link expires in').selectOption('168');
    await page.getByRole('button', { name: 'Send invite' }).click();

    await expect(page.getByText('Invite sent')).toBeVisible();
    await expect(page.locator('input[readonly]')).toHaveValue(/invite-token-123/);
    expect(mockApi.calls('POST', '/auth/invite')[0].body).toEqual({
      email: 'teammate@example.com',
      expires_in_hours: 168,
    });

    await page.getByRole('button', { name: 'Send another invite' }).click();
    await expect(page.getByRole('button', { name: 'Send invite' })).toBeVisible();
  });

  test('says when the email could not be sent', async ({ page, mockApi }) => {
    mockApi.on('POST', '/auth/invite', {
      token: 'invite-token-123',
      expires_at: '2026-11-25T10:00:00Z',
      email: 'teammate@example.com',
      email_sent: false,
    });
    await openAdmin(page);

    await page.getByLabel('Email address').fill('teammate@example.com');
    await page.getByRole('button', { name: 'Send invite' }).click();

    await expect(page.getByText('Email not sent')).toBeVisible();
  });

  test('reports a failed invite', async ({ page, mockApi }) => {
    mockApi.on('POST', '/auth/invite', fail(409, 'That email already has an account'));
    await openAdmin(page);

    await page.getByLabel('Email address').fill('admin@example.com');
    await page.getByRole('button', { name: 'Send invite' }).click();

    await expect(page.getByText('That email already has an account')).toBeVisible();
  });
});

test.describe('admin panel as a member', () => {
  test.use({ me: user() });

  test('is not reachable', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('aside').getByRole('link', { name: 'Admin' })).toHaveCount(0);

    await page.goto('/admin');
    await expect(page).toHaveURL(/:3100\/$/);
  });
});
