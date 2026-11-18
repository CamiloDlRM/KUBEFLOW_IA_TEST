/** The home screen: key figures, recent runs, deployed models; the admin's extras; the layout around it. */
import { test, expect } from '../fixtures/test';
import { error } from '../fixtures/api';
import * as d from '../fixtures/data';
import { DashboardPage } from '../pages/DashboardPage';

test.describe('member', () => {
  test('shows the key figures, recent runs and deployed models', async ({ page }) => {
    const dash = new DashboardPage(page);
    await dash.navigate();

    await expect(dash.heading).toBeVisible();
    const kpis = page.getByRole('region', { name: 'Key figures' });
    await expect(kpis).toContainText('Deployed models');
    await expect(kpis).toContainText('serving now');
    await expect(kpis).toContainText('80%');
    await expect(kpis).toContainText('42');

    await expect(dash.pipelineRows).toHaveCount(3);
    await expect(dash.pipelineRow('pl-0001-')).toContainText('success');
    await expect(dash.pipelineRow('pl-0003-')).toContainText('failed');
    // A member does not get the owner column nor service health.
    await expect(page.getByRole('columnheader', { name: 'User' })).toHaveCount(0);
    await expect(page.getByText('Service Health')).toHaveCount(0);

    await expect(page.getByRole('heading', { name: 'My deployed models' })).toBeVisible();
    await expect(page.getByTestId('deployed-model')).toHaveCount(1);
    await expect(page.getByTestId('deployed-model').first()).toContainText(d.IDS.model);
  });

  test('a run links to its canvas', async ({ page }) => {
    const dash = new DashboardPage(page);
    await dash.navigate();
    await dash.pipelineRow('pl-0001-').getByRole('link').click();
    await expect(page).toHaveURL(/\/pipelines\/canvas\/1\?run=pl-0001-success$/);
  });

  test('"All models" opens the models page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'All models' }).click();
    await expect(page.getByRole('heading', { name: 'Models' })).toBeVisible();
  });

  test('with no runs yet it points at projects', async ({ page, mockApi }) => {
    mockApi.on('GET /pipelines', d.page([]));
    mockApi.on('GET /models', []);
    mockApi.on('GET /pipelines/stats', d.stats({ finished: 0, succeeded: 0, success_rate: null, previous_success_rate: null }));
    await page.goto('/');
    await expect(page.getByText(/No pipeline runs yet/)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Key figures' })).toContainText('none serving yet');
    await page.getByRole('link', { name: 'Go to projects' }).click();
    await expect(page).toHaveURL(/\/projects$/);
  });

  test('a failing pipelines endpoint shows an error instead of an empty table', async ({ page, mockApi }) => {
    mockApi.on('GET /pipelines', error(500, 'database is down'));
    await page.goto('/');
    await expect(page.getByText(/Failed to load data: database is down/)).toBeVisible();
  });
});

test.describe('admin', () => {
  test.use({ me: d.admin() });

  test('also sees the owner of each run and service health', async ({ page, mockApi }) => {
    mockApi.on('GET /ready', d.ready({ mlflow: false }));
    const dash = new DashboardPage(page);
    await dash.navigate();
    await expect(page.getByRole('columnheader', { name: 'User' })).toBeVisible();
    await expect(dash.pipelineRow('pl-0001-')).toContainText('ana@t');
    await expect(page.getByRole('heading', { name: 'Most requested models' })).toBeVisible();

    const health = page.getByTestId('service-health');
    await expect(health).toHaveCount(4);
    await expect(health.filter({ hasText: 'Redis' })).toHaveAttribute('data-ok', 'true');
    await expect(health.filter({ hasText: 'MLflow' })).toHaveAttribute('data-ok', 'false');
  });

  test('the sidebar has the admin entry', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation').getByRole('link', { name: 'Admin' }).first().click();
    await expect(page).toHaveURL(/\/admin$/);
  });
});

test.describe('layout', () => {
  const nav = [
    ['Projects', /\/projects$/],
    ['Pipelines', /\/pipelines$/],
    ['Models', /\/models$/],
    ['My Repos', /\/repos\/new$/],
    ['Dashboard', /\/$/],
  ] as const;

  test('the sidebar reaches every section', async ({ page }) => {
    await page.goto('/account');
    for (const [name, url] of nav) {
      await page.getByRole('navigation').getByRole('link', { name, exact: true }).click();
      await expect(page).toHaveURL(url);
    }
  });

  test('greets the signed-in user and links to the account', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('complementary')).toContainText('ana!');
    await page.getByRole('link', { name: 'Account' }).click();
    await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
  });

  test('a member sees no admin entry', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0);
  });

  test('old addresses redirect', async ({ page }) => {
    await page.goto('/dashboards');
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/account$/);
    await page.goto('/projects/1/pipeline?run=pl-0001-success');
    await expect(page).toHaveURL(/\/pipelines\/canvas\/1\?run=pl-0001-success$/);
  });

  test('an unknown address shows the not-found page', async ({ page }) => {
    await page.goto('/no/such/page');
    await expect(page.getByRole('heading', { name: 'I could not find this page' })).toBeVisible();
    await expect(page.getByRole('main').getByRole('code')).toHaveText('/no/such/page');
    await page.getByRole('link', { name: 'Back to Dashboard' }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
