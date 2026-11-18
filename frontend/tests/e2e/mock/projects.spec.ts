/** Projects: the list, creating one, linking code, running a pipeline, deployment rules. */
import { test, expect } from '../fixtures/test';
import { error, json } from '../fixtures/api';
import * as d from '../fixtures/data';

test.describe('list', () => {
  test('shows each project with its figures', async ({ page }) => {
    await page.goto('/projects');
    const card = page.getByRole('link', { name: /^Churn/ });
    await expect(card).toContainText('1,200');
    await expect(card).toContainText(d.IDS.model);
    await expect(card).toContainText('acme/churn');
    await card.click();
    await expect(page).toHaveURL(/\/projects\/1$/);
  });

  test('creates a project from its name', async ({ page, mockApi }) => {
    await page.goto('/projects');
    const create = page.getByRole('button', { name: 'New project' });
    await expect(create).toBeDisabled();

    mockApi.on('GET /projects', [d.project(), d.project({ id: 2, name: 'Readmissions', repository: null, deployed_model: null })]);
    await page.getByRole('textbox', { name: 'Name your project' }).fill('Readmissions');
    await create.click();

    await expect(page.getByRole('link', { name: /^Readmissions/ })).toBeVisible();
    expect(mockApi.callsTo('POST /projects')[0].body).toEqual({ name: 'Readmissions', description: '' });
    await expect(page.getByRole('textbox', { name: 'Name your project' })).toHaveValue('');
  });
});

test.describe('detail', () => {
  test('shows the repository, the data factory and the deployment rules', async ({ page }) => {
    await page.goto('/projects/1');
    await expect(page.getByRole('heading', { name: 'Churn', level: 2 })).toBeVisible();
    await expect(page.getByText('main · notebooks/train.ipynb')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Deployment rules' })).toContainText('Deploys when accuracy ≥ 0.7.');
    await page.getByRole('link', { name: /^Data Factory/ }).click();
    await expect(page).toHaveURL(/\/projects\/1\/data$/);
  });

  test('"Open pipeline" goes to the canvas', async ({ page }) => {
    await page.goto('/projects/1');
    await page.getByRole('link', { name: 'Open pipeline' }).click();
    await expect(page).toHaveURL(/\/pipelines\/canvas\/1$/);
  });

  test('unlinking the repository keeps the project', async ({ page, mockApi }) => {
    await page.goto('/projects/1');
    const unlink = page.getByRole('button', { name: 'Unlink' });
    await expect(unlink).toBeVisible();
    mockApi.on('GET /projects/:id', d.project({ repository: null, deployed_model: null }));
    await unlink.click();
    await expect(page.getByText(/No repository linked/)).toBeVisible();
    expect(mockApi.callsTo('DELETE /projects/:id/repository')).toHaveLength(1);
    // Rules only make sense with code to run.
    await expect(page.getByRole('region', { name: 'Deployment rules' })).toHaveCount(0);
  });

  test('links a repository notebook picked from the user’s repos', async ({ page, mockApi }) => {
    mockApi.on('GET /projects/:id', d.project({ repository: null, deployed_model: null }));
    await page.goto('/projects/1');
    await expect(page.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();

    await page.getByRole('button', { name: 'Link a repository' }).click();
    await page.getByRole('button', { name: /churn\s*Explore/ }).click();
    await page.getByRole('button', { name: 'Select a notebook' }).click();
    await page.getByRole('option', { name: 'notebooks/train.ipynb' }).click();

    mockApi.on('GET /projects/:id', d.project());
    await page.getByRole('button', { name: 'Link selected notebook' }).click();

    await expect(page.getByText('main · notebooks/train.ipynb')).toBeVisible();
    const call = mockApi.callsTo('PUT /projects/:id/repository')[0];
    expect(Object.fromEntries(call.query)).toEqual({
      repo_id: '1',
      branch: 'main',
      notebook_path: 'notebooks/train.ipynb',
    });
  });

  test('with no repositories registered, points at My Repos', async ({ page, mockApi }) => {
    mockApi.on('GET /projects/:id', d.project({ repository: null }));
    mockApi.on('GET /repos', []);
    await page.goto('/projects/1');
    await page.getByRole('button', { name: 'Link a repository' }).click();
    await expect(page.getByText(/You have no repositories registered/)).toBeVisible();
    await page.getByRole('link', { name: 'Add one' }).click();
    await expect(page).toHaveURL(/\/repos\/new$/);
  });

  test('a project that does not exist shows the error', async ({ page, mockApi }) => {
    mockApi.on('GET /projects/:id', error(404, 'Project not found'));
    await page.goto('/projects/99');
    await expect(page.getByText('Project not found')).toBeVisible();
  });
});

test.describe('run pipeline', () => {
  test('runs a new version of the deployed model with the last parameters', async ({ page, mockApi }) => {
    await page.goto('/projects/1');
    await page.getByRole('button', { name: 'Run pipeline' }).click();

    const dialog = page.getByRole('dialog', { name: 'Run pipeline: Churn' });
    await expect(dialog).toContainText(`Model: ${d.IDS.model}`);
    await expect(dialog).toContainText('gold v3');
    await expect(dialog.getByRole('textbox', { name: 'Parameter 1 name' })).toHaveValue('n_estimators');
    await expect(dialog.getByRole('textbox', { name: 'Parameter 1 value' })).toHaveValue('200');

    await dialog.getByRole('textbox', { name: 'Parameter 1 value' }).fill('500');
    await dialog.getByRole('button', { name: '+ Add a parameter' }).click();
    await dialog.getByRole('textbox', { name: 'Parameter 2 name' }).fill('use_smote');
    await dialog.getByRole('textbox', { name: 'Parameter 2 value' }).fill('true');
    await dialog.getByRole('button', { name: 'Run', exact: true }).click();

    await expect(page).toHaveURL(/\/pipelines\/canvas\/1\?run=pl-0002-running$/);
    expect(mockApi.callsTo('POST /projects/:id/run')[0].body).toEqual({
      model_name: d.IDS.model,
      parameters: { n_estimators: 500, use_smote: true },
    });
  });

  test('a first run asks for a model name and validates the parameters', async ({ page, mockApi }) => {
    mockApi.on('GET /projects/:id', d.project({ name: 'Readmissions', deployed_model: null }));
    mockApi.on('GET /projects/:id/run-settings', d.runSettings({ last_parameters: {} }));
    await page.goto('/projects/1');
    await page.getByRole('button', { name: 'Run pipeline' }).click();

    const dialog = page.getByRole('dialog');
    const name = dialog.getByLabel('Model name');
    await expect(name).toHaveValue(/readmissions/i);
    const run = dialog.getByRole('button', { name: 'Run', exact: true });

    await name.fill('bad name!');
    await expect(run).toBeDisabled();
    await name.fill('readmit-v1');

    await dialog.getByRole('button', { name: '+ Add a parameter' }).click();
    await expect(dialog.getByText('Every parameter needs a name.')).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Parameter 1 name' }).fill('1bad');
    await expect(dialog.getByText(/1bad is not a usable name/)).toBeVisible();
    await expect(run).toBeDisabled();
    await dialog.getByRole('button', { name: 'Remove parameter 1' }).click();

    await run.click();
    await expect(page).toHaveURL(/run=pl-0002-running/);
    expect(mockApi.callsTo('POST /projects/:id/run')[0].body).toEqual({ model_name: 'readmit-v1', parameters: {} });
  });

  test('a refused run shows why and keeps the dialog open', async ({ page, mockApi }) => {
    mockApi.on('POST /projects/:id/run', error(409, 'A run of this notebook is already in progress'));
    await page.goto('/projects/1');
    await page.getByRole('button', { name: 'Run pipeline' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(dialog).toContainText('A run of this notebook is already in progress');
  });

  test('Escape and Close dismiss the dialog', async ({ page }) => {
    await page.goto('/projects/1');
    await page.getByRole('button', { name: 'Run pipeline' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('button', { name: 'Run pipeline' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('without gold data or a chosen layer the run is disabled', async ({ page, mockApi }) => {
    mockApi.on('GET /projects/:id', d.project({ active_dataset: null }));
    mockApi.on('GET /projects/:id/pipeline-input', d.pipelineInput({ choice: {}, resolved: null }));
    await page.goto('/projects/1');
    const run = page.getByRole('button', { name: 'Run pipeline' });
    await expect(run).toBeDisabled();
    await expect(run).toHaveAttribute('title', /Build the gold layer/);
  });
});

test.describe('deployment rules', () => {
  test('saves a stricter rule and can go back to the default', async ({ page, mockApi }) => {
    await page.goto('/projects/1');
    const rules = page.getByRole('region', { name: 'Deployment rules' });
    const save = rules.getByRole('button', { name: 'Save rules' });
    await expect(save).toBeDisabled();

    await rules.getByRole('combobox', { name: 'Metric' }).fill('f1');
    await rules.getByRole('spinbutton', { name: 'Bar' }).fill('0.85');
    await rules.getByRole('checkbox', { name: '…and beat the version serving now' }).check();
    await save.click();

    await expect(rules).toContainText('f1');
    await expect(rules.getByRole('button', { name: 'Back to platform default' })).toBeVisible();
    expect(mockApi.callsTo('PUT /projects/:id/deploy-policy')[0].body).toMatchObject({
      metric: 'f1',
      threshold: 0.85,
      must_beat_serving: true,
      auto_deploy: true,
    });

    mockApi.on('PUT /projects/:id/deploy-policy', json(d.runSettings()));
    await rules.getByRole('button', { name: 'Back to platform default' }).click();
    await expect(rules.getByText('platform default')).toBeVisible();
    expect(mockApi.callsTo('PUT /projects/:id/deploy-policy')[1].body).toEqual({ reset: true });
  });

  test('Discard reverts unsaved edits', async ({ page }) => {
    await page.goto('/projects/1');
    const rules = page.getByRole('region', { name: 'Deployment rules' });
    await rules.getByRole('spinbutton', { name: 'Bar' }).fill('0.99');
    await rules.getByRole('button', { name: 'Discard' }).click();
    await expect(rules.getByRole('spinbutton', { name: 'Bar' })).toHaveValue('0.7');
    await expect(rules.getByRole('button', { name: 'Save rules' })).toBeDisabled();
  });
});
