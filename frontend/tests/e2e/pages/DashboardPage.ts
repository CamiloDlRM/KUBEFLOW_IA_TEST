import type { Page, Locator } from '@playwright/test';

export class DashboardPage {
  readonly page: Page;
  readonly heading: Locator;
  /** Rows of the "Recent Pipelines" table. */
  readonly pipelineRows: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { name: 'Dashboard', level: 2 });
    this.pipelineRows = page.getByRole('table').getByRole('row').filter({ has: page.getByRole('cell') });
  }

  async navigate() {
    await this.page.goto('/');
  }

  /** The row of the run whose id starts with `idPrefix`. */
  pipelineRow(idPrefix: string): Locator {
    return this.pipelineRows.filter({ has: this.page.getByRole('link', { name: idPrefix }) });
  }
}
