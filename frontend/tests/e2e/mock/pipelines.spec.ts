/** Pipelines: the list, a run's detail page (phases, live logs, AI advisor) and the canvas. */
import { test, expect } from '../fixtures/test';
import { error, json } from '../fixtures/api';
import * as d from '../fixtures/data';
import { PipelineDetailPage } from '../pages/PipelineDetailPage';

test.describe('list', () => {
  test('shows every run as a card linking to its canvas', async ({ page }) => {
    await page.goto('/pipelines');
    const cards = page.getByRole('main').getByRole('listitem');
    await expect(cards).toHaveCount(3);
    const success = page.getByRole('link', { name: /success/ });
    await expect(success).toContainText('abc123d');
    await expect(success).toContainText('acme/churn');
    await success.click();
    await expect(page).toHaveURL(/\/pipelines\/canvas\/1\?run=pl-0001-success$/);
  });

  test('search filters by notebook, project or repository', async ({ page, mockApi }) => {
    mockApi.on('GET /pipelines', d.page([
      d.pipeline(),
      d.pipeline({ id: 'pl-eda', notebook_path: 'notebooks/eda.ipynb' }),
    ]));
    await page.goto('/pipelines');
    const search = page.getByRole('searchbox', { name: 'Search pipelines' });
    await search.fill('eda');
    await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(1);
    await expect(page.getByRole('main').getByRole('listitem')).toContainText('notebooks/eda.ipynb');

    await search.fill('nothing-like-this');
    await expect(page.getByText('No pipelines match this search.')).toBeVisible();
  });

  test('sorts oldest first and groups by notebook', async ({ page, mockApi }) => {
    mockApi.on('GET /pipelines', d.page([
      d.pipeline({ id: 'pl-new', started_at: '2026-11-18T10:00:00Z', commit_sha: 'newnewnew' }),
      d.pipeline({ id: 'pl-old', started_at: '2026-11-01T10:00:00Z', commit_sha: 'oldoldold', notebook_path: 'notebooks/eda.ipynb' }),
    ]));
    await page.goto('/pipelines');
    const items = page.getByRole('main').getByRole('listitem');
    await expect(items.first()).toContainText('newnewn');

    await page.getByRole('button', { name: 'Sort and group' }).click();
    await page.getByRole('button', { name: 'Oldest first' }).click();
    await expect(items.first()).toContainText('oldoldo');

    await page.getByRole('button', { name: 'Notebook', exact: true }).click();
    await expect(page.getByRole('heading', { name: /notebooks\/eda\.ipynb \(1\)/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /notebooks\/train\.ipynb \(1\)/ })).toBeVisible();
  });

  test('with no runs it points at projects', async ({ page, mockApi }) => {
    mockApi.on('GET /pipelines', d.page([]));
    await page.goto('/pipelines');
    await page.getByRole('link', { name: 'Go to projects' }).click();
    await expect(page).toHaveURL(/\/projects$/);
  });
});

test.describe('detail', () => {
  test('shows phases, stored logs, metrics and the deployed model', async ({ page }) => {
    const detail = new PipelineDetailPage(page);
    await detail.navigate(d.IDS.pipeline);
    await expect(detail.heading).toContainText('pl-0001-succ');
    for (const phase of ['download', 'validate', 'execute', 'register', 'deploy']) {
      await expect(detail.phases).toContainText(phase);
    }
    await expect(detail.logViewer).toContainText(/\[download\]\s*Cloned notebook/);
    await expect(detail.logViewer).toContainText(/\[execute\]\s*Executed 6 cells/);
    await expect(page.getByRole('row', { name: 'accuracy 0.9100' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Deployed Model' })).toBeVisible();
  });

  test('a running pipeline streams its logs over the WebSocket', async ({ page, mockApi }) => {
    mockApi.on('GET /pipelines/:id/logs', (r) => json({ pipeline_id: r.params.id, logs: [] }));
    const detail = new PipelineDetailPage(page);
    await detail.navigate(d.IDS.runningPipeline);
    await expect.poll(() => mockApi.sockets.has(d.IDS.runningPipeline)).toBe(true);

    mockApi.sockets.get(d.IDS.runningPipeline)!.send(
      JSON.stringify({
        pipeline_id: d.IDS.runningPipeline,
        phase: 'execute',
        status: 'running',
        logs: 'Executing cell 3 of 6',
        timestamp: d.NOW,
      }),
    );
    await expect(detail.logViewer).toContainText('Executing cell 3 of 6');
    // Not finished: no advisor button yet.
    await expect(page.getByRole('button', { name: /analysis|Analyze/ })).toHaveCount(0);
  });

  test('a failed pipeline shows the failing phase and no deployed model', async ({ page }) => {
    const detail = new PipelineDetailPage(page);
    await detail.navigate(d.IDS.failedPipeline);
    await expect(page.getByRole('main')).toContainText('failed');
    await expect(page.getByRole('heading', { name: 'Deployed Model' })).toHaveCount(0);
  });

  test('a pipeline that does not exist shows the error', async ({ page }) => {
    await page.goto('/pipelines/does-not-exist');
    await expect(page.getByText(/Pipeline not found/)).toBeVisible();
  });
});

test.describe('AI advisor', () => {
  test('shows the analysis and applies it to the testing-ia-agent branch', async ({ page, mockApi }) => {
    const detail = new PipelineDetailPage(page);
    await detail.navigate(d.IDS.pipeline);
    await expect(detail.advisor).toContainText('The model is slightly overfitting.');
    await expect(detail.advisor).toContainText('Generated by claude-sonnet-5-5');

    mockApi.on('GET /pipelines/:id/insights', [
      d.insight({ apply_status: 'pushed', apply_branch: 'testing-ia-agent', apply_commit_sha: 'cafebabe12345678' }),
    ]);
    await detail.advisor.getByRole('button', { name: 'Apply & push' }).click();

    await expect(detail.advisor).toContainText('Pushed to branch testing-ia-agent');
    await expect(detail.advisor).toContainText('cafebabe');
    await expect(detail.advisor.getByRole('button', { name: 'Push again' })).toBeVisible();
    expect(mockApi.callsTo('POST /pipelines/:id/insights/:insightId/apply')[0].params).toEqual({
      id: d.IDS.pipeline,
      insightId: String(d.IDS.insight),
    });
  });

  test('a failed push says why', async ({ page, mockApi }) => {
    mockApi.on('GET /pipelines/:id/insights', [d.insight({ apply_status: 'failed', apply_error: 'Branch protected' })]);
    const detail = new PipelineDetailPage(page);
    await detail.navigate(d.IDS.pipeline);
    await expect(detail.advisor).toContainText('Push failed: Branch protected');
  });

  test('regenerating starts a new analysis and shows progress', async ({ page, mockApi }) => {
    const detail = new PipelineDetailPage(page);
    await detail.navigate(d.IDS.pipeline);
    await expect(detail.advisor).toContainText('The model is slightly overfitting.');

    mockApi.on('GET /pipelines/:id/insights', [d.insight({ id: 32, status: 'generating', content: '' })]);
    await detail.advisor.getByRole('button', { name: 'Regenerate analysis' }).click();
    await expect(detail.advisor).toContainText('The advisor is reviewing the notebook code and metrics');
    expect(mockApi.callsTo('POST /pipelines/:id/insights')).toHaveLength(1);
  });

  test('a run with no analysis offers one; a failed analysis shows its error', async ({ page, mockApi }) => {
    mockApi.on('GET /pipelines/:id/insights', []);
    const detail = new PipelineDetailPage(page);
    await detail.navigate(d.IDS.pipeline);
    await expect(detail.advisor).toContainText('No AI analysis yet.');

    mockApi.on('POST /pipelines/:id/insights', error(503, 'AI advisor is not configured'));
    await detail.advisor.getByRole('button', { name: 'Analyze this run' }).click();
    await expect(detail.advisor).toContainText('AI advisor is not configured');
  });

  test('an analysis that failed shows the reason', async ({ page, mockApi }) => {
    mockApi.on('GET /pipelines/:id/insights', [d.insight({ status: 'failed', content: '', error: 'Rate limited' })]);
    const detail = new PipelineDetailPage(page);
    await detail.navigate(d.IDS.pipeline);
    await expect(detail.advisor).toContainText('Analysis failed: Rate limited');
  });
});

test.describe('canvas', () => {
  test('draws the notebook phases of the selected run', async ({ page }) => {
    await page.goto('/pipelines/canvas/1?run=pl-0001-success');
    const canvas = page.getByRole('application');
    for (const node of ['Input', 'Config', 'Training', 'Model']) {
      await expect(canvas.getByRole('group').filter({ hasText: new RegExp(`^${node}`) })).toBeVisible();
    }
    await expect(canvas.getByRole('group').filter({ hasText: /^Training/ })).toContainText('completed');
    await expect(page.getByRole('button', { name: 'Churn' })).toBeVisible();
  });

  test('the run picker switches between runs', async ({ page }) => {
    await page.goto('/pipelines/canvas/1?run=pl-0001-success');
    await page.getByRole('button', { name: /^pl-0001-/ }).click();
    await page.getByRole('button', { name: /^pl-0003-/ }).click();
    await expect(page.getByRole('button', { name: /^pl-0003-/ })).toContainText('failed');
    await expect(page.getByText(/Failed at/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ask Maia what went wrong' })).toBeVisible();
  });

  test('clicking a node opens its panel', async ({ page }) => {
    await page.goto('/pipelines/canvas/1?run=pl-0001-success');
    await page.getByRole('application').getByRole('group').filter({ hasText: /^Training/ }).click();
    await expect(page.getByRole('heading', { name: 'Training', level: 3 })).toBeVisible();
    await page.getByRole('button', { name: 'Close panel' }).click();
    await expect(page.getByRole('heading', { name: 'Training', level: 3 })).toHaveCount(0);
  });

  test('Maia opens the advisor for the run', async ({ page }) => {
    await page.goto('/pipelines/canvas/1?run=pl-0001-success');
    const maia = page.getByRole('button', { name: 'Ask Maia, your AI advisor' });
    await maia.click();
    await expect(maia).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('The model is slightly overfitting.')).toBeVisible();
  });

  test('runs the pipeline from the canvas and selects the new run', async ({ page, mockApi }) => {
    mockApi.on('GET /pipelines', d.page([d.pipeline(), d.failedPipeline()]));
    await page.goto('/pipelines/canvas/1?run=pl-0001-success');
    await page.getByRole('button', { name: 'Run pipeline' }).click();

    mockApi.on('GET /pipelines', d.page([d.runningPipeline(), d.pipeline(), d.failedPipeline()]));
    await page.getByRole('dialog').getByRole('button', { name: 'Run', exact: true }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^pl-0002-/ })).toContainText('running');
    await expect(page.getByRole('button', { name: 'Running…' })).toBeDisabled();
  });

  test('the project picker moves to another project', async ({ page, mockApi }) => {
    mockApi.on('GET /projects', [d.project(), d.project({ id: 2, name: 'Readmissions', repository: null })]);
    await page.goto('/pipelines/canvas/1');
    await page.getByRole('button', { name: 'Churn' }).click();
    await page.getByRole('button', { name: 'Readmissions' }).click();
    await expect(page).toHaveURL(/\/pipelines\/canvas\/2$/);
    await expect(page.getByText(/This project has no repository linked/)).toBeVisible();
  });
});
