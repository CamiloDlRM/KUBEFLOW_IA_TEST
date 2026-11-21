import { test, expect, project, repository, runSettings, fail } from '../fixtures/test';

test.describe('projects list', () => {
  test('shows each project with its next step', async ({ page, mockApi }) => {
    mockApi.on('GET', '/projects', [
      project({ id: 1, name: 'Iris', deployed_model: 'iris-classifier' }),
      project({ id: 2, name: 'Readmissions', repository: null, sources: 1 }),
    ]);
    await page.goto('/projects');

    const iris = page.getByRole('link', { name: /Iris/ });
    await expect(iris).toContainText('iris-classifier');
    const readmissions = page.getByRole('link', { name: /Readmissions/ });
    await expect(readmissions).toContainText('No repository linked yet');
    await expect(readmissions).toContainText('Next: build the gold table');
  });

  test('creates a project with only a name', async ({ page, mockApi }) => {
    await page.goto('/projects');
    await expect(page.getByRole('link', { name: /Iris/ })).toBeVisible();

    const button = page.getByRole('button', { name: 'New project' });
    await expect(button).toBeDisabled();
    mockApi.on('GET', '/projects', [project(), project({ id: 2, name: 'Readmissions', repository: null })]);
    await page.getByLabel('Name your project').fill('Readmissions');
    await button.click();

    await expect(page.getByRole('link', { name: /Readmissions/ })).toBeVisible();
    expect(mockApi.calls('POST', '/projects')[0].body).toEqual({ name: 'Readmissions', description: '' });
    await expect(page.getByLabel('Name your project')).toHaveValue('');
  });

  test('shows why a project could not be created', async ({ page, mockApi }) => {
    mockApi.on('POST', '/projects', fail(409, 'A project with that name exists'));
    await page.goto('/projects');

    await page.getByLabel('Name your project').fill('Iris');
    await page.getByRole('button', { name: 'New project' }).click();

    await expect(page.getByText('A project with that name exists')).toBeVisible();
  });

  test('shows the empty state', async ({ page, mockApi }) => {
    mockApi.on('GET', '/projects', []);
    await page.goto('/projects');

    await expect(page.getByText(/No projects yet/)).toBeVisible();
  });

  test('opens a project', async ({ page }) => {
    await page.goto('/projects');
    await page.getByRole('link', { name: /Iris/ }).click();

    await expect(page).toHaveURL(/\/projects\/1$/);
    await expect(page.getByRole('heading', { name: 'Iris', level: 2 })).toBeVisible();
  });
});

test.describe('project detail', () => {
  test('shows the data factory, the linked repository and the deployment rules', async ({ page }) => {
    await page.goto('/projects/1');

    await expect(page.getByRole('heading', { name: 'Iris', level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Data Factory' })).toBeVisible();
    await expect(page.getByText('main · notebooks/train.ipynb')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Deployment rules' })).toBeVisible();
    await expect(page.getByText('platform default')).toBeVisible();
  });

  test('another tenant’s project reads as not found', async ({ page, mockApi }) => {
    mockApi.on('GET', '/projects/:id', fail(404, 'Project not found'));
    await page.goto('/projects/99');

    await expect(page.getByText('Project not found')).toBeVisible();
  });

  test('run pipeline needs data to train on', async ({ page }) => {
    await page.goto('/projects/1');

    await expect(page.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();
  });

  test('runs the pipeline with parameters and opens the run', async ({ page, mockApi }) => {
    mockApi.on('GET', '/projects/:id', project({ active_dataset: { id: 1, name: 'gold-v1', size_bytes: 2048 } }));
    await page.goto('/projects/1');

    await page.getByRole('button', { name: 'Run pipeline' }).click();
    const dialog = page.getByRole('dialog', { name: 'Run pipeline: Iris' });
    await expect(dialog).toContainText('gold-v1');
    await dialog.getByLabel('Model name').fill('iris-rf');
    await dialog.getByRole('button', { name: '+ Add a parameter' }).click();
    await dialog.getByLabel('Parameter 1 name').fill('N_ESTIMATORS');
    await dialog.getByLabel('Parameter 1 value').fill('300');
    await dialog.getByRole('button', { name: 'Run', exact: true }).click();

    await expect(page).toHaveURL(/pipeline-002/);
    expect(mockApi.calls('POST', '/projects/:id/run')[0].body).toEqual({
      model_name: 'iris-rf',
      parameters: { N_ESTIMATORS: 300 },
    });
  });

  test('closes the run dialog with Escape', async ({ page, mockApi }) => {
    mockApi.on('GET', '/projects/:id', project({ active_dataset: { id: 1, name: 'gold-v1', size_bytes: 2048 } }));
    await page.goto('/projects/1');

    await page.getByRole('button', { name: 'Run pipeline' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('links a repository notebook', async ({ page, mockApi }) => {
    mockApi.on('GET', '/projects/:id', project({ repository: null }));
    await page.goto('/projects/1');
    await expect(page.getByText(/No repository linked/)).toBeVisible();

    await page.getByRole('button', { name: 'Link a repository' }).click();
    await page.getByRole('button', { name: /ml-project/ }).click();
    await page.getByRole('button', { name: 'Select a notebook' }).click();
    await page.getByRole('option', { name: 'notebooks/train.ipynb' }).click();
    mockApi.on('GET', '/projects/:id', project());
    await page.getByRole('button', { name: 'Link selected notebook' }).click();

    await expect(page.getByText('main · notebooks/train.ipynb')).toBeVisible();
    const [call] = mockApi.calls('PUT', '/projects/:id/repository');
    expect(Object.fromEntries(call.query)).toEqual({
      repo_id: '1',
      branch: 'main',
      notebook_path: 'notebooks/train.ipynb',
    });
  });

  test('with no repositories, points to adding one', async ({ page, mockApi }) => {
    mockApi.on('GET', '/projects/:id', project({ repository: null }));
    mockApi.on('GET', '/repos', []);
    await page.goto('/projects/1');

    await page.getByRole('button', { name: 'Link a repository' }).click();
    await page.getByRole('link', { name: 'Add one' }).click();
    await expect(page).toHaveURL(/\/repos\/new$/);
  });

  test('unlinks the repository', async ({ page, mockApi }) => {
    await page.goto('/projects/1');
    await expect(page.getByText('main · notebooks/train.ipynb')).toBeVisible();

    mockApi.on('GET', '/projects/:id', project({ repository: null }));
    await page.getByRole('button', { name: 'Unlink' }).click();

    await expect(page.getByText(/No repository linked/)).toBeVisible();
    expect(mockApi.calls('DELETE', '/projects/:id/repository')).toHaveLength(1);
  });

  test('saves custom deployment rules and resets them', async ({ page, mockApi }) => {
    await page.goto('/projects/1');
    const rules = page.getByRole('region', { name: 'Deployment rules' });
    await expect(rules.getByText('platform default')).toBeVisible();

    await rules.getByRole('spinbutton', { name: 'Bar' }).fill('0.9');
    mockApi.on('GET', '/projects/:id/run-settings', runSettings({ is_default: false, policy: { ...runSettings().policy, threshold: 0.9 } }));
    await rules.getByRole('button', { name: 'Save rules' }).click();

    await expect(rules.getByRole('button', { name: 'Back to platform default' })).toBeVisible();
    expect(mockApi.calls('PUT', '/projects/:id/deploy-policy')[0].body).toMatchObject({ threshold: 0.9 });

    mockApi.on('GET', '/projects/:id/run-settings', runSettings());
    await rules.getByRole('button', { name: 'Back to platform default' }).click();
    await expect(rules.getByText('platform default')).toBeVisible();
    expect(mockApi.calls('PUT', '/projects/:id/deploy-policy')[1].body).toEqual({ reset: true });
  });

  test('the data factory card opens the data factory', async ({ page }) => {
    await page.goto('/projects/1');
    await page.getByRole('link', { name: /Data Factory/ }).click();

    await expect(page).toHaveURL(/\/projects\/1\/data$/);
  });

  test('the old pipeline address redirects to the canvas', async ({ page }) => {
    await page.goto('/projects/1/pipeline?run=pipeline-001');

    await expect(page).toHaveURL(/\/pipelines\/canvas\/1\?run=pipeline-001$/);
  });
});

test.describe('repositories', () => {
  test('lists repositories with their notebooks', async ({ page, mockApi }) => {
    mockApi.on('GET', '/repos', [
      repository({
        notebooks: [
          {
            project_id: 1,
            project_name: 'Iris',
            branch: 'main',
            notebook_path: 'notebooks/train.ipynb',
            active_pipeline_id: 'pipeline-001',
          },
        ],
      }),
    ]);
    await page.goto('/repos/new');

    await expect(page.getByRole('heading', { name: 'My Repos' })).toBeVisible();
    const card = page.getByRole('article').filter({ hasText: 'ml-project' });
    await expect(card.getByText('webhook active')).toBeVisible();
    await expect(card.getByRole('link', { name: 'Iris' })).toBeVisible();
    await expect(card.getByRole('link', { name: 'notebooks/train.ipynb', exact: true })).toBeVisible();
  });

  test('switches branch to explore its notebooks', async ({ page, mockApi }) => {
    await page.goto('/repos/new');
    const card = page.getByRole('article').filter({ hasText: 'ml-project' });
    await expect(card.getByRole('link', { name: 'notebooks/train.ipynb', exact: true })).toBeVisible();

    mockApi.on('GET', '/repos/:id/notebooks', ({ query }) =>
      query.get('branch') === 'dev' ? ['experiments/new.ipynb'] : ['notebooks/train.ipynb'],
    );
    // The branch button sits inside its <label>, so it is found by its popup role.
    await card.locator('button[aria-haspopup="listbox"]').click();
    await card.getByRole('option', { name: 'dev' }).click();

    await expect(card.getByText('experiments/new.ipynb')).toBeVisible();
  });

  test('registers a repository', async ({ page, mockApi }) => {
    await page.goto('/repos/new');

    await page.getByRole('button', { name: 'Expand repository form' }).click();
    await page.getByLabel('GitHub Repository URL').fill('https://github.com/testuser/new-ml-repo');
    await page.getByRole('button', { name: 'Register Repository' }).click();

    await expect(page.getByText(/Repository registered/)).toBeVisible();
    expect(mockApi.calls('POST', '/repos')[0].body).toEqual({
      github_url: 'https://github.com/testuser/new-ml-repo',
    });
  });

  test('refuses a URL that is not a GitHub repository', async ({ page, mockApi }) => {
    await page.goto('/repos/new');

    await page.getByRole('button', { name: 'Expand repository form' }).click();
    await page.getByLabel('GitHub Repository URL').fill('https://gitlab.com/user/repo');
    await page.getByRole('button', { name: 'Register Repository' }).click();

    await expect(page.getByText(/Please enter a valid GitHub repository URL/)).toBeVisible();
    expect(mockApi.calls('POST', '/repos')).toHaveLength(0);
  });

  test('a duplicate repository shows the server error', async ({ page, mockApi }) => {
    mockApi.on('POST', '/repos', fail(409, 'Repository already registered.'));
    await page.goto('/repos/new');

    await page.getByRole('button', { name: 'Expand repository form' }).click();
    await page.getByLabel('GitHub Repository URL').fill('https://github.com/testuser/ml-project');
    await page.getByRole('button', { name: 'Register Repository' }).click();

    await expect(page.getByText('Repository already registered.')).toBeVisible();
  });

  test('shows the empty state', async ({ page, mockApi }) => {
    mockApi.on('GET', '/repos', []);
    await page.goto('/repos/new');

    await expect(page.getByText(/No repositories registered yet/)).toBeVisible();
  });

  test('opens a notebook in the editor', async ({ page }) => {
    await page.goto('/repos/new');
    await page.getByRole('link', { name: 'Edit notebooks/train.ipynb on main' }).click();

    await expect(page).toHaveURL(/\/repos\/1\/notebook\?branch=main&path=notebooks%2Ftrain\.ipynb$/);
  });
});
