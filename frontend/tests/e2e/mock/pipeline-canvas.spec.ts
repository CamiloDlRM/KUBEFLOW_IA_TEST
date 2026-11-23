import { test, expect, paginated, phase, pipeline, project } from '../fixtures/test';

test.describe('pipeline canvas', () => {
  test('opens on the first project when none is chosen', async ({ page }) => {
    await page.goto('/pipelines/canvas');

    await expect(page).toHaveURL(/\/pipelines\/canvas\/1$/);
    await expect(page.getByRole('button', { name: 'Iris' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run pipeline' })).toBeEnabled();
  });

  test('draws the notebook phases as nodes', async ({ page }) => {
    await page.goto('/pipelines/canvas/1');

    const nodes = page.locator('.react-flow__node');
    await expect(nodes.filter({ hasText: 'Config' })).toBeVisible();
    await expect(nodes.filter({ hasText: 'Preprocessing' })).toBeVisible();
  });

  test('a node opens its panel', async ({ page }) => {
    await page.goto('/pipelines/canvas/1');

    await page.locator('.react-flow__node').filter({ hasText: 'Config' }).click();
    await expect(page.getByText('MODEL_NAME and VERSION').last()).toBeVisible();
  });

  test('switches project from the picker', async ({ page, mockApi }) => {
    mockApi.on('GET', '/projects', [project(), project({ id: 2, name: 'Readmissions' })]);
    await page.goto('/pipelines/canvas/1');

    await page.getByRole('button', { name: 'Iris' }).click();
    await page.getByRole('button', { name: 'Readmissions' }).click();

    await expect(page).toHaveURL(/\/pipelines\/canvas\/2$/);
    await expect(page.getByRole('button', { name: 'Readmissions' })).toBeVisible();
  });

  test('a project without a repository cannot run', async ({ page, mockApi }) => {
    mockApi.on('GET', '/projects', [project({ repository: null })]);
    await page.goto('/pipelines/canvas/1');

    await expect(page.getByText(/This project has no repository linked, so there is no notebook to run/)).toBeVisible();
    const run = page.getByRole('button', { name: 'Run pipeline' });
    await expect(run).toBeDisabled();
    await expect(run).toHaveAttribute('title', 'This project has no repository linked');
    await page.getByRole('link', { name: 'Link one' }).click();
    await expect(page).toHaveURL(/\/projects\/1$/);
  });

  test('a failed run says where it failed and offers Maia', async ({ page, mockApi }) => {
    mockApi.on(
      'GET',
      '/pipelines',
      paginated([
        pipeline({
          status: 'failed',
          metrics: {},
          phases: [phase('download'), phase('validate', 'failed', 'Missing tag mlops:export')],
        }),
      ]),
    );
    mockApi.on('GET', '/pipelines/:id', ({ params }) =>
      pipeline({
        id: params.id,
        status: 'failed',
        metrics: {},
        phases: [phase('download'), phase('validate', 'failed', 'Missing tag mlops:export')],
      }),
    );
    await page.goto('/pipelines/canvas/1?run=pipeline-001');

    await expect(page.getByText(/Failed at/)).toBeVisible();
    await page.getByRole('button', { name: 'Ask Maia what went wrong' }).click();
    await expect(page.getByText(/Your AI training advisor/)).toBeVisible();
  });

  test('starts a run from the canvas', async ({ page, mockApi }) => {
    mockApi.on('GET', '/projects', [project({ active_dataset: { id: 1, name: 'gold-v1', size_bytes: 2048 } })]);
    await page.goto('/pipelines/canvas/1');

    await page.getByRole('button', { name: 'Run pipeline' }).click();
    const dialog = page.getByRole('dialog', { name: 'Run pipeline: Iris' });
    await dialog.getByLabel('Model name').fill('iris-rf');
    await dialog.getByRole('button', { name: 'Run', exact: true }).click();

    await expect(dialog).toHaveCount(0);
    expect(mockApi.calls('POST', '/projects/:id/run')).toHaveLength(1);
  });

  test('goes back to the pipelines list when opened directly', async ({ page }) => {
    await page.goto('/pipelines/canvas/1');
    await page.getByRole('button', { name: 'Pipelines' }).click();

    await expect(page).toHaveURL(/\/pipelines$/);
  });
});
