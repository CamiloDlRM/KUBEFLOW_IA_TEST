import type { Page, Locator } from '@playwright/test';

/** /pipelines/:id — phases, logs, the AI advisor and metrics of one run. */
export class PipelineDetailPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly phases: Locator;
  readonly logViewer: Locator;
  readonly advisor: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { name: /^Pipeline / , level: 2 });
    this.phases = page.getByTestId('pipeline-phases');
    this.logViewer = page.getByTestId('log-viewer');
    this.advisor = page.getByRole('region', { name: 'AI Training Advisor' });
  }

  async navigate(id: string) {
    await this.page.goto(`/pipelines/${id}`);
  }
}
