import type { Page, Locator } from '@playwright/test';

export class PipelineDetailPage {
  readonly page: Page;
  readonly statusBadge: Locator;
  readonly logViewer: Locator;
  readonly phaseTimeline: Locator;

  constructor(page: Page) {
    this.page = page;
    this.statusBadge = page.locator('[class*="rounded-full"][class*="px-2.5"]').first();
    this.logViewer = page.locator('[class*="font-mono"]').first();
    this.phaseTimeline = page.locator('text=download, text=validate, text=execute');
  }

  async navigate(pipelineId: string) {
    await this.page.goto(`/pipelines/${pipelineId}`);
  }
}
