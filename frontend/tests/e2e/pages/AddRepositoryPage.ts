import type { Page, Locator } from '@playwright/test';

/** "My Repos" (/repos/new): register a repository, explore its branches and notebooks. */
export class AddRepositoryPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly expandForm: Locator;
  readonly urlInput: Locator;
  readonly submitButton: Locator;
  readonly cancelButton: Locator;
  readonly successMessage: Locator;
  readonly formError: Locator;
  readonly repoCards: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { name: 'My Repos' });
    this.expandForm = page.getByRole('button', { name: 'Expand repository form' });
    this.urlInput = page.getByLabel('GitHub Repository URL');
    this.submitButton = page.getByRole('button', { name: 'Register Repository' });
    this.cancelButton = page.getByRole('button', { name: 'Cancel' });
    this.successMessage = page.getByText('Repository registered. Explore its branches and notebooks below.');
    this.formError = page.locator('#add-repository-form').locator('.border-red-800');
    this.repoCards = page.getByRole('main').getByRole('article');
  }

  async navigate() {
    await this.page.goto('/repos/new');
  }

  async register(url: string) {
    if (await this.expandForm.isVisible()) await this.expandForm.click();
    await this.urlInput.fill(url);
    await this.submitButton.click();
  }

  repoCard(name: string): Locator {
    return this.repoCards.filter({ has: this.page.getByRole('heading', { name, exact: true }) });
  }
}
