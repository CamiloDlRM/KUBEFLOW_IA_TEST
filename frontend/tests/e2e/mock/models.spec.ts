import { test, expect, model, modelVersion, user, fail } from '../fixtures/test';

const row = (page: import('@playwright/test').Page, name: string) => page.getByRole('row', { name: new RegExp(name) });

test.describe('models', () => {
  test('lists deployed models with version and metric', async ({ page, mockApi }) => {
    mockApi.on('GET', '/models', [model(), model({ model_name: 'fraud-detector', version: '3', metric_value: 0.88, is_active: false })]);
    await page.goto('/models');

    await expect(page.getByRole('heading', { name: 'Models', level: 2 })).toBeVisible();
    await expect(row(page, 'iris-classifier')).toContainText('v1');
    await expect(row(page, 'fraud-detector')).toContainText('v3');
    await expect(row(page, 'fraud-detector')).toContainText('88.0%');
    await expect(page.getByRole('columnheader', { name: 'User' })).toBeVisible();
  });

  test('tests a model with a JSON payload', async ({ page, mockApi }) => {
    mockApi.on('POST', '/models/:name/predict', {
      prediction: ['setosa'],
      model_name: 'iris-classifier',
      version: '1',
      probabilities: [{ setosa: 0.9, versicolor: 0.1 }],
    });
    await page.goto('/models');

    await row(page, 'iris-classifier').getByRole('button', { name: 'Test' }).click();
    const dialog = page.getByRole('dialog', { name: 'Test iris-classifier' });
    await dialog.getByLabel('JSON payload').fill('{"data": [[5.1, 3.5, 1.4, 0.2]]}');
    await dialog.getByRole('button', { name: 'Send request' }).click();

    const answer = dialog.getByRole('region', { name: 'Answer' });
    await expect(answer).toContainText('setosa');
    await expect(answer).toContainText('90% sure');
    expect(mockApi.calls('POST', '/models/:name/predict')[0].body).toEqual({ data: [[5.1, 3.5, 1.4, 0.2]] });
  });

  test('refuses invalid JSON before sending', async ({ page, mockApi }) => {
    await page.goto('/models');

    await row(page, 'iris-classifier').getByRole('button', { name: 'Test' }).click();
    const dialog = page.getByRole('dialog', { name: 'Test iris-classifier' });
    await dialog.getByLabel('JSON payload').fill('{not json');
    await dialog.getByRole('button', { name: 'Send request' }).click();

    await expect(dialog.getByText('Invalid JSON payload.')).toBeVisible();
    expect(mockApi.calls('POST', '/models/:name/predict')).toHaveLength(0);
  });

  test('shows a prediction error', async ({ page, mockApi }) => {
    mockApi.on('POST', '/models/:name/predict', fail(422, 'Expected 4 features, got 2'));
    await page.goto('/models');

    await row(page, 'iris-classifier').getByRole('button', { name: 'Test' }).click();
    const dialog = page.getByRole('dialog', { name: 'Test iris-classifier' });
    await dialog.getByLabel('JSON payload').fill('{"data": [[1, 2]]}');
    await dialog.getByRole('button', { name: 'Send request' }).click();

    await expect(dialog.getByText('Expected 4 features, got 2')).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).first().click();
    await expect(dialog).toHaveCount(0);
  });

  test('rolls back to an older version', async ({ page, mockApi }) => {
    mockApi.on('GET', '/models/:name/versions', [
      modelVersion({ version: '2', pipeline_id: 'pipeline-002', is_active: true }),
      modelVersion({ version: '1', pipeline_id: 'pipeline-001', is_active: false }),
    ]);
    await page.goto('/models');

    await row(page, 'iris-classifier').getByRole('button', { name: 'Versions' }).click();
    const dialog = page.getByRole('dialog', { name: 'Versions of iris-classifier' });
    await expect(dialog).toContainText('Serving v2.');
    await dialog.getByRole('button', { name: 'Roll back to this' }).click();
    await dialog.getByRole('button', { name: 'Serve v1' }).click();

    await expect.poll(() => mockApi.calls('POST', '/models/:name/rollback').length).toBe(1);
    expect(mockApi.calls('POST', '/models/:name/rollback')[0].body).toEqual({ pipeline_id: 'pipeline-001' });
  });

  test('shares a model and stops sharing it', async ({ page, mockApi }) => {
    await page.goto('/models');
    await expect(row(page, 'iris-classifier')).toBeVisible();

    mockApi.on('GET', '/models', [model({ share_url: 'http://localhost:8000/share/abc123/predict' })]);
    await row(page, 'iris-classifier').getByRole('button', { name: 'Share' }).click();
    await expect(row(page, 'iris-classifier').getByText('http://localhost:8000/share/abc123/predict')).toBeVisible();
    expect(mockApi.calls('PUT', '/models/:name/share')[0].body).toEqual({ enabled: true });

    mockApi.on('GET', '/models', [model()]);
    await row(page, 'iris-classifier').getByRole('button', { name: 'Stop' }).click();
    await expect(row(page, 'iris-classifier').getByRole('button', { name: 'Share' })).toBeVisible();
    expect(mockApi.calls('PUT', '/models/:name/share')[1].body).toEqual({ enabled: false });
  });

  test('replaces a public link after confirming', async ({ page, mockApi }) => {
    mockApi.on('GET', '/models', [model({ share_url: 'http://localhost:8000/share/abc123/predict' })]);
    await page.goto('/models');

    page.once('dialog', (dialog) => dialog.accept());
    await row(page, 'iris-classifier').getByRole('button', { name: 'New link' }).click();

    await expect.poll(() => mockApi.calls('POST', '/models/:name/share/rotate').length).toBe(1);
  });

  test('deletes a model after confirming', async ({ page, mockApi }) => {
    await page.goto('/models');
    await expect(row(page, 'iris-classifier')).toBeVisible();

    mockApi.on('GET', '/models', []);
    await row(page, 'iris-classifier').getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Yes, delete' }).click();

    await expect(page.getByRole('link', { name: 'See the pipelines' })).toBeVisible();
    expect(mockApi.calls('DELETE', '/models/:name')[0].path).toBe('/models/iris-classifier');
  });

  test('opens the model dashboard', async ({ page }) => {
    await page.goto('/models');
    await page.getByRole('button', { name: 'iris-classifier' }).click();

    await expect(page.getByRole('heading', { name: 'iris-classifier', level: 2 })).toBeVisible();
    await page.getByRole('button', { name: 'All models' }).click();
    await expect(page.getByRole('heading', { name: 'Models', level: 2 })).toBeVisible();
  });
});

test.describe('models as a member', () => {
  test.use({ me: user() });

  test('hides the owner column', async ({ page }) => {
    await page.goto('/models');

    await expect(page.getByRole('row', { name: /iris-classifier/ })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'User' })).toHaveCount(0);
  });
});
