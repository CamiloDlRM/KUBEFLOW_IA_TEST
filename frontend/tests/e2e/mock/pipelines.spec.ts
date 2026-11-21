import { test, expect, insight, paginated, phase, pipeline, project, user, fail } from '../fixtures/test';

const runs = [
  pipeline({ id: 'run-aaaa1111', notebook_path: 'notebooks/train.ipynb', project_id: 1, started_at: '2026-11-18T09:00:00Z' }),
  pipeline({
    id: 'run-bbbb2222',
    notebook_path: 'notebooks/readmit.ipynb',
    project_id: 2,
    status: 'failed',
    started_at: '2026-11-18T10:00:00Z',
  }),
];

test.describe('pipelines list', () => {
  test.beforeEach(({ mockApi }) => {
    mockApi.on('GET', '/pipelines', paginated(runs));
    mockApi.on('GET', '/projects', [project(), project({ id: 2, name: 'Readmissions' })]);
  });

  test('shows every run with its project', async ({ page }) => {
    await page.goto('/pipelines');

    await expect(page.getByRole('heading', { name: 'Pipelines', level: 2 })).toBeVisible();
    const cards = page.getByRole('listitem');
    await expect(cards).toHaveCount(2);
    await expect(page.getByRole('link', { name: /notebooks\/readmit\.ipynb/ })).toContainText('Readmissions');
    // Admins see whose run it was.
    await expect(cards.first()).toContainText('User');
  });

  test('searches by notebook, project or repository', async ({ page }) => {
    await page.goto('/pipelines');
    const search = page.getByRole('searchbox', { name: 'Search pipelines' });

    await search.fill('readmit');
    await expect(page.getByRole('listitem')).toHaveCount(1);
    await search.fill('Iris');
    await expect(page.getByRole('listitem')).toHaveCount(1);
    await search.fill('nothing-like-this');
    await expect(page.getByText('No pipelines match this search.')).toBeVisible();
  });

  test('groups runs by project', async ({ page }) => {
    await page.goto('/pipelines');

    await page.getByRole('button', { name: 'Sort and group' }).click();
    await page.getByRole('button', { name: 'Project', exact: true }).click();
    await page.keyboard.press('Escape');

    await expect(page.getByRole('heading', { name: /Iris \(1\)/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Readmissions \(1\)/ })).toBeVisible();
  });

  test('sorts oldest first', async ({ page }) => {
    await page.goto('/pipelines');
    await expect(page.getByRole('listitem').first()).toContainText('readmit');

    await page.getByRole('button', { name: 'Sort and group' }).click();
    await page.getByRole('button', { name: 'Oldest first' }).click();

    await expect(page.getByRole('listitem').first()).toContainText('train');
  });

  test('a run opens on its project canvas', async ({ page }) => {
    await page.goto('/pipelines');
    await page.getByRole('link', { name: /notebooks\/train\.ipynb/ }).click();

    await expect(page).toHaveURL(/\/pipelines\/canvas\/1\?run=run-aaaa1111$/);
  });

  test('shows the empty state', async ({ page, mockApi }) => {
    mockApi.on('GET', '/pipelines', paginated([]));
    await page.goto('/pipelines');

    await expect(page.getByText(/No pipelines have run yet/)).toBeVisible();
  });

  test('reports a failure to load', async ({ page, mockApi }) => {
    mockApi.on('GET', '/pipelines', fail(500, 'database is down'));
    await page.goto('/pipelines');

    await expect(page.getByText('database is down')).toBeVisible();
  });
});

test.describe('pipelines list as a member', () => {
  test.use({ me: user() });

  test('hides the owner', async ({ page }) => {
    await page.goto('/pipelines');

    await expect(page.getByRole('listitem')).toHaveCount(1);
    await expect(page.getByRole('listitem').first()).not.toContainText('User');
  });
});

test.describe('pipeline detail', () => {
  test('shows a finished run with its logs and deployed model', async ({ page, mockApi }) => {
    mockApi.on('GET', '/pipelines/:id/logs', ({ params }) => ({
      pipeline_id: params.id,
      logs: [{ pipeline_id: params.id, phase: 'execute', status: 'success', logs: 'accuracy=0.95', timestamp: '2026-11-18T10:00:00Z' }],
    }));
    await page.goto('/pipelines/pipeline-001');

    await expect(page.getByRole('heading', { name: /Pipeline/, level: 2 })).toBeVisible();
    await expect(page.getByText(/^Repo: (testuser\/)?ml-project$/)).toBeVisible();
    await expect(page.getByTestId('log-viewer')).toContainText('accuracy=0.95');
    await expect(page.getByRole('heading', { name: 'Deployed Model' })).toBeVisible();
    await page.getByRole('link', { name: 'View all models' }).click();
    await expect(page).toHaveURL(/\/models$/);
  });

  test('streams the logs of a running run over the WebSocket', async ({ page, mockApi }) => {
    mockApi.on('GET', '/pipelines/:id', ({ params }) =>
      pipeline({ id: params.id, status: 'running', finished_at: null, phases: [phase('download'), phase('validate', 'running')] }),
    );
    await page.goto('/pipelines/pipeline-live');
    await expect(page.getByText('Connecting to live log stream...')).toBeVisible();

    await mockApi.wsSend(
      'pipeline-live',
      { phase: 'validate', status: 'running', logs: 'checking mlops tags' },
      { phase: 'execute', status: 'running', logs: 'cell 3/7 done' },
    );

    const logs = page.getByTestId('log-viewer');
    await expect(logs).toContainText('checking mlops tags');
    await expect(logs).toContainText('cell 3/7 done');
    await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  });

  test('a failed run without logs says so', async ({ page, mockApi }) => {
    mockApi.on('GET', '/pipelines/:id', ({ params }) =>
      pipeline({ id: params.id, status: 'failed', metrics: {}, phases: [phase('download'), phase('validate', 'failed')] }),
    );
    await page.goto('/pipelines/pipeline-001');

    await expect(page.getByText('No logs were recorded for this pipeline run.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Deployed Model' })).toHaveCount(0);
  });

  test('another tenant’s run reads as not found', async ({ page, mockApi }) => {
    mockApi.on('GET', '/pipelines/:id', fail(404, 'Pipeline not found'));
    await page.goto('/pipelines/someone-elses');

    await expect(page.getByText('Failed to load pipeline: Pipeline not found')).toBeVisible();
  });

  test('links to the same run on the canvas', async ({ page }) => {
    await page.goto('/pipelines/pipeline-001');
    await page.getByRole('link', { name: /Code and data of this run/ }).click();

    await expect(page).toHaveURL(/\/pipelines\/canvas\/1\?run=pipeline-001$/);
  });
});

test.describe('AI training advisor', () => {
  test('analyzes a finished run on request', async ({ page, mockApi }) => {
    await page.goto('/pipelines/pipeline-001');
    await expect(page.getByText(/No AI analysis yet/)).toBeVisible();

    mockApi.on('GET', '/pipelines/:id/insights', [insight()]);
    await page.getByRole('button', { name: 'Analyze this run' }).click();

    await expect(page.getByRole('heading', { name: 'Recomendaciones' })).toBeVisible();
    await expect(page.getByText('claude-sonnet-5-5')).toBeVisible();
    expect(mockApi.calls('POST', '/pipelines/:id/insights')).toHaveLength(1);
  });

  test('applies the suggestions and reports the push', async ({ page, mockApi }) => {
    mockApi.on('GET', '/pipelines/:id/insights', [insight()]);
    await page.goto('/pipelines/pipeline-001');
    await expect(page.getByRole('button', { name: 'Apply & push' })).toBeVisible();

    mockApi.on('GET', '/pipelines/:id/insights', [
      insight({ apply_status: 'pushed', apply_branch: 'testing-ia-agent', apply_commit_sha: 'cafe1234beef' }),
    ]);
    await page.getByRole('button', { name: 'Apply & push' }).click();

    await expect(page.getByText(/Pushed to branch/)).toContainText('testing-ia-agent');
    await expect(page.getByText(/Pushed to branch/)).toContainText('cafe1234');
    await expect(page.getByRole('button', { name: 'Push again' })).toBeVisible();
    expect(mockApi.calls('POST', '/pipelines/:id/insights/:insightId/apply')).toHaveLength(1);
  });

  test('shows a failed push', async ({ page, mockApi }) => {
    mockApi.on('GET', '/pipelines/:id/insights', [insight({ apply_status: 'failed', apply_error: 'GitHub token expired' })]);
    await page.goto('/pipelines/pipeline-001');

    await expect(page.getByText('Push failed: GitHub token expired')).toBeVisible();
  });

  test('shows a failed analysis', async ({ page, mockApi }) => {
    mockApi.on('GET', '/pipelines/:id/insights', [insight({ status: 'failed', error: 'Provider timeout', content: '' })]);
    await page.goto('/pipelines/pipeline-001');

    await expect(page.getByText('Analysis failed: Provider timeout')).toBeVisible();
  });

  test('says the advisor waits for a running run', async ({ page, mockApi }) => {
    mockApi.on('GET', '/pipelines/:id', ({ params }) => pipeline({ id: params.id, status: 'queued', finished_at: null }));
    await page.goto('/pipelines/pipeline-q');

    await expect(page.getByText(/will analyze this run automatically once the pipeline finishes/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Analyze this run' })).toHaveCount(0);
  });
});
