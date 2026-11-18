/** "My Repos": registering a repository and exploring its branches and notebooks. */
import { test, expect } from '../fixtures/test';
import { error } from '../fixtures/api';
import * as d from '../fixtures/data';
import { AddRepositoryPage } from '../pages/AddRepositoryPage';

test('lists the user’s repositories with their linked projects', async ({ page }) => {
  const repos = new AddRepositoryPage(page);
  await repos.navigate();
  await expect(repos.heading).toBeVisible();
  const card = repos.repoCard('churn');
  await expect(card).toContainText('webhook active');
  await expect(card.getByRole('link', { name: 'Churn' })).toHaveAttribute('href', '/projects/1');
  await expect(card.getByRole('link', { name: 'Link' })).toHaveAttribute('href', 'https://github.com/acme/churn');
});

test('registers a repository and refreshes the list', async ({ page, mockApi }) => {
  const repos = new AddRepositoryPage(page);
  await repos.navigate();
  await expect(repos.repoCards).toHaveCount(1);

  const added = d.repository({ id: 2, github_url: 'https://github.com/acme/forecast', notebooks: [] });
  mockApi.on('GET /repos', [d.repository(), added]);
  await repos.register('https://github.com/acme/forecast');

  await expect(repos.successMessage).toBeVisible();
  expect(mockApi.callsTo('POST /repos')[0].body).toEqual({ github_url: 'https://github.com/acme/forecast' });
  await expect(repos.repoCards).toHaveCount(2);
  await expect(repos.urlInput).toHaveValue('');
});

test('rejects a URL that is not a GitHub repository without calling the API', async ({ page, mockApi }) => {
  const repos = new AddRepositoryPage(page);
  await repos.navigate();
  await repos.register('https://gitlab.com/acme/churn');
  await expect(repos.formError).toContainText('Please enter a valid GitHub repository URL');
  expect(mockApi.callsTo('POST /repos')).toHaveLength(0);
});

test('a repository already registered shows the 409 message', async ({ page, mockApi }) => {
  mockApi.on('POST /repos', error(409, 'Repository already registered'));
  const repos = new AddRepositoryPage(page);
  await repos.navigate();
  await repos.register('https://github.com/acme/churn');
  await expect(repos.formError).toContainText('Repository already registered');
  await expect(repos.successMessage).toHaveCount(0);
});

test('GitHub refusing the webhook shows the 502 message', async ({ page, mockApi }) => {
  mockApi.on('POST /repos', error(502, 'GitHub rejected the webhook: Not Found'));
  const repos = new AddRepositoryPage(page);
  await repos.navigate();
  await repos.register('https://github.com/acme/private');
  await expect(repos.formError).toContainText('GitHub rejected the webhook');
});

test('Cancel goes back to the dashboard', async ({ page }) => {
  const repos = new AddRepositoryPage(page);
  await repos.navigate();
  await repos.expandForm.click();
  await repos.cancelButton.click();
  await expect(page).toHaveURL(/\/$/);
});

test('switching branch lists that branch’s notebooks', async ({ page, mockApi }) => {
  const repos = new AddRepositoryPage(page);
  await repos.navigate();
  const card = repos.repoCard('churn');
  const eda = card.getByRole('link', { name: 'notebooks/eda.ipynb', exact: true });
  await expect(eda).toBeVisible();

  mockApi.on('GET /repos/:id/notebooks', (r) => ({
    json: r.query.get('branch') === 'testing-ia-agent' ? ['notebooks/train.ipynb'] : ['notebooks/train.ipynb', 'notebooks/eda.ipynb'],
  }));
  await card.getByRole('button', { name: 'Branch' }).click();
  await page.getByRole('listbox', { name: 'Repository branches' }).getByRole('button', { name: 'testing-ia-agent' }).click();

  await expect(card.getByRole('button', { name: 'Branch' })).toHaveText(/testing-ia-agent/);
  await expect(eda).toHaveCount(0);
  await expect(card.getByRole('link', { name: 'Edit notebooks/train.ipynb on testing-ia-agent' })).toBeVisible();
});

test('a notebook opens in the editor and its active run in the canvas', async ({ page }) => {
  const repos = new AddRepositoryPage(page);
  await repos.navigate();
  const card = repos.repoCard('churn');
  await expect(card.getByRole('link', { name: 'Open the active pipeline of notebooks/train.ipynb' })).toHaveAttribute(
    'href',
    '/pipelines/canvas/1?run=pl-0001-success',
  );
  await card.getByRole('link', { name: 'Edit notebooks/train.ipynb on main' }).click();
  await expect(page).toHaveURL(/\/repos\/1\/notebook\?branch=main&path=notebooks%2Ftrain\.ipynb$/);
  await expect(page.getByRole('heading', { name: 'train.ipynb' })).toBeVisible();
});
