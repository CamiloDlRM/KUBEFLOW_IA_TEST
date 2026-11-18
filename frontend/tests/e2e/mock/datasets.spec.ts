/** /projects/:id/datasets — sources, the three layers, uploads and the dataset list. */
import { test, expect } from '../fixtures/test';
import { error } from '../fixtures/api';
import * as d from '../fixtures/data';

const URL = '/projects/1/datasets';

function datasetRow(page: import('@playwright/test').Page, name: string) {
  return page.getByRole('row').filter({ hasText: name });
}

test.describe('dataset list', () => {
  test('marks the active dataset and disables activating it again', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByRole('heading', { name: 'Data', level: 2 })).toBeVisible();
    await expect(page.getByText('Training data for acme/churn.', { exact: false })).toBeVisible();

    const active = datasetRow(page, 'gold-v3.parquet');
    await expect(active).toContainText('Activo');
    await expect(active.getByRole('button', { name: 'Activate' })).toBeDisabled();
    await expect(datasetRow(page, 'gold-v2.parquet').getByRole('button', { name: 'Activate' })).toBeEnabled();
  });

  test('activates another dataset', async ({ page, mockApi }) => {
    await page.goto(URL);
    const older = datasetRow(page, 'gold-v2.parquet');
    await expect(older.getByRole('button', { name: 'Activate' })).toBeEnabled();
    mockApi.on('GET /projects/:id/datasets', [
      d.dataset({ is_active: false }),
      d.dataset({ id: 10, name: 'gold-v2.parquet', is_active: true }),
    ]);
    await older.getByRole('button', { name: 'Activate' }).click();
    await expect(older).toContainText('Activo');
    expect(mockApi.callsTo('POST /datasets/:id/activate')[0].params.id).toBe('10');
  });

  test('previews the first rows of a dataset', async ({ page }) => {
    await page.goto(URL);
    await datasetRow(page, 'gold-v3.parquet').getByRole('button', { name: 'Preview' }).click();
    const dialog = page.getByRole('dialog', { name: 'Preview: gold-v3.parquet' });
    await expect(dialog.getByRole('columnheader', { name: 'monthly_charges' })).toBeVisible();
    await expect(dialog.getByRole('row')).toHaveCount(3);
    await dialog.getByRole('button', { name: 'Close preview' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('a preview that fails says so', async ({ page, mockApi }) => {
    mockApi.on('GET /datasets/:id/preview', error(500, 'object missing in MinIO'));
    await page.goto(URL);
    await datasetRow(page, 'gold-v3.parquet').getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByRole('dialog')).toContainText('Failed to load preview: object missing in MinIO');
  });

  test('deleting asks first, and does nothing when dismissed', async ({ page, mockApi }) => {
    await page.goto(URL);
    page.once('dialog', (dialog) => dialog.dismiss());
    await datasetRow(page, 'gold-v2.parquet').getByRole('button', { name: 'Delete' }).click();
    expect(mockApi.callsTo('DELETE /datasets/:id')).toHaveLength(0);

    mockApi.on('GET /projects/:id/datasets', [d.dataset()]);
    page.once('dialog', (dialog) => {
      expect(dialog.message()).toBe('Delete dataset "gold-v2.parquet"? This cannot be undone.');
      return dialog.accept();
    });
    await datasetRow(page, 'gold-v2.parquet').getByRole('button', { name: 'Delete' }).click();
    await expect(datasetRow(page, 'gold-v2.parquet')).toHaveCount(0);
    expect(mockApi.callsTo('DELETE /datasets/:id')[0].params.id).toBe('10');
  });

  test('with no datasets it invites an upload', async ({ page, mockApi }) => {
    mockApi.on('GET /projects/:id/datasets', []);
    await page.goto(URL);
    await expect(page.getByText(/No datasets uploaded yet/)).toBeVisible();
  });
});

test.describe('upload', () => {
  test('uploads a CSV with a description as multipart form data', async ({ page, mockApi }) => {
    await page.goto(URL);
    const upload = page.getByRole('button', { name: 'Upload', exact: true });
    await expect(upload).toBeDisabled();

    await page.getByLabel('Dataset file').setInputFiles({
      name: 'customers.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('tenure,churn\n1,0\n34,1\n'),
    });
    await page.getByRole('textbox', { name: 'Description (optional)' }).fill('Q3 export');
    await upload.click();

    await expect(page.getByText('Dataset uploaded successfully.')).toBeVisible();
    const call = mockApi.callsTo('POST /projects/:id/datasets')[0];
    expect(call.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    const raw = call.request.postDataBuffer()?.toString() ?? '';
    expect(raw).toContain('filename="customers.csv"');
    expect(raw).toContain('tenure,churn');
    expect(raw).toContain('Q3 export');
  });

  test('a rejected upload shows the reason', async ({ page, mockApi }) => {
    mockApi.on('POST /projects/:id/datasets', error(413, 'File too large'));
    await page.goto(URL);
    await page.getByLabel('Dataset file').setInputFiles({ name: 'big.csv', mimeType: 'text/csv', buffer: Buffer.from('a\n1\n') });
    await page.getByRole('button', { name: 'Upload', exact: true }).click();
    await expect(page.getByText('Upload failed: File too large')).toBeVisible();
  });
});

test.describe('external sources', () => {
  test('connects a new database source', async ({ page, mockApi }) => {
    await page.goto(URL);
    await page.getByRole('button', { name: 'Add source' }).click();

    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Hospital HIS');
    await page.getByRole('textbox', { name: 'Host' }).fill('hospital-db');
    await page.getByRole('textbox', { name: 'Database', exact: true }).fill('his');
    await page.getByRole('textbox', { name: 'Username' }).fill('reader');
    await page.getByRole('combobox', { name: 'Password environment variable' }).selectOption('HOSPITAL_DB_PASSWORD');

    await page.getByRole('button', { name: 'Preview data' }).click();
    await expect(page.getByRole('cell', { name: '34' }).first()).toBeVisible();

    mockApi.on('GET /sources', [d.source(), d.source({ id: 22, name: 'Hospital HIS', host: 'hospital-db', database: 'his', watermark_value: '' })]);
    await page.getByRole('button', { name: 'Connect source' }).click();

    await expect(page.getByRole('button', { name: 'Disconnect Hospital HIS' })).toBeVisible();
    expect(mockApi.callsTo('POST /sources')[0].body).toMatchObject({
      project_id: 1,
      name: 'Hospital HIS',
      host: 'hospital-db',
      database: 'his',
      username: 'reader',
      password_env: 'HOSPITAL_DB_PASSWORD',
    });
  });

  test('a source that cannot be reached reports it on preview', async ({ page, mockApi }) => {
    mockApi.on('POST /sources/preview', error(400, 'could not connect to server'));
    await page.goto(URL);
    await page.getByRole('button', { name: 'Add source' }).click();
    await page.getByRole('textbox', { name: 'Host' }).fill('nowhere');
    await page.getByRole('textbox', { name: 'Database', exact: true }).fill('db');
    await page.getByRole('textbox', { name: 'Username' }).fill('u');
    await page.getByRole('button', { name: 'Preview data' }).click();
    await expect(page.getByText('could not connect to server')).toBeVisible();
  });

  test('runs an extraction and disconnects a source', async ({ page, mockApi }) => {
    await page.goto(URL);
    await page.getByRole('button', { name: 'Run extraction' }).click();
    await mockApi.waitForCall(page, 'POST /sources/:id/ingest');

    mockApi.on('GET /sources', []);
    await page.getByRole('button', { name: 'Disconnect crm' }).click();
    await expect(page.getByText(/No source connected/)).toBeVisible();
    expect(mockApi.callsTo('DELETE /sources/:id')[0].params.id).toBe(String(d.IDS.source));
  });
});

test.describe('layers', () => {
  test('switching layer shows its preview', async ({ page, mockApi }) => {
    await page.goto(URL);
    await expect(page.getByRole('button', { name: /^Silver/ })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: /^Bronze/ }).click();
    await expect(page.getByRole('button', { name: /^Bronze/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { name: /^Bronze/ })).toBeVisible();
    await mockApi.waitForCall(page, 'GET /projects/:id/medallion/:layer/preview');
    expect(mockApi.callsTo('GET /projects/:id/medallion/:layer/preview').map((c) => c.params.layer)).toContain('bronze');
  });
});
