import type { Page } from '@playwright/test';
import {
  test,
  expect,
  dataset,
  datasetPreview,
  ingestionRun,
  layer,
  medallion,
  source,
  upload,
  fail,
} from '../fixtures/test';

/** A project whose data has made it all the way to gold. */
const built = medallion({
  bronze: layer('bronze', { objects: 1, rows: 120 }),
  silver: layer('silver', {
    objects: 1,
    rows: 118,
    streams: [{ source_id: 1, source_name: 'Hospital HIS', relation: 'hospital_his', objects: 1, rows: 118, size_bytes: 2048 }],
  }),
  gold: layer('gold', { objects: 1, rows: 118, version: 1 }),
});

const stage = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Data factory stages' }).getByRole('button', { name, exact: true });

test.describe('data factory, empty project', () => {
  test('opens on connect and says what unlocks each stage', async ({ page }) => {
    await page.goto('/projects/1/data');

    await expect(page.getByRole('heading', { name: 'Data Factory', level: 2 })).toBeVisible();
    await expect(stage(page, 'Connect')).toHaveAttribute('aria-current', 'step');
    await expect(stage(page, 'Preview')).toBeDisabled();
    await expect(stage(page, 'Preview')).toHaveAttribute('title', 'Connect a source first');
    await expect(stage(page, 'Gold')).toHaveAttribute('title', 'Build silver first');
    await expect(stage(page, 'KPI maker')).toBeDisabled();
  });

  test('connects a database source', async ({ page, mockApi }) => {
    await page.goto('/projects/1/data');

    await page.getByRole('button', { name: 'Add source' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Hospital HIS');
    await page.getByLabel('Host').fill('hospital-db');
    await page.getByLabel('Database').fill('his');
    await page.getByLabel('Username', { exact: true }).fill('reader');
    await page.getByLabel('Extraction query').fill('SELECT * FROM admissions WHERE updated_at > :watermark');
    await page.getByRole('textbox', { name: /^Watermark column/ }).fill('updated_at');
    mockApi.on('GET', '/sources', [source()]);
    await page.getByRole('button', { name: 'Connect source' }).click();

    await expect(page.getByText('hospital-db:5432/his')).toBeVisible();
    await expect(stage(page, 'Preview')).toBeEnabled();
    expect(mockApi.calls('POST', '/sources')[0].body).toMatchObject({
      project_id: 1,
      name: 'Hospital HIS',
      host: 'hospital-db',
      watermark_column: 'updated_at',
    });
  });

  test('previews a source before connecting it', async ({ page, mockApi }) => {
    mockApi.on('POST', '/sources/preview', {
      columns: ['patient_id', 'cost'],
      rows: [[7, 120.5]],
      profile: {},
      truncated: false,
    });
    await page.goto('/projects/1/data');

    await page.getByRole('button', { name: 'Add source' }).click();
    await page.getByLabel('Host').fill('hospital-db');
    await page.getByLabel('Database').fill('his');
    await page.getByLabel('Username', { exact: true }).fill('reader');
    await page.getByRole('button', { name: 'Preview data' }).click();

    await expect(page.getByText('patient_id')).toBeVisible();
    await expect(page.getByText('120.5')).toBeVisible();
    expect(mockApi.calls('POST', '/sources')).toHaveLength(0);
  });

  test('a refused connection says why', async ({ page, mockApi }) => {
    mockApi.on('POST', '/sources', fail(400, 'The query must reference :watermark'));
    await page.goto('/projects/1/data');

    await page.getByRole('button', { name: 'Add source' }).click();
    await page.getByLabel('Name', { exact: true }).fill('HIS');
    await page.getByLabel('Host').fill('hospital-db');
    await page.getByLabel('Database').fill('his');
    await page.getByLabel('Username', { exact: true }).fill('reader');
    await page.getByLabel('Extraction query').fill('SELECT 1');
    await page.getByRole('textbox', { name: /^Watermark column/ }).fill('updated_at');
    await page.getByRole('button', { name: 'Connect source' }).click();

    await expect(page.getByText('The query must reference :watermark')).toBeVisible();
  });

  test('uploads a file and follows it through the layers', async ({ page, mockApi }) => {
    await page.goto('/projects/1/data');

    await page.getByLabel('Dataset file').setInputFiles({
      name: 'iris.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('sepal_length,species\n5.1,setosa\n'),
    });
    mockApi.on('GET', '/projects/:id/uploads', [upload()]);
    await page.getByRole('button', { name: 'Upload', exact: true }).click();

    await expect(page.getByText(/Uploaded\. It is now going through bronze, silver and gold/)).toBeVisible();
    const uploads = page.getByRole('region', { name: 'Your uploads' });
    await expect(uploads).toContainText('iris.csv');
    await expect(uploads).toContainText('150 rows in bronze');
    const [call] = mockApi.calls('POST', '/projects/:id/datasets');
    expect(String(call.body)).toContain('filename="iris.csv"');
  });
});

test.describe('data factory, with a source', () => {
  test.beforeEach(({ mockApi }) => {
    mockApi.on('GET', '/sources', [source()]);
  });

  test('runs an extraction', async ({ page, mockApi }) => {
    await page.goto('/projects/1/data');
    await stage(page, 'Extract').click();

    mockApi.on('GET', '/sources/:id/runs', [ingestionRun({ status: 'running' })]);
    await page.getByRole('button', { name: 'Run extraction' }).click();

    await expect(page.getByText(/Extracting from the source/)).toBeVisible();
    expect(mockApi.calls('POST', '/sources/:id/ingest')).toHaveLength(1);
  });

  test('disconnects a source', async ({ page, mockApi }) => {
    await page.goto('/projects/1/data');
    await expect(page.getByText('hospital-db:5432/his')).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept());
    mockApi.on('GET', '/sources', []);
    await page.getByRole('button', { name: 'Disconnect Hospital HIS' }).click();

    await expect(page.getByText('hospital-db:5432/his')).toHaveCount(0);
    expect(mockApi.calls('DELETE', '/sources/:id')).toHaveLength(1);
  });
});

test.describe('data factory, built to gold', () => {
  test.beforeEach(({ mockApi }) => {
    mockApi.on('GET', '/sources', [source()]);
    mockApi.on('GET', '/projects/:id/medallion', built);
  });

  test('opens on the furthest stage reached', async ({ page }) => {
    await page.goto('/projects/1/data');

    await expect(stage(page, 'Gold')).toHaveAttribute('aria-current', 'step');
    await expect(page.getByRole('heading', { name: 'How gold is built' })).toBeVisible();
    await expect(stage(page, 'KPI maker')).toBeEnabled();
  });

  test('shows the cleaning recipe on silver', async ({ page }) => {
    await page.goto('/projects/1/data');
    await stage(page, 'Silver').click();

    await expect(page.getByRole('region', { name: 'Cleaning recipe' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'How this source is cleaned' })).toBeVisible();
  });

  test('writes, runs and saves a gold definition', async ({ page, mockApi }) => {
    mockApi.on('POST', '/projects/:id/medallion/gold/suggest', {
      sql: 'SELECT patient_id, count(*) AS n FROM hospital_his GROUP BY 1',
      explanation: 'Una fila por paciente.',
      error: '',
    });
    mockApi.on('POST', '/projects/:id/medallion/gold/preview', {
      columns: ['patient_id', 'n'],
      rows: [[7, 3]],
      total_rows: 1,
      relations: { hospital_his: 118 },
      sql: '',
    });
    await page.goto('/projects/1/data');

    await page.getByLabel('Describe the table you want').fill('one row per patient');
    await page.getByRole('button', { name: 'Write the query' }).click();
    await expect(page.getByText('Una fila por paciente.')).toBeVisible();
    await expect(page.getByLabel('The query that builds gold')).toHaveValue(/GROUP BY 1/);

    const save = page.getByRole('button', { name: 'Use this definition' });
    await expect(save).toBeDisabled();
    await page.getByRole('button', { name: 'Run it' }).click();
    await expect(save).toBeEnabled();
    await save.click();

    await expect.poll(() => mockApi.calls('PUT', '/projects/:id/medallion/gold').length).toBe(1);
    expect(mockApi.calls('PUT', '/projects/:id/medallion/gold')[0].body).toEqual({
      sql: 'SELECT patient_id, count(*) AS n FROM hospital_his GROUP BY 1',
      name: 'gold',
    });
  });

  test('a failed suggestion says so', async ({ page, mockApi }) => {
    mockApi.on('POST', '/projects/:id/medallion/gold/suggest', fail(503, 'The AI provider is not configured'));
    await page.goto('/projects/1/data');

    await page.getByLabel('Describe the table you want').fill('one row per patient');
    await page.getByRole('button', { name: 'Write the query' }).click();

    await expect(page.getByText(/The AI provider is not configured/)).toBeVisible();
  });

  test('asks the KPI maker for a dashboard', async ({ page, mockApi }) => {
    mockApi.on('POST', '/projects/:id/dashboard', {
      turns: [
        {
          id: 1,
          prompt: 'Encounters per month',
          summary: 'No pude construirlo: falta la columna de fecha.',
          calls: [],
          turns: 1,
          exhausted: false,
          created_at: null,
        },
      ],
      superset_url: '',
    });
    await page.goto('/projects/1/data');
    await stage(page, 'KPI maker').click();

    await page.getByLabel('What should the dashboard show?').fill('Encounters per month');
    await page.getByRole('button', { name: 'Build it' }).click();

    await expect(page.getByText('No pude construirlo: falta la columna de fecha.')).toBeVisible();
    expect(mockApi.calls('POST', '/projects/:id/dashboard')[0].body).toEqual({ prompt: 'Encounters per month' });
  });
});

test.describe('gold builds', () => {
  test('lists builds and activates one', async ({ page, mockApi }) => {
    mockApi.on('GET', '/projects/:id/datasets', [
      dataset({ id: 1, name: 'gold-v2', is_active: true }),
      dataset({ id: 2, name: 'gold-v1', is_active: false }),
    ]);
    await page.goto('/projects/1/datasets');

    await expect(page.getByRole('heading', { name: 'Data', level: 2 })).toBeVisible();
    const v1 = page.getByRole('row', { name: /gold-v1/ });
    const v2 = page.getByRole('row', { name: /gold-v2/ });
    await expect(v2).toContainText('Activo');
    await expect(v2.getByRole('button', { name: 'Activate' })).toBeDisabled();

    mockApi.on('GET', '/projects/:id/datasets', [
      dataset({ id: 1, name: 'gold-v2', is_active: false }),
      dataset({ id: 2, name: 'gold-v1', is_active: true }),
    ]);
    await v1.getByRole('button', { name: 'Activate' }).click();

    await expect(v1).toContainText('Activo');
    expect(mockApi.calls('POST', '/datasets/:id/activate')[0].path).toBe('/datasets/2/activate');
  });

  test('previews a build', async ({ page, mockApi }) => {
    mockApi.on('GET', '/projects/:id/datasets', [dataset({ name: 'gold-v1' })]);
    mockApi.on('GET', '/datasets/:id/preview', datasetPreview({ truncated: true }));
    await page.goto('/projects/1/datasets');

    await page.getByRole('row', { name: /gold-v1/ }).getByRole('button', { name: 'Preview' }).click();

    await expect(page.getByRole('heading', { name: 'Preview: gold-v1' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'versicolor' })).toBeVisible();
    await expect(page.getByText('Showing the first 2 rows only.')).toBeVisible();
    await page.getByRole('button', { name: 'Close preview' }).click();
    await expect(page.getByRole('heading', { name: 'Preview: gold-v1' })).toHaveCount(0);
  });

  test('deletes a build after confirming', async ({ page, mockApi }) => {
    mockApi.on('GET', '/projects/:id/datasets', [dataset({ name: 'gold-v1', is_active: false })]);
    await page.goto('/projects/1/datasets');
    await expect(page.getByRole('row', { name: /gold-v1/ })).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept());
    mockApi.on('GET', '/projects/:id/datasets', []);
    await page.getByRole('row', { name: /gold-v1/ }).getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText(/No datasets uploaded yet/)).toBeVisible();
    expect(mockApi.calls('DELETE', '/datasets/:id')).toHaveLength(1);
  });

  test('keeps the build when the delete is cancelled', async ({ page, mockApi }) => {
    mockApi.on('GET', '/projects/:id/datasets', [dataset({ name: 'gold-v1', is_active: false })]);
    await page.goto('/projects/1/datasets');

    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('row', { name: /gold-v1/ }).getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByRole('row', { name: /gold-v1/ })).toBeVisible();
    expect(mockApi.calls('DELETE', '/datasets/:id')).toHaveLength(0);
  });

  test('reports a failure to load builds', async ({ page, mockApi }) => {
    mockApi.on('GET', '/projects/:id/datasets', fail(500, 'MinIO unreachable'));
    await page.goto('/projects/1/datasets');

    await expect(page.getByText('Failed to load datasets: MinIO unreachable')).toBeVisible();
  });
});
