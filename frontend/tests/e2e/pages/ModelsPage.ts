import type { Page, Locator } from '@playwright/test';

export class ModelsPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly modelTable: Locator;
  readonly modelRows: Locator;
  readonly testButtons: Locator;
  readonly rollbackButtons: Locator;
  readonly deleteButtons: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { name: /Models/i });
    this.modelTable = page.locator('table');
    this.modelRows = page.locator('table tbody tr');
    this.testButtons = page.getByRole('button', { name: 'Test' });
    this.rollbackButtons = page.getByRole('button', { name: 'Rollback' });
    this.deleteButtons = page.getByRole('button', { name: 'Delete' });
  }

  async navigate() {
    await this.page.goto('/models');
  }

  async getModelCount(): Promise<number> {
    return this.modelRows.count();
  }

  async clickTestOnFirst() {
    await this.testButtons.first().click();
  }

  async getTestModal() {
    return this.page.locator('[class*="fixed inset-0"]');
  }

  async fillPayloadAndSubmit(payload: string) {
    const textarea = this.page.locator('textarea');
    await textarea.clear();
    await textarea.fill(payload);
    await this.page.getByRole('button', { name: /Send Request/i }).click();
  }

  async closeModal() {
    // Click the close button (X) in the modal header
    const closeBtn = this.page.locator('[class*="fixed inset-0"] button').first();
    await closeBtn.click();
  }
}
