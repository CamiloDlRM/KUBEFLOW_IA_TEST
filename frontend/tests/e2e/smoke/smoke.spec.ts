/**
 * Smoke tests against the real stack (docker-compose.e2e.yml): the frontend
 * talking to the real API, Postgres and MinIO. Nothing here touches GitHub or
 * an AI provider — those flows are covered by the mock suite.
 *
 * Every test starts signed in as the seeded admin (see auth.setup.ts) and
 * removes what it created, so the suite can run against the same stack again.
 */
import { test, expect, type Page } from '@playwright/test';
import { ADMIN, api, unique } from './env';

interface Project {
  id: number;
  name: string;
}

/** Fail on any uncaught error the page throws while the test runs. */
function watchErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on('pageerror', (err) => errors.push(err));
  return errors;
}

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the real login rejects a wrong password', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Username' }).fill(ADMIN.username);
    await page.getByRole('textbox', { name: 'Password' }).fill('definitely-not-it');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText(/incorrect|invalid/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});

test('every section renders against the real API', async ({ page }) => {
  const errors = watchErrors(page);
  const sections: [string, RegExp][] = [
    ['/', /^Dashboard$/],
    ['/projects', /^Projects$/],
    ['/pipelines', /^Pipelines$/],
    ['/models', /^Models$/],
    ['/repos/new', /^My Repos$/],
    ['/account', /^Account$/],
    ['/admin', /^Admin Panel$/],
  ];
  for (const [path, heading] of sections) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading }), `heading on ${path}`).toBeVisible();
    await expect(page.getByText(/Failed to load/), `load error on ${path}`).toHaveCount(0);
  }
  await expect(page.getByRole('main')).toContainText(`Signed in as ${ADMIN.username}`);
  expect(errors.map((e) => e.message)).toEqual([]);
});

test('the account page shows the signed-in admin', async ({ page }) => {
  await page.goto('/account');
  await expect(page.getByRole('definition').filter({ hasText: ADMIN.username })).toContainText('admin');
});

test.describe('a project and its data', () => {
  let project: Project | undefined;

  test.afterEach(async ({ request }) => {
    if (project) await api(request, 'DELETE', `/projects/${project.id}`).catch(() => undefined);
    project = undefined;
  });

  test('creates a project through the UI and opens it', async ({ page, request }) => {
    const errors = watchErrors(page);
    const name = unique('Smoke project');

    await page.goto('/projects');
    await page.getByRole('textbox', { name: 'Name your project' }).fill(name);
    await page.getByRole('button', { name: 'New project' }).click();

    const card = page.getByRole('link', { name: new RegExp(`^${name}`) });
    await expect(card).toBeVisible();
    project = (await api<Project[]>(request, 'GET', '/projects')).find((p) => p.name === name);
    expect(project, 'the API lists the project the UI created').toBeTruthy();

    await card.click();
    await expect(page).toHaveURL(new RegExp(`/projects/${project!.id}$`));
    await expect(page.getByRole('heading', { name, level: 2 })).toBeVisible();
    await expect(page.getByText(/No repository linked/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();

    await page.getByRole('link', { name: /^Data Factory/ }).click();
    await expect(page.getByRole('heading', { name: 'Data Factory', level: 2 })).toBeVisible();
    expect(errors.map((e) => e.message)).toEqual([]);
  });

  test('uploads a CSV to MinIO, activates it and previews its rows', async ({ page, request }) => {
    const errors = watchErrors(page);
    project = await api<Project>(request, 'POST', '/projects', { name: unique('Smoke data'), description: '' });

    await page.goto(`/projects/${project.id}/datasets`);
    await expect(page.getByText(/No datasets uploaded yet/)).toBeVisible();

    await page.getByLabel('Dataset file').setInputFiles({
      name: 'smoke.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('sepal_length,sepal_width,species\n5.1,3.5,setosa\n6.2,2.9,versicolor\n'),
    });
    await page.getByRole('textbox', { name: 'Description (optional)' }).fill('uploaded by the smoke suite');
    await page.getByRole('button', { name: 'Upload', exact: true }).click();
    await expect(page.getByText('Dataset uploaded successfully.')).toBeVisible();

    const row = page.getByRole('row').filter({ hasText: 'smoke.csv' });
    await expect(row).toContainText('uploaded by the smoke suite');
    // The only dataset of the project is the one the next run trains on.
    await expect(row).toContainText('Activo');

    // The preview is read back from MinIO by the backend: the round trip is the point.
    await row.getByRole('button', { name: 'Preview' }).click();
    const preview = page.getByRole('dialog', { name: 'Preview: smoke.csv' });
    await expect(preview.getByRole('columnheader', { name: 'species' })).toBeVisible();
    await expect(preview.getByRole('cell', { name: 'versicolor' })).toBeVisible();
    await preview.getByRole('button', { name: 'Close preview' }).click();

    page.once('dialog', (dialog) => dialog.accept());
    await row.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(/No datasets uploaded yet/)).toBeVisible();
    expect(errors.map((e) => e.message)).toEqual([]);
  });

  test('a file type the backend does not accept is refused', async ({ page, request }) => {
    project = await api<Project>(request, 'POST', '/projects', { name: unique('Smoke reject'), description: '' });
    await page.goto(`/projects/${project.id}/datasets`);
    await page.getByLabel('Dataset file').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not a dataset'),
    });
    await page.getByRole('button', { name: 'Upload', exact: true }).click();
    await expect(page.getByText(/Upload failed:/)).toBeVisible();
  });
});

test('an admin creates an invite link (no SMTP in this stack)', async ({ page }) => {
  await page.goto('/admin');
  await page.getByLabel('Email address').fill(`smoke-${Date.now()}@example.com`);
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByText('Email not sent')).toBeVisible();
  await expect(page.getByLabel(/Invite link/)).toHaveValue(/\/register\?token=.+/);
});
