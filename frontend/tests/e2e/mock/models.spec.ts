/** /models — the table, testing a model, its versions, its public link and deleting it. */
import { test, expect } from '../fixtures/test';
import { error } from '../fixtures/api';
import * as d from '../fixtures/data';
import { ModelsPage } from '../pages/ModelsPage';

const NAME = d.IDS.model;

test('lists the deployed models', async ({ page, mockApi }) => {
  mockApi.on('GET /models', [d.model(), d.model({ model_name: 'iris', version: '1', is_active: false, metric: 'f1', metric_value: 0.5 })]);
  const models = new ModelsPage(page);
  await models.navigate();
  await expect(models.heading).toBeVisible();
  await expect(models.rows).toHaveCount(2);
  await expect(models.row(NAME)).toContainText('v3');
  await expect(models.row(NAME)).toContainText('accuracy 91.0%');
  await expect(models.row('iris')).toContainText('f1');
  await expect(page.getByRole('columnheader', { name: 'User' })).toHaveCount(0);
});

test('with no models it says so', async ({ page, mockApi }) => {
  mockApi.on('GET /models', []);
  await page.goto('/models');
  await expect(page.getByRole('table')).toHaveCount(0);
});

test.describe('test dialog', () => {
  test('sends the form values and shows the answer with its probabilities', async ({ page, mockApi }) => {
    const models = new ModelsPage(page);
    await models.navigate();
    const dialog = await models.openTest(NAME);
    await expect(dialog.getByRole('heading', { name: `Test: ${NAME}` })).toBeVisible();

    // The form starts at the typical training row.
    await expect(dialog.getByRole('spinbutton', { name: /tenure/ })).toHaveValue('24');
    await dialog.getByRole('spinbutton', { name: /tenure/ }).fill('2');
    await dialog.getByRole('button', { name: 'Send request' }).click();

    const answer = dialog.getByRole('region', { name: 'Answer' });
    await expect(answer).toBeVisible();
    await expect(answer.getByRole('list', { name: 'Probability per class' })).toContainText('75.0%');
    expect(mockApi.callsTo('POST /models/:name/predict')[0].body).toEqual({ data: [[2, 70]] });
  });

  test('raw JSON mode sends several rows; invalid JSON is caught before sending', async ({ page, mockApi }) => {
    const models = new ModelsPage(page);
    await models.navigate();
    const dialog = await models.openTest(NAME);
    await dialog.getByRole('button', { name: 'Edit as JSON (several rows)' }).click();

    const payload = dialog.getByRole('textbox', { name: 'JSON payload' });
    await payload.fill('{ not json');
    await dialog.getByRole('button', { name: 'Send request' }).click();
    await expect(dialog.getByText('Invalid JSON payload.')).toBeVisible();
    expect(mockApi.callsTo('POST /models/:name/predict')).toHaveLength(0);

    await payload.fill('{"data": [[1, 20], [70, 110]]}');
    await dialog.getByRole('button', { name: 'Send request' }).click();
    await expect(dialog.getByRole('region', { name: 'Answer' })).toBeVisible();
    expect(mockApi.callsTo('POST /models/:name/predict')[0].body).toEqual({ data: [[1, 20], [70, 110]] });
  });

  test('a model without a card falls back to raw JSON', async ({ page, mockApi }) => {
    mockApi.on('GET /models', [d.model({ model_card: {} })]);
    const models = new ModelsPage(page);
    await models.navigate();
    const dialog = await models.openTest(NAME);
    await expect(dialog.getByRole('textbox', { name: 'JSON payload' })).toBeVisible();
  });

  test('a prediction error is shown in the dialog', async ({ page, mockApi }) => {
    mockApi.on('POST /models/:name/predict', error(422, 'Expected 2 features, got 3'));
    const models = new ModelsPage(page);
    await models.navigate();
    const dialog = await models.openTest(NAME);
    await dialog.getByRole('button', { name: 'Send request' }).click();
    await expect(dialog).toContainText('Expected 2 features, got 3');
  });

  test('both Close buttons dismiss it', async ({ page }) => {
    const models = new ModelsPage(page);
    await models.navigate();
    let dialog = await models.openTest(NAME);
    await dialog.getByRole('button', { name: 'Close' }).first().click();
    await expect(dialog).toHaveCount(0);

    dialog = await models.openTest(NAME);
    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(dialog).toHaveCount(0);
  });
});

test.describe('versions', () => {
  test('rolls back to an older version after confirming on its row', async ({ page, mockApi }) => {
    const models = new ModelsPage(page);
    await models.navigate();
    const dialog = await models.openVersions(NAME);
    const older = dialog.getByRole('row').filter({ hasText: 'gold v3' }).filter({ hasText: '0.8600' });
    await expect(dialog.getByRole('row')).toHaveCount(3);

    await older.getByRole('button', { name: 'Roll back to this' }).click();
    await older.getByRole('button', { name: 'Cancel' }).click();
    expect(mockApi.callsTo('POST /models/:name/rollback')).toHaveLength(0);

    await older.getByRole('button', { name: 'Roll back to this' }).click();
    await older.getByRole('button', { name: 'Serve v2' }).click();
    await mockApi.waitForCall(page, 'POST /models/:name/rollback');
    expect(mockApi.callsTo('POST /models/:name/rollback')[0].body).toEqual({ pipeline_id: 'pl-older' });
  });

  test('no registered versions says so', async ({ page, mockApi }) => {
    mockApi.on('GET /models/:name/versions', []);
    const models = new ModelsPage(page);
    await models.navigate();
    const dialog = await models.openVersions(NAME);
    await expect(dialog).toContainText('No registered versions yet.');
  });
});

test.describe('public link', () => {
  test('shares, rotates after confirming, and stops sharing', async ({ page, mockApi }) => {
    const models = new ModelsPage(page);
    await models.navigate();
    const row = models.row(NAME);
    // Let the page load the unshared model before the next fetch answers "shared".
    await expect(row.getByRole('button', { name: 'Share' })).toBeVisible();

    mockApi.on('GET /models', [d.model({ share_url: d.shareLink().url })]);
    await row.getByRole('button', { name: 'Share' }).click();
    await expect(row.getByRole('button', { name: 'Copy public link' })).toBeVisible();
    expect(mockApi.callsTo('PUT /models/:name/share')[0].body).toEqual({ enabled: true });

    page.once('dialog', (dialog) => dialog.dismiss());
    await row.getByRole('button', { name: 'New link' }).click();
    expect(mockApi.callsTo('POST /models/:name/share/rotate')).toHaveLength(0);

    page.once('dialog', (dialog) => dialog.accept());
    await row.getByRole('button', { name: 'New link' }).click();
    await mockApi.waitForCall(page, 'POST /models/:name/share/rotate');
    // The rotation stays pending until its refetch of /models lands; only then
    // may the next answer of /models change, or that refetch would read it.
    await expect(row.getByRole('button', { name: 'Stop' })).toBeEnabled();

    mockApi.on('GET /models', [d.model({ share_url: null })]);
    await row.getByRole('button', { name: 'Stop' }).click();
    await expect(row.getByRole('button', { name: 'Share' })).toBeVisible();
    expect(mockApi.callsTo('PUT /models/:name/share')[1].body).toEqual({ enabled: false });
  });
});

test('deleting a model asks first', async ({ page, mockApi }) => {
  const models = new ModelsPage(page);
  await models.navigate();

  page.once('dialog', (dialog) => dialog.dismiss());
  await models.row(NAME).getByRole('button', { name: 'Delete' }).click();
  expect(mockApi.callsTo('DELETE /models/:name')).toHaveLength(0);

  mockApi.on('GET /models', []);
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain(`Delete model "${NAME}"?`);
    return dialog.accept();
  });
  await models.row(NAME).getByRole('button', { name: 'Delete' }).click();
  await expect(models.rows).toHaveCount(0);
  expect(mockApi.callsTo('DELETE /models/:name')[0].params.name).toBe(NAME);
});

test('the model name opens its dashboard', async ({ page }) => {
  const models = new ModelsPage(page);
  await models.navigate();
  await page.getByRole('button', { name: NAME, exact: true }).click();
  await expect(page.getByRole('heading', { name: NAME, level: 2 })).toBeVisible();
  await expect(page.getByText('Usage, health, training quality and version history of this model.')).toBeVisible();
  await page.getByRole('button', { name: 'All models' }).click();
  await expect(models.heading).toBeVisible();
});

test.describe('admin', () => {
  test.use({ me: d.admin() });

  test('sees the owner column', async ({ page }) => {
    const models = new ModelsPage(page);
    await models.navigate();
    await expect(page.getByRole('columnheader', { name: 'User' })).toBeVisible();
    await expect(models.row(NAME)).toContainText('ana@t');
  });
});
