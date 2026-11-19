import { test, expect, admin, user, fail } from '../fixtures/test';

test.describe('as a visitor', () => {
  test.use({ me: null });

  test('a protected route sends the visitor to login', async ({ page }) => {
    await page.goto('/projects');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: /Sign in to/ })).toBeVisible();
  });

  test('signs in and lands on the dashboard', async ({ page, mockApi }) => {
    mockApi.on('GET', '/auth/me', admin());
    await page.goto('/login');

    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('s3cret-pass');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/:3100\/$/);
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 2 })).toBeVisible();
    const [call] = mockApi.calls('POST', '/auth/login');
    expect(String(call.body)).toContain('username=admin');
    expect(await page.evaluate(() => localStorage.getItem('mlops_token'))).toBe('e2e-token');
  });

  test('a wrong password shows the server error and stays on login', async ({ page, mockApi }) => {
    mockApi.on('POST', '/auth/login', fail(401, 'Incorrect username or password'));
    await page.goto('/login');

    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('wrong-pass');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('alert')).toHaveText('Incorrect username or password');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('signs up from the login page', async ({ page, mockApi }) => {
    mockApi.on('GET', '/auth/me', user({ username: 'nuevo@t' }));
    await page.goto('/login');

    await page.getByRole('button', { name: /Sign up/ }).click();
    await page.getByLabel('Username').fill('nuevo');
    await page.getByLabel('Email').fill('nuevo@example.com');
    await page.getByLabel(/GitHub token/).fill('ghp_abc');
    await page.getByLabel('Password').fill('s3cret-pass');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(/:3100\/$/);
    const [registered] = mockApi.calls('POST', '/auth/register');
    expect(registered.body).toMatchObject({ username: 'nuevo', email: 'nuevo@example.com', github_token: 'ghp_abc' });
    // It then signs in with the name the server returned.
    expect(String(mockApi.calls('POST', '/auth/login')[0].body)).toContain('username=nuevo%40t');
  });

  test('registers with an invite token', async ({ page, mockApi }) => {
    mockApi.on('GET', '/auth/me', user());
    await page.goto('/register?token=invite-123');

    await expect(page.getByText('Create your account')).toBeVisible();
    await page.getByLabel('Username').fill('invitado');
    await page.getByLabel('Email').fill('inv@example.com');
    await page.getByLabel('GitHub token').fill('ghp_abc');
    await page.getByLabel('Password').fill('s3cret-pass');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(/:3100\/$/);
    expect(mockApi.calls('POST', '/auth/register')[0].body).toMatchObject({ invite_token: 'invite-123' });
  });

  test('a rejected registration shows why', async ({ page, mockApi }) => {
    mockApi.on('POST', '/auth/register', fail(400, 'Username already taken'));
    await page.goto('/register');

    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Email').fill('a@example.com');
    await page.getByLabel('GitHub token').fill('ghp_abc');
    await page.getByLabel('Password').fill('s3cret-pass');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByText('Username already taken')).toBeVisible();
  });

  test('the GitHub callback adopts the token', async ({ page, mockApi }) => {
    mockApi.on('GET', '/auth/me', user({ auth_provider: 'github', username: 'octo@g' }));
    await page.goto('/auth/github?token=gh-jwt&github_token_status=ok');

    await expect(page).toHaveURL(/:3100\/$/);
    expect(await page.evaluate(() => localStorage.getItem('mlops_token'))).toBe('gh-jwt');
  });

  test('the GitHub callback sends a passwordless account to set one', async ({ page, mockApi }) => {
    mockApi.on('GET', '/auth/me', user({ auth_provider: 'github', needs_password: true }));
    await page.goto('/auth/github?token=gh-jwt');

    await expect(page).toHaveURL(/\/set-password$/);
    await expect(page.getByRole('heading', { name: 'Set a password' })).toBeVisible();
  });

  test('an email clash offers a separate GitHub account', async ({ page, mockApi }) => {
    mockApi.on('GET', '/auth/me', user({ username: 'octo@g' }));
    await page.goto('/auth/github?conflict=octo@example.com&pending=pending-1');

    await expect(page.getByRole('heading', { name: 'You already have an account' })).toBeVisible();
    await expect(page.getByText('octo@example.com')).toBeVisible();
    await page.getByRole('button', { name: /Create a new GitHub account/ }).click();

    await expect(page).toHaveURL(/:3100\/$/);
    expect(mockApi.calls('POST', '/auth/github/confirm-new')[0].body).toEqual({ pending: 'pending-1' });
  });

  test('confirming a change applies it and signs out', async ({ page }) => {
    await page.goto('/confirm-change?token=change-1');

    await expect(page.getByRole('heading', { name: 'Change applied' })).toBeVisible();
    await page.getByRole('link', { name: 'Go to sign in' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('a confirm link without a token is invalid', async ({ page }) => {
    await page.goto('/confirm-change');

    await expect(page.getByRole('heading', { name: 'Link invalid' })).toBeVisible();
    await expect(page.getByText('No token found in the URL.')).toBeVisible();
  });

  test('an expired confirm link says so', async ({ page, mockApi }) => {
    mockApi.on('POST', '/auth/confirm-change', fail(400, 'Link expired'));
    await page.goto('/confirm-change?token=old');

    await expect(page.getByRole('heading', { name: 'Link invalid' })).toBeVisible();
    await expect(page.getByText('Link expired')).toBeVisible();
  });
});

test.describe('setting a password', () => {
  test.use({ me: user({ auth_provider: 'github', needs_password: true }) });

  test('mismatched passwords are refused before the request', async ({ page, mockApi }) => {
    await page.goto('/set-password');

    await page.getByLabel('Password', { exact: true }).fill('s3cret-pass');
    await page.getByLabel('Confirm password').fill('different');
    await page.getByRole('button', { name: /password/i }).click();

    await expect(page.getByText('Passwords do not match.')).toBeVisible();
    expect(mockApi.calls('POST', '/auth/set-password')).toHaveLength(0);
  });

  test('sets the password and goes to the dashboard', async ({ page, mockApi }) => {
    const done = user({ auth_provider: 'github', needs_password: false });
    mockApi.on('POST', '/auth/set-password', () => {
      mockApi.on('GET', '/auth/me', done);
      return done;
    });
    await page.goto('/set-password');

    await page.getByLabel('Password', { exact: true }).fill('s3cret-pass');
    await page.getByLabel('Confirm password').fill('s3cret-pass');
    await page.getByRole('button', { name: /password/i }).click();

    await expect(page).toHaveURL(/:3100\/$/);
    expect(mockApi.calls('POST', '/auth/set-password')[0].body).toEqual({ password: 's3cret-pass' });
  });
});

test.describe('a signed-in user', () => {
  test('an invalid stored token is dropped and the user sent to login', async ({ page, mockApi }) => {
    mockApi.on('GET', '/auth/me', fail(401, 'Token expired'));
    await page.goto('/projects');

    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate(() => localStorage.getItem('mlops_token'))).toBeNull();
  });
});
