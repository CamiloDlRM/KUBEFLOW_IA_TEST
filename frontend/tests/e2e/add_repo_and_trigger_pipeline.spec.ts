import { test, expect } from '@playwright/test';
import { DashboardPage } from './pages/DashboardPage';
import { AddRepositoryPage } from './pages/AddRepositoryPage';

test.describe('Add Repository and Trigger Pipeline', () => {
  test.beforeEach(async ({ page }) => {
    // Mock backend API responses via Playwright route interception
    await page.route('**/repos', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: 1,
              github_url: 'https://github.com/testuser/ml-project',
              github_token_masked: '****abcd',
              branch: 'main',
              notebook_path: 'notebooks/train.ipynb',
              webhook_id: 12345,
              webhook_url: 'http://localhost:3000/api/webhook/github',
              created_at: '2026-02-23T10:00:00Z',
              is_active: true,
            },
          ]),
        });
      } else if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            repo_id: 2,
            webhook_url: 'http://localhost:3000/api/webhook/github',
            status: 'webhook_created',
          }),
        });
      } else {
        await route.continue();
      }
    });

    await page.route('**/pipelines?*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: 'pipeline-001',
              repo_id: 1,
              status: 'success',
              commit_sha: 'abc123',
              started_at: '2026-02-23T10:00:00Z',
              finished_at: '2026-02-23T10:05:00Z',
              phases: [],
              metrics: { accuracy: 0.95 },
            },
          ],
          total: 1,
          page: 1,
          size: 20,
        }),
      });
    });

    await page.route('**/ready', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          redis: 'ok',
          mlflow: 'ok',
          model_server: 'ok',
        }),
      });
    });

    await page.route('**/health', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok' }),
      });
    });
  });

  test('add repository when valid github url should appear in success state', async ({
    page,
  }) => {
    const addRepoPage = new AddRepositoryPage(page);
    await addRepoPage.navigate();

    await expect(addRepoPage.heading).toBeVisible();

    await addRepoPage.fillForm({
      url: 'https://github.com/testuser/new-ml-repo',
      token: 'ghp_testtoken1234567890',
      branch: 'main',
      notebook: 'notebooks/train.ipynb',
    });

    await addRepoPage.submit();

    // Should show success message with webhook URL
    await expect(addRepoPage.successMessage).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/webhook/i)).toBeVisible();
  });

  test('dashboard when repos exist should display repo cards', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.navigate();

    await expect(dashboard.heading).toBeVisible();
    // The mocked /repos returns 1 repo
    await expect(page.getByText('testuser/ml-project')).toBeVisible({ timeout: 10_000 });
  });

  test('add repository when duplicate url should show error', async ({ page }) => {
    // Override POST /repos to return conflict error
    await page.route('**/repos', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Repository already registered.' }),
        });
      } else {
        await route.continue();
      }
    });

    const addRepoPage = new AddRepositoryPage(page);
    await addRepoPage.navigate();

    await addRepoPage.fillForm({
      url: 'https://github.com/testuser/ml-project',
      token: 'ghp_testtoken1234567890',
    });

    await addRepoPage.submit();

    await expect(addRepoPage.errorMessage).toBeVisible({ timeout: 10_000 });
  });

  test('navigate from dashboard to add repository page', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.navigate();

    await dashboard.clickAddRepository();

    await expect(page).toHaveURL(/repos\/new/);
  });
});
