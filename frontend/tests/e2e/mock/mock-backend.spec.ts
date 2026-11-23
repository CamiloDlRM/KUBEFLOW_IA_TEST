/** The fake backend itself: what it guarantees every other spec. */
import { test, expect } from '../fixtures/test';

test.describe('the mock backend', () => {
  test.use({ me: null });

  // Expected to fail: the request below has no handler, and the fixture must catch it.
  test.fail('fails a test that calls an endpoint with no handler', async ({ page }) => {
    await page.goto('/login');
    const status = await page.evaluate(() => fetch('http://localhost:8000/not-mocked').then((r) => r.status));
    expect(status).toBe(501);
  });

  test.fail('fails a test whose page throws', async ({ page }) => {
    await page.goto('/login');
    await page.evaluate(() => setTimeout(() => {
      throw new Error('boom');
    }));
    await page.waitForTimeout(100);
  });

  test.describe('with an allowed request', () => {
    test.use({ allowUnhandled: ['GET /not-mocked'] });

    test('lets a listed request through', async ({ page }) => {
      await page.goto('/login');
      const status = await page.evaluate(() => fetch('http://localhost:8000/not-mocked').then((r) => r.status));
      expect(status).toBe(501);
    });
  });

  test('records calls with their bodies', async ({ page, mockApi }) => {
    mockApi.on('POST', '/echo/:id', ({ params, body }) => ({ id: params.id, body }));
    await page.goto('/login');
    const answer = await page.evaluate(() =>
      fetch('http://localhost:8000/echo/7', { method: 'POST', body: JSON.stringify({ a: 1 }) }).then((r) => r.json()),
    );

    expect(answer).toEqual({ id: '7', body: { a: 1 } });
    expect(mockApi.calls('POST', '/echo/:id')).toHaveLength(1);
  });
});
