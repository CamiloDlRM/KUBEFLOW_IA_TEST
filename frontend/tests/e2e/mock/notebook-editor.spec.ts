import { test, expect, fail } from '../fixtures/test';

const EDITOR = '/repos/1/notebook?branch=main&path=notebooks%2Ftrain.ipynb';

test.describe('notebook editor', () => {
  test('loads the notebook cells with their mlops tags', async ({ page }) => {
    await page.goto(EDITOR);

    await expect(page.getByRole('heading', { name: 'train.ipynb', level: 1 })).toBeVisible();
    await expect(page.getByRole('article', { name: 'markdown cell 1' })).toBeVisible();
    const config = page.getByRole('article', { name: 'code cell 2' });
    await expect(config).toContainText('mlops:config');
    await expect(page.getByText('No changes')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save & push' })).toBeDisabled();
  });

  test('edits a cell, commits and pushes it', async ({ page, mockApi }) => {
    await page.goto(EDITOR);

    const code = page.getByLabel('Code of cell 3');
    await code.click();
    await code.press('End');
    await code.pressSequentially('  # tuned');
    await expect(page.getByText('1 cell edited')).toBeVisible();

    await page.getByRole('button', { name: 'Save & push' }).click();
    const dialog = page.getByRole('dialog', { name: 'Save and push to GitHub' });
    await expect(dialog).toContainText('[3]');
    // Pushing a linked notebook starts a run: the dialog warns first.
    await expect(dialog).toContainText(/linked to\s+Iris/);
    await dialog.getByLabel('Commit message').fill('Tune the model');
    await dialog.getByRole('button', { name: 'Commit & push' }).click();

    await expect(page.getByText(/Pushed 1 cell to/)).toBeVisible();
    await expect(page.getByText('All changes pushed')).toBeVisible();
    const [call] = mockApi.calls('PUT', '/repos/:id/notebook');
    expect(call.body).toMatchObject({
      branch: 'main',
      notebook_path: 'notebooks/train.ipynb',
      sha: 'sha-1',
      message: 'Tune the model',
      cells: [{ index: 2, source: 'model.fit(X, y)  # tuned' }],
    });
  });

  test('a stale notebook is refused and the edit kept', async ({ page, mockApi }) => {
    mockApi.on('PUT', '/repos/:id/notebook', fail(409, 'The notebook changed on GitHub since you opened it'));
    await page.goto(EDITOR);

    const code = page.getByLabel('Code of cell 3');
    await code.click();
    await code.press('End');
    await code.pressSequentially('!');
    await page.getByRole('button', { name: 'Save & push' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Commit & push' }).click();

    await expect(page.getByText('The notebook changed on GitHub since you opened it')).toBeVisible();
    await expect(page.getByLabel('Code of cell 3')).toContainText('model.fit(X, y)!');
  });

  test('discards a cell’s changes', async ({ page }) => {
    await page.goto(EDITOR);

    const code = page.getByLabel('Code of cell 3');
    await code.click();
    await code.press('End');
    await code.pressSequentially('!');
    await page.getByRole('button', { name: 'Discard the changes to cell 3' }).click();

    await expect(page.getByText('No changes')).toBeVisible();
    await expect(code).not.toContainText('!');
  });

  test('asks before leaving with unsaved changes', async ({ page }) => {
    await page.goto(EDITOR);

    const code = page.getByLabel('Code of cell 3');
    await code.click();
    await code.pressSequentially('x');
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('link', { name: 'My repos' }).click();
    await expect(page).toHaveURL(/\/notebook\?/);

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('link', { name: 'My repos' }).click();
    await expect(page).toHaveURL(/\/repos\/new$/);
  });

  test('a link without branch or path explains itself', async ({ page }) => {
    await page.goto('/repos/1/notebook');

    await expect(page.getByText(/This link is missing the notebook's branch or path/)).toBeVisible();
  });

  test('a notebook GitHub cannot serve shows the error', async ({ page, mockApi }) => {
    mockApi.on('GET', '/repos/:id/notebook', fail(404, 'Notebook not found on main'));
    await page.goto(EDITOR);

    await expect(page.getByText('Notebook not found on main')).toBeVisible();
  });
});
