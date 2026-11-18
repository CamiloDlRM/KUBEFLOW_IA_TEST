/** /account — the summary, changing the password, the GitHub token, and setting a missing email. */
import { test, expect } from '../fixtures/test';
import { error } from '../fixtures/api';
import * as d from '../fixtures/data';

test('summarises the account and the token’s health', async ({ page }) => {
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
  await expect(page.getByRole('definition').filter({ hasText: 'ana@t' })).toBeVisible();
  await expect(page.getByRole('definition').filter({ hasText: '****abcd' })).toContainText('Valid');
  // An account that has an email opens on the password tab, not on "set an email".
  await expect(page.getByRole('button', { name: 'Password', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/No email on this account/)).toHaveCount(0);
});

test('an expired token is flagged', async ({ page, mockApi }) => {
  mockApi.on('GET /auth/github-token/status', { status: 'invalid' });
  await page.goto('/account');
  await expect(page.getByRole('definition').filter({ hasText: '****abcd' })).toContainText('Expired or invalid');
});

test('asks for a password change and confirms by email', async ({ page, mockApi }) => {
  await page.goto('/account');
  await page.getByLabel('Current password').fill('old-password');
  await page.getByLabel('New password').fill('a-better-password');
  await page.getByRole('button', { name: 'Change password' }).click();

  await expect(page.getByText('Check your email')).toBeVisible();
  await expect(page.getByText(/We sent a confirmation link to/)).toContainText('ana@example.com');
  expect(mockApi.callsTo('POST /auth/me/change-password')[0].body).toEqual({
    current_password: 'old-password',
    new_password: 'a-better-password',
  });

  await page.getByRole('button', { name: 'Change again' }).click();
  await expect(page.getByLabel('Current password')).toHaveValue('');
});

test('a wrong current password shows the error', async ({ page, mockApi }) => {
  mockApi.on('POST /auth/me/change-password', error(400, 'Current password is incorrect'));
  await page.goto('/account');
  await page.getByLabel('Current password').fill('wrong');
  await page.getByLabel('New password').fill('a-better-password');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Current password is incorrect')).toBeVisible();
});

test('replaces the GitHub token', async ({ page, mockApi }) => {
  await page.goto('/account');
  await page.getByRole('button', { name: 'GitHub token' }).click();
  await page.getByLabel('New GitHub token').fill('  ghp_newtoken  ');
  await page.getByRole('button', { name: 'Update GitHub token' }).click();
  await expect(page.getByText('GitHub token updated.')).toBeVisible();
  expect(mockApi.callsTo('PUT /auth/github-token')[0].body).toEqual({ github_token: 'ghp_newtoken' });
});

test('a rejected GitHub token says why', async ({ page, mockApi }) => {
  mockApi.on('PUT /auth/github-token', error(400, 'GitHub rejected this token'));
  await page.goto('/account');
  await page.getByRole('button', { name: 'GitHub token' }).click();
  await page.getByLabel('New GitHub token').fill('ghp_bad');
  await page.getByRole('button', { name: 'Update GitHub token' }).click();
  await expect(page.getByText('GitHub rejected this token')).toBeVisible();
});

test.describe('without an email', () => {
  test.use({ me: d.user({ email: null }) });

  test('opens on the email tab and sets one', async ({ page, mockApi }) => {
    await page.goto('/account');
    await expect(page.getByText(/No email on this account/)).toBeVisible();
    await page.getByLabel('Email address').fill('ana@example.org');
    await page.getByRole('button', { name: 'Save email' }).click();
    await expect(page.getByText(/Confirmation sent to/)).toContainText('ana@example.org');
    expect(mockApi.callsTo('PATCH /auth/me')[0].body).toEqual({ email: 'ana@example.org' });
  });
});

test.describe('GitHub account', () => {
  test.use({ me: d.user({ auth_provider: 'github', username: 'ana@g' }) });

  test('has no token tab: the token renews by signing in again', async ({ page }) => {
    await page.goto('/account');
    await expect(page.getByRole('definition').filter({ hasText: 'GitHub' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'GitHub token' })).toHaveCount(0);
  });
});
