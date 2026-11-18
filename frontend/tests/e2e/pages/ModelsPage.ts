import type { Page, Locator } from '@playwright/test';

/** /models — deployed models, their test dialog, versions and public links. */
export class ModelsPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly rows: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { name: 'Models', level: 2 });
    this.rows = page.getByRole('table').getByRole('row').filter({ has: page.getByRole('cell') });
  }

  async navigate() {
    await this.page.goto('/models');
  }

  row(modelName: string): Locator {
    return this.rows.filter({ has: this.page.getByRole('button', { name: modelName, exact: true }) });
  }

  async openTest(modelName: string): Promise<Locator> {
    await this.row(modelName).getByRole('button', { name: 'Test', exact: true }).click();
    return this.page.getByRole('dialog', { name: `Test ${modelName}` });
  }

  async openVersions(modelName: string): Promise<Locator> {
    await this.row(modelName).getByRole('button', { name: 'Versions', exact: true }).click();
    return this.page.getByRole('dialog', { name: `Versions of ${modelName}` });
  }
}
