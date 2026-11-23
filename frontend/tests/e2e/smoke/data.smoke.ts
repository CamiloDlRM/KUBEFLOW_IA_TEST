import { test, expect } from '@playwright/test';
import { ADMIN, api, projectIdByName, tokenFor, unique } from '../fixtures/smoke';

test('uploads a CSV to MinIO and lists it under the project', async ({ page, request }) => {
  const token = await tokenFor(request, ADMIN);
  const name = unique('Smoke data');
  expect((await api(request, token).post('/projects', { name, description: '' })).ok()).toBe(true);
  const id = await projectIdByName(request, token, name);

  try {
    await page.goto(`/projects/${id}/data`);
    await page.getByLabel('Dataset file').setInputFiles({
      name: 'smoke.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('a,b\n1,2\n3,4\n'),
    });
    await page.getByRole('button', { name: 'Upload', exact: true }).click();

    await expect(page.getByText(/Uploaded\. It is now going through bronze, silver and gold/)).toBeVisible();
    // No worker runs in the smoke stack: the file is stored and its processing stays queued.
    await expect(page.getByRole('region', { name: 'Your uploads' })).toContainText('smoke.csv');
  } finally {
    await api(request, token).delete(`/projects/${id}`);
  }
});
