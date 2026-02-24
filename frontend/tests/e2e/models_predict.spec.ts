import { test, expect } from '@playwright/test';
import { ModelsPage } from './pages/ModelsPage';

test.describe('Model Prediction', () => {
  test.beforeEach(async ({ page }) => {
    // Mock all required API endpoints
    await page.route('**/models', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              model_name: 'iris-classifier',
              version: '1',
              accuracy: 0.95,
              endpoint_url: 'http://model-server:8001/predict/iris-classifier',
              deployed_at: '2026-02-23T10:10:00Z',
              is_active: true,
              pipeline_id: 'pipeline-001',
            },
            {
              model_name: 'fraud-detector',
              version: '3',
              accuracy: 0.88,
              endpoint_url: 'http://model-server:8001/predict/fraud-detector',
              deployed_at: '2026-02-22T15:30:00Z',
              is_active: true,
              pipeline_id: 'pipeline-002',
            },
          ]),
        });
      } else {
        await route.continue();
      }
    });

    await page.route('**/models/*/predict', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          prediction: [0, 1, 2],
          model_name: 'iris-classifier',
          version: '1',
        }),
      });
    });

    await page.route('**/ready', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          redis: 'ok',
          mlflow: 'ok',
          model_server: 'ok',
        }),
      });
    });

    await page.route('**/health', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok' }),
      });
    });

    // Mock repos and pipelines endpoints that Dashboard needs
    await page.route('**/repos', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    await page.route('**/pipelines?*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], total: 0, page: 1, size: 20 }),
      });
    });
  });

  test('model table when models deployed should display all models', async ({ page }) => {
    const modelsPage = new ModelsPage(page);
    await modelsPage.navigate();

    await expect(modelsPage.heading).toBeVisible();
    await expect(modelsPage.modelTable).toBeVisible({ timeout: 10_000 });

    const count = await modelsPage.getModelCount();
    expect(count).toBe(2);

    await expect(page.getByText('iris-classifier')).toBeVisible();
    await expect(page.getByText('fraud-detector')).toBeVisible();
  });

  test('model prediction when valid input should return result', async ({ page }) => {
    const modelsPage = new ModelsPage(page);
    await modelsPage.navigate();

    // Wait for models table to load
    await expect(modelsPage.modelTable).toBeVisible({ timeout: 10_000 });

    // Click Test on first model
    await modelsPage.clickTestOnFirst();

    // Modal should be visible
    const modal = await modelsPage.getTestModal();
    await expect(modal).toBeVisible();

    // Fill payload and submit
    await modelsPage.fillPayloadAndSubmit(
      '{"data": [[5.1, 3.5, 1.4, 0.2]]}',
    );

    // Should show prediction result
    await expect(page.getByText(/\[0, 1, 2\]/)).toBeVisible({ timeout: 10_000 });
  });

  test('model prediction when invalid json should show validation error', async ({
    page,
  }) => {
    const modelsPage = new ModelsPage(page);
    await modelsPage.navigate();

    await expect(modelsPage.modelTable).toBeVisible({ timeout: 10_000 });

    await modelsPage.clickTestOnFirst();

    const modal = await modelsPage.getTestModal();
    await expect(modal).toBeVisible();

    // Submit invalid JSON
    await modelsPage.fillPayloadAndSubmit('not valid json {{{');

    await expect(page.getByText(/Invalid JSON/i)).toBeVisible();
  });

  test('close modal after prediction', async ({ page }) => {
    const modelsPage = new ModelsPage(page);
    await modelsPage.navigate();

    await expect(modelsPage.modelTable).toBeVisible({ timeout: 10_000 });
    await modelsPage.clickTestOnFirst();

    const modal = await modelsPage.getTestModal();
    await expect(modal).toBeVisible();

    // Close the modal via the Close button
    await page.getByRole('button', { name: 'Close' }).click();

    // Modal should be gone
    await expect(modal).not.toBeVisible();
  });
});
