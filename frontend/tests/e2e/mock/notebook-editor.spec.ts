/** /repos/:id/notebook — editing a notebook's cells and pushing them to GitHub. */
import { test, expect } from '../fixtures/test';
import { error } from '../fixtures/api';

const URL = '/repos/1/notebook?branch=main&path=notebooks%2Ftrain.ipynb';

test('loads the notebook cells from the branch', async ({ page, mockApi }) => {
  await page.goto(URL);
  await expect(page.getByRole('heading', { name: 'train.ipynb', level: 1 })).toBeVisible();
  await expect(page.getByRole('article', { name: 'markdown cell 1' })).toContainText('Churn training');
  await expect(page.getByRole('textbox', { name: 'Code of cell 2' })).toHaveValue("MODEL_NAME = 'churn-model'");
  await expect(page.getByText('No changes')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save & push' })).toBeDisabled();
  const load = mockApi.callsTo('GET /repos/:id/notebook')[0];
  expect(Object.fromEntries(load.query)).toEqual({ branch: 'main', path: 'notebooks/train.ipynb' });
});

test('edits a cell and pushes it with a commit message', async ({ page, mockApi }) => {
  await page.goto(URL);
  await page.getByRole('textbox', { name: 'Code of cell 3' }).fill('model.fit(X_train, y_train)');
  await expect(page.getByText('1 cell edited')).toBeVisible();

  await page.getByRole('button', { name: 'Save & push' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save and push to GitHub' });
  await expect(dialog).toContainText('[3]');
  await expect(dialog).toContainText('This notebook is linked to Churn');
  await dialog.getByLabel('Commit message').fill('Train on the split');
  await dialog.getByRole('button', { name: 'Commit & push' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(/Pushed 1 cell to main in commit/)).toBeVisible();
  await expect(page.getByText('All changes pushed')).toBeVisible();
  expect(mockApi.callsTo('PUT /repos/:id/notebook')[0].body).toEqual({
    branch: 'main',
    notebook_path: 'notebooks/train.ipynb',
    sha: 'blobsha0001',
    message: 'Train on the split',
    cells: [{ index: 2, source: 'model.fit(X_train, y_train)' }],
  });
});

test('Ctrl+S opens the push dialog and Escape closes it', async ({ page }) => {
  await page.goto(URL);
  await page.getByRole('textbox', { name: 'Code of cell 2' }).fill("MODEL_NAME = 'churn-v2'");
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a push refused because GitHub moved on shows the conflict', async ({ page, mockApi }) => {
  mockApi.on('PUT /repos/:id/notebook', error(409, 'The notebook changed on GitHub since you opened it'));
  await page.goto(URL);
  await page.getByRole('textbox', { name: 'Code of cell 3' }).fill('model.fit(X, y, sample_weight=w)');
  await page.getByRole('button', { name: 'Save & push' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Commit & push' }).click();
  await expect(dialog).toContainText('The notebook changed on GitHub since you opened it');
});

test('reverting a cell and discarding all changes', async ({ page }) => {
  await page.goto(URL);
  const cell2 = page.getByRole('textbox', { name: 'Code of cell 2' });
  const cell3 = page.getByRole('textbox', { name: 'Code of cell 3' });
  await cell2.fill('x = 1');
  await cell3.fill('y = 2');
  await expect(page.getByText('2 cells edited')).toBeVisible();

  await page.getByRole('button', { name: 'Discard the changes to cell 2' }).click();
  await expect(cell2).toHaveValue("MODEL_NAME = 'churn-model'");
  await expect(page.getByText('1 cell edited')).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await expect(cell3).toHaveValue('model.fit(X, y)');
  await expect(page.getByText('No changes')).toBeVisible();
});

test('edits a markdown cell', async ({ page, mockApi }) => {
  await page.goto(URL);
  await page.getByRole('button', { name: 'Edit text cell 1' }).click();
  await page.getByRole('textbox', { name: 'Markdown source of cell 1' }).fill('# Churn training, v2');
  await page.getByRole('button', { name: 'Save & push' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Commit & push' }).click();
  await expect(page.getByText('All changes pushed')).toBeVisible();
  expect((mockApi.callsTo('PUT /repos/:id/notebook')[0].body as { cells: unknown[] }).cells).toEqual([
    { index: 0, source: '# Churn training, v2' },
  ]);
});

test('leaving with unsaved changes asks first', async ({ page }) => {
  await page.goto('/repos/new');
  await page.getByRole('link', { name: 'Edit notebooks/train.ipynb on main' }).click();
  await page.getByRole('textbox', { name: 'Code of cell 2' }).fill('x = 1');

  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('link', { name: 'My repos' }).click();
  await expect(page.getByRole('heading', { name: 'train.ipynb' })).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('link', { name: 'My repos' }).click();
  await expect(page.getByRole('heading', { name: 'My Repos' })).toBeVisible();
});

test('a link without branch or path explains what is missing', async ({ page, mockApi }) => {
  await page.goto('/repos/1/notebook');
  await expect(page.getByText(/This link is missing the notebook's branch or path/)).toBeVisible();
  expect(mockApi.callsTo('GET /repos/:id/notebook')).toHaveLength(0);
});

test('a notebook that cannot be loaded shows the error', async ({ page, mockApi }) => {
  mockApi.on('GET /repos/:id/notebook', error(404, 'Notebook not found on main'));
  await page.goto(URL);
  await expect(page.getByText('Notebook not found on main')).toBeVisible();
});
