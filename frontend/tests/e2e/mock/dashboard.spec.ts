import { test, expect, pipeline, paginated, user, reply, fail } from '../fixtures/test';

test.describe('dashboard', () => {
  test('lists recent runs named by their project', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Dashboard', level: 2 })).toBeVisible();
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Iris');
    await expect(rows.first()).toContainText('main');
  });

  test('a run older than projects is named by its repository', async ({ page, mockApi }) => {
    mockApi.on('GET', '/pipelines', paginated([pipeline({ project_id: null })]));
    await page.goto('/');

    await expect(page.locator('table tbody tr').first()).toContainText('ml-project');
  });

  test('an admin sees service health', async ({ page, mockApi }) => {
    mockApi.on('GET', '/ready', { status: 'degraded', redis: true, mlflow: false, model_server: true });
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Service Health' })).toBeVisible();
    for (const service of ['Backend', 'Redis', 'MLflow', 'Model Server']) {
      await expect(page.getByText(service, { exact: true })).toBeVisible();
    }
  });

  test('shows the empty state with no runs', async ({ page, mockApi }) => {
    mockApi.on('GET', '/pipelines', paginated([]));
    await page.goto('/');

    await expect(page.getByText(/No pipeline runs yet/)).toBeVisible();
    await page.getByRole('link', { name: 'Go to projects' }).click();
    await expect(page).toHaveURL(/\/projects$/);
  });

  test('reports a failure to load runs', async ({ page, mockApi }) => {
    mockApi.on('GET', '/pipelines', fail(500, 'database is down'));
    await page.goto('/');

    await expect(page.getByText(/Failed to load data: database is down/)).toBeVisible();
  });

  test('a run opens its pipeline', async ({ page }) => {
    await page.goto('/');
    await page.locator('table tbody tr').first().getByRole('link').click();

    await expect(page).toHaveURL(/pipeline-001/);
  });

  test('an expired session goes back to login', async ({ page, mockApi }) => {
    mockApi.on('GET', '/pipelines', reply(401, { detail: 'Token expired' }));
    await page.goto('/');

    await expect(page).toHaveURL(/\/login$/);
  });

  test('/dashboards redirects to the dashboard', async ({ page }) => {
    await page.goto('/dashboards');
    await expect(page).toHaveURL(/:3100\/$/);
  });
});

test.describe('dashboard as a member', () => {
  test.use({ me: user() });

  test('hides service health and the user column', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Dashboard', level: 2 })).toBeVisible();
    await expect(page.locator('table tbody tr')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'Service Health' })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'User' })).toHaveCount(0);
  });
});
