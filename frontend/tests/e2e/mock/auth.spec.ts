/** Signing in and out, registering, GitHub's callback, and the forced password step. */
import { test, expect, TOKEN_KEY } from '../fixtures/test';
import { error, json } from '../fixtures/api';
import { user } from '../fixtures/data';

const TOKEN = { access_token: 'fresh-token', token_type: 'bearer', github_token_status: 'ok' };

test.describe('signed out', () => {
  test.use({ me: null });

  test('signing in posts the form and opens the dashboard', async ({ page, mockApi }) => {
    mockApi.on('POST /auth/login', TOKEN);
    mockApi.on('GET /auth/me', user());

    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Username' }).fill('ana@t');
    await page.getByRole('textbox', { name: 'Password' }).fill('s3cret-pass');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    // OAuth2PasswordRequestForm: form-encoded, not JSON.
    const login = mockApi.callsTo('POST /auth/login')[0];
    expect(login.headers['content-type']).toContain('application/x-www-form-urlencoded');
    expect(login.body).toEqual({ username: 'ana@t', password: 's3cret-pass' });
    expect(await page.evaluate((k) => localStorage.getItem(k), TOKEN_KEY)).toBe('fresh-token');
  });

  test('wrong credentials show the server message and stay on /login', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Username' }).fill('ana@t');
    await page.getByRole('textbox', { name: 'Password' }).fill('wrong');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Incorrect username or password')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('the GitHub button points at the backend OAuth start', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('link', { name: 'Continue with GitHub' })).toHaveAttribute(
      'href',
      'http://localhost:8000/auth/github/login',
    );
  });

  test('registering creates the account and signs in with the returned name', async ({ page, mockApi }) => {
    mockApi.on('POST /auth/register', json(user({ username: 'nuevo@t' }), 201));
    mockApi.on('POST /auth/login', TOKEN);
    mockApi.on('GET /auth/me', user({ username: 'nuevo@t' }));

    await page.goto('/register?token=invite-xyz');
    await page.getByRole('textbox', { name: 'Username' }).fill('nuevo');
    await page.getByRole('textbox', { name: 'Email' }).fill('nuevo@example.com');
    await page.getByRole('textbox', { name: 'GitHub token' }).fill('  ghp_abc123  ');
    await page.getByRole('textbox', { name: 'Password' }).fill('long-enough-pass');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    expect(mockApi.callsTo('POST /auth/register')[0].body).toEqual({
      username: 'nuevo',
      email: 'nuevo@example.com',
      password: 'long-enough-pass',
      github_token: 'ghp_abc123',
      invite_token: 'invite-xyz',
    });
    // The server appended "@t"; the login uses that name, not the typed one.
    expect(mockApi.callsTo('POST /auth/login')[0].body).toMatchObject({ username: 'nuevo@t' });
  });

  test('a rejected GitHub token surfaces the register error', async ({ page, mockApi }) => {
    mockApi.on('POST /auth/register', error(400, 'The GitHub token is invalid'));
    await page.goto('/register');
    await page.getByRole('textbox', { name: 'Username' }).fill('nuevo');
    await page.getByRole('textbox', { name: 'Email' }).fill('nuevo@example.com');
    await page.getByRole('textbox', { name: 'GitHub token' }).fill('ghp_bad');
    await page.getByRole('textbox', { name: 'Password' }).fill('long-enough-pass');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('The GitHub token is invalid')).toBeVisible();
  });

  test('the GitHub callback adopts the token and lands on the dashboard', async ({ page, mockApi }) => {
    mockApi.on('GET /auth/me', user({ auth_provider: 'github' }));
    await page.goto('/auth/github?token=gh-jwt&github_token_status=ok');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('a GitHub login that collides with an account offers both ways out', async ({ page, mockApi }) => {
    mockApi.on('GET /auth/me', user({ auth_provider: 'github', username: 'ana@g' }));
    await page.goto('/auth/github?conflict=ana@example.com&pending=pending-1');
    await expect(page.getByRole('heading', { name: 'You already have an account' })).toBeVisible();
    await page.getByRole('button', { name: /Create a new GitHub account/ }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    expect(mockApi.callsTo('POST /auth/github/confirm-new')[0].body).toEqual({ pending: 'pending-1' });
  });
});

test.describe('signed in', () => {
  test('signing out clears the token and returns to /login', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate((k) => localStorage.getItem(k), TOKEN_KEY)).toBeNull();
    // Still signed out after a reload: the root shows the landing page.
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Welcome to Maia!' })).toBeVisible();
  });

  test('a 401 from any request sends the user back to /login', async ({ page, mockApi }) => {
    mockApi.on('GET /projects', error(401, 'Token expired'));
    await page.goto('/projects');
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate((k) => localStorage.getItem(k), TOKEN_KEY)).toBeNull();
  });

  test('an invalid session token is dropped at load', async ({ page, mockApi }) => {
    mockApi.on('GET /auth/me', error(401, 'Invalid token'));
    await page.goto('/projects');
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe('needs a password', () => {
  test.use({ me: user({ needs_password: true, auth_provider: 'github', username: 'ana@g' }) });

  test('a GitHub-only account is sent to set a password first', async ({ page, mockApi }) => {
    await page.goto('/projects');
    await expect(page).toHaveURL(/\/set-password$/);
    await expect(page.getByRole('heading', { name: 'Set a password' })).toBeVisible();

    await page.getByLabel('Password', { exact: true }).fill('new-password-1');
    await page.getByLabel('Confirm password').fill('different-pass');
    await page.getByRole('button', { name: 'Save password' }).click();
    await expect(page.getByText('Passwords do not match.')).toBeVisible();
    expect(mockApi.callsTo('POST /auth/set-password')).toHaveLength(0);

    mockApi.on('GET /auth/me', user({ needs_password: false, auth_provider: 'github', username: 'ana@g' }));
    await page.getByLabel('Confirm password').fill('new-password-1');
    await page.getByRole('button', { name: 'Save password' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    expect(mockApi.callsTo('POST /auth/set-password')[0].body).toEqual({ password: 'new-password-1' });
  });
});
