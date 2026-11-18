/** /projects/:id/data — the seven stages, the gold definition, the cleaning recipe and the KPI maker. */
import { test, expect } from '../fixtures/test';
import * as d from '../fixtures/data';
import type { Page } from '@playwright/test';

const URL = '/projects/1/data';

function stage(page: Page, name: string) {
  return page.getByRole('navigation', { name: 'Data factory stages' }).getByRole('button', { name, exact: true });
}

test('opens on the furthest stage reached and links back to the project', async ({ page }) => {
  await page.goto(URL);
  await expect(page.getByRole('heading', { name: 'Data Factory', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Gold — what the project answers' })).toBeVisible();
  await expect(stage(page, 'Bronze')).toContainText('1,200 rows');
  await expect(stage(page, 'Gold')).toContainText('v3');
  await page.getByRole('main').getByRole('link', { name: 'Churn' }).click();
  await expect(page).toHaveURL(/\/projects\/1$/);
});

test('a project with no data starts at Connect', async ({ page, mockApi }) => {
  mockApi.on('GET /projects/:id/medallion', d.emptyMedallion());
  mockApi.on('GET /sources', []);
  mockApi.on('GET /projects/:id/uploads', []);
  await page.goto(URL);
  await expect(page.getByRole('button', { name: 'Add source' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Upload dataset' })).toBeVisible();
});

test('each stage shows its own content', async ({ page, mockApi }) => {
  await page.goto(URL);

  await stage(page, 'Connect').click();
  await expect(page.getByRole('region', { name: 'Your uploads' })).toContainText('customers.csv');

  await stage(page, 'Preview').click();
  await expect(page.getByText('2 rows · nothing was stored')).toBeVisible();
  await mockApi.waitForCall(page, 'POST /sources/preview');

  await stage(page, 'Extract').click();
  await expect(page.getByRole('button', { name: 'Run extraction' })).toBeVisible();

  await stage(page, 'Bronze').click();
  await expect(page.getByText(/Exactly what came out, every column as text/)).toBeVisible();
  await expect(page.getByRole('main').getByRole('code').filter({ hasText: 'project-1/bronze/latest.parquet' })).toBeVisible();

  await stage(page, 'Silver').click();
  await expect(page.getByRole('region', { name: 'Cleaning recipe' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What the cleaning did, step by step' })).toBeVisible();

  await stage(page, 'KPI maker').click();
  await expect(page.getByRole('textbox', { name: 'What should the dashboard show?' })).toBeVisible();
});

test('an upload’s "View silver" jumps to that layer', async ({ page }) => {
  await page.goto(URL);
  await stage(page, 'Connect').click();
  await page.getByRole('region', { name: 'Your uploads' }).getByRole('button', { name: 'View silver' }).click();
  await expect(page.getByRole('region', { name: 'Cleaning recipe' })).toBeVisible();
});

test.describe('gold definition', () => {
  test('asks for a query, runs it, then uses it', async ({ page, mockApi }) => {
    await page.goto(URL);
    const save = page.getByRole('button', { name: 'Use this definition' });
    await expect(save).toBeDisabled();

    await page.getByRole('textbox', { name: 'Describe the table you want' }).fill('one row per customer');
    await page.getByRole('button', { name: 'Write the query' }).click();
    await expect(page.getByText('One row per customer.')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'The query that builds gold' })).toHaveValue('SELECT tenure, churn FROM crm');
    expect(mockApi.callsTo('POST /projects/:id/medallion/gold/suggest')[0].body).toEqual({ question: 'one row per customer' });

    // Saving is gated on having seen what the query returns.
    await expect(save).toBeDisabled();
    await page.getByRole('button', { name: 'Run it' }).click();
    await expect(page.getByText(/1,200 rows, 2 columns/)).toBeVisible();
    await expect(save).toBeEnabled();

    await save.click();
    await expect(page.getByText(/Saved\. Gold is rebuilding now/)).toBeVisible();
    expect(mockApi.callsTo('PUT /projects/:id/medallion/gold')[0].body).toEqual({
      sql: 'SELECT tenure, churn FROM crm',
      name: 'gold',
    });
  });

  test('"Back to the default" saves an empty definition', async ({ page, mockApi }) => {
    await page.goto(URL);
    await page.getByRole('textbox', { name: 'The query that builds gold' }).fill('SELECT tenure FROM crm');
    await page.getByRole('button', { name: 'Back to the default' }).click();
    await mockApi.waitForCall(page, 'PUT /projects/:id/medallion/gold');
    expect(mockApi.callsTo('PUT /projects/:id/medallion/gold')[0].body).toEqual({ sql: '', name: 'gold' });
    await expect(page.getByRole('textbox', { name: 'The query that builds gold' })).toHaveValue('');
  });
});

test.describe('cleaning recipe', () => {
  test('changing how codes are completed enables saving and stores a custom recipe', async ({ page, mockApi }) => {
    await page.goto(URL);
    await stage(page, 'Silver').click();
    const recipe = page.getByRole('region', { name: 'Cleaning recipe' });
    const save = recipe.getByRole('button', { name: 'Save recipe' });
    await expect(save).toBeDisabled();

    await recipe.getByRole('radio', { name: /^Off — codes stay exactly as they arrived/ }).check();
    await expect(save).toBeEnabled();

    await recipe.getByRole('button', { name: 'Try it on the latest extraction' }).click();
    const tried = await mockApi.waitForCall(page, 'POST /projects/:id/medallion/steps/preview');
    expect(tried.body).toMatchObject({ source_id: d.IDS.source, recipe: { normalize: { mode: 'off' } } });

    await save.click();
    const saved = await mockApi.waitForCall(page, 'PUT /sources/:id/cleaning-recipe');
    expect(saved.body).toMatchObject({ recipe: { normalize: { mode: 'off' } } });
  });
});

test.describe('KPI maker', () => {
  test('a suggestion fills the prompt and building sends it to the agent', async ({ page, mockApi }) => {
    mockApi.on('POST /projects/:id/dashboard', {
      turns: [
        {
          id: 1,
          prompt: 'Average total claim cost by encounter class',
          summary: 'I built **a bar chart** of the average cost per class.',
          calls: [],
          turns: 3,
          exhausted: false,
          created_at: d.NOW,
        },
      ],
      superset_url: '',
    });
    await page.goto(URL);
    await stage(page, 'KPI maker').click();

    const prompt = page.getByRole('textbox', { name: 'What should the dashboard show?' });
    const build = page.getByRole('button', { name: 'Build it' });
    await expect(build).toBeDisabled();
    await page.getByRole('button', { name: 'Average total claim cost by encounter class' }).click();
    await expect(prompt).toHaveValue('Average total claim cost by encounter class');
    await build.click();

    await expect(page.getByText('a bar chart')).toBeVisible();
    expect(mockApi.callsTo('POST /projects/:id/dashboard')[0].body).toEqual({
      prompt: 'Average total claim cost by encounter class',
    });
  });
});
