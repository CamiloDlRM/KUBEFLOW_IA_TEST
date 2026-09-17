import type { Page, Locator } from '@playwright/test';

export class DashboardPage {
  readonly page: Page;
  readonly heading: Locator;
  /** In the sidebar. The dashboard itself no longer lists repositories: a
   *  repository is something a project links to, not a top-level thing. */
  readonly addRepoLink: Locator;
  readonly projectsButton: Locator;
  readonly pipelineRows: Locator;
  readonly healthDots: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { name: /Dashboard/i });
    this.addRepoLink = page.getByRole('link', { name: /Add Repo/i });
    this.projectsButton = page.getByRole('link', { name: /^Projects$/i });
    this.pipelineRows = page.locator('table tbody tr');
    this.healthDots = page.locator('[class*="rounded-full"][class*="h-2.5"]');
  }

  async navigate() {
    await this.page.goto('/');
  }

  async clickAddRepository() {
    await this.addRepoLink.first().click();
  }

  async getPipelineCount(): Promise<number> {
    return this.pipelineRows.count();
  }
}
