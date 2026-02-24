import type { Page, Locator } from '@playwright/test';

export class DashboardPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly addRepoButton: Locator;
  readonly repoCards: Locator;
  readonly pipelineRows: Locator;
  readonly healthDots: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { name: /Dashboard/i });
    this.addRepoButton = page.getByRole('link', { name: /Add Repository/i });
    this.repoCards = page.locator('[class*="rounded-lg"][class*="border-slate-700"]').filter({ hasText: /branch/ });
    this.pipelineRows = page.locator('table tbody tr');
    this.healthDots = page.locator('[class*="rounded-full"][class*="h-2.5"]');
  }

  async navigate() {
    await this.page.goto('/');
  }

  async clickAddRepository() {
    await this.addRepoButton.click();
  }

  async getRepoCount(): Promise<number> {
    return this.repoCards.count();
  }

  async getPipelineCount(): Promise<number> {
    return this.pipelineRows.count();
  }
}
