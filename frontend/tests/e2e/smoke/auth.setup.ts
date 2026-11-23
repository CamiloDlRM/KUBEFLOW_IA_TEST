/** Signs in as the seeded admin once; the smoke specs start from this session. */
import { test as setup } from '@playwright/test';
import { ADMIN, signInThroughUi } from '../fixtures/smoke';

setup('sign in as the seeded admin', async ({ page }) => {
  await signInThroughUi(page, ADMIN);
  await page.context().storageState({ path: 'playwright/.auth/smoke-admin.json' });
});
