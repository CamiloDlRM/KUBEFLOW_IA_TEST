import type { Page, Locator } from '@playwright/test';

export class AddRepositoryPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly urlInput: Locator;
  readonly tokenInput: Locator;
  readonly branchInput: Locator;
  readonly notebookInput: Locator;
  readonly submitButton: Locator;
  readonly cancelButton: Locator;
  readonly successMessage: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { name: /Add Repository/i });
    this.urlInput = page.locator('#repo-url');
    this.tokenInput = page.locator('#token');
    this.branchInput = page.locator('#branch');
    this.notebookInput = page.locator('#notebook');
    this.submitButton = page.getByRole('button', { name: /Register Repository/i });
    this.cancelButton = page.getByRole('button', { name: /Cancel/i });
    this.successMessage = page.getByText(/Repository registered successfully/i);
    this.errorMessage = page.locator('[class*="border-red"]');
  }

  async navigate() {
    await this.page.goto('/repos/new');
  }

  async fillForm(options: {
    url: string;
    token: string;
    branch?: string;
    notebook?: string;
  }) {
    await this.urlInput.fill(options.url);
    await this.tokenInput.fill(options.token);
    if (options.branch) {
      await this.branchInput.clear();
      await this.branchInput.fill(options.branch);
    }
    if (options.notebook) {
      await this.notebookInput.clear();
      await this.notebookInput.fill(options.notebook);
    }
  }

  async submit() {
    await this.submitButton.click();
  }
}
