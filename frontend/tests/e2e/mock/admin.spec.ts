/** /admin — only for admins: inviting a member by email, with the link as a fallback. */
import { test, expect } from '../fixtures/test';
import { error, json } from '../fixtures/api';
import * as d from '../fixtures/data';

test.describe('admin', () => {
  test.use({ me: d.admin() });

  test('opens directly at /admin', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Admin Panel' })).toBeVisible();
    await expect(page.getByRole('main')).toContainText('Signed in as admin');
  });

  test('sends an invite and shows the link', async ({ page, mockApi }) => {
    await page.goto('/admin');
    await page.getByLabel('Email address').fill('new.member@example.com');
    await page.getByLabel('Link expires in').selectOption('168');
    await page.getByRole('button', { name: 'Send invite' }).click();

    await expect(page.getByText('Invite sent')).toBeVisible();
    await expect(page.getByText(/Email delivered to/)).toContainText('new.member@example.com');
    await expect(page.getByLabel(/Invite link/)).toHaveValue(/\/register\?token=invite-token-123$/);
    expect(mockApi.callsTo('POST /auth/invite')[0].body).toEqual({
      email: 'new.member@example.com',
      expires_in_hours: 168,
    });
  });

  test('without SMTP the link is the way to share it', async ({ page, mockApi }) => {
    mockApi.on('POST /auth/invite', json({ token: 'tok', expires_at: d.NOW, email: 'x@example.com', email_sent: false }, 201));
    await page.goto('/admin');
    await page.getByLabel('Email address').fill('x@example.com');
    await page.getByRole('button', { name: 'Send invite' }).click();
    await expect(page.getByText('Email not sent')).toBeVisible();
    await expect(page.getByLabel(/Invite link/)).toHaveValue(/token=tok$/);
  });

  test('copies the invite link', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/admin');
    await page.getByLabel('Email address').fill('new.member@example.com');
    await page.getByRole('button', { name: 'Send invite' }).click();
    await page.getByRole('button', { name: 'Copy' }).click();
    await expect(page.getByRole('button', { name: 'Copied!' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/register\?token=invite-token-123$/);
  });

  test('an invite for an existing member is refused', async ({ page, mockApi }) => {
    mockApi.on('POST /auth/invite', error(409, 'A user with this email already exists'));
    await page.goto('/admin');
    await page.getByLabel('Email address').fill('ana@example.com');
    await page.getByRole('button', { name: 'Send invite' }).click();
    await expect(page.getByText('A user with this email already exists')).toBeVisible();
  });
});

test.describe('member', () => {
  test('is sent back to the dashboard', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });
});
