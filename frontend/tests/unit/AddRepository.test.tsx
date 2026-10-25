import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import AddRepository from '../../src/pages/AddRepository';

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AddRepository />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * The page opens on the repositories you already have, with the form folded
 * away. Registering one is the rarer thing you came here to do, so every test
 * that fills the form has to open it first.
 */
async function openForm() {
  await userEvent.click(await screen.findByRole('button', { name: /expand repository form/i }));
}

async function fillForm(url = 'https://github.com/testuser/newrepo') {
  await userEvent.type(screen.getByLabelText(/GitHub Repository URL/i), url);
  await userEvent.type(
    screen.getByLabelText(/GitHub Personal Access Token/i),
    'ghp_test1234567890',
  );
}

describe('AddRepository', () => {
  it('keeps the form folded until it is asked for', async () => {
    renderWithProviders();

    const toggle = await screen.findByRole('button', { name: /expand repository form/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText(/GitHub Repository URL/i)).not.toBeInTheDocument();

    await userEvent.click(toggle);
    expect(screen.getByRole('button', { name: /collapse repository form/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('asks for a repository and a token, and nothing else', async () => {
    // A repository no longer carries a notebook: it is registered once, and a
    // project chooses a notebook inside it when it links. Asking for a path
    // here would be asking for the old concept back.
    renderWithProviders();
    await openForm();

    expect(screen.getByLabelText(/GitHub Repository URL/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/GitHub Personal Access Token/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Notebook Path/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Register Repository/i })).toBeInTheDocument();
  });

  it('validates github url format and shows error for invalid URLs', async () => {
    renderWithProviders();
    await openForm();

    // A valid URL that fails the GitHub-specific check.
    await fillForm('https://gitlab.com/user/repo');
    await userEvent.click(screen.getByRole('button', { name: /Register Repository/i }));

    await waitFor(() => {
      expect(screen.getByText(/valid GitHub repository URL/i)).toBeInTheDocument();
    });
  });

  it('shows token field as password type by default', async () => {
    renderWithProviders();
    await openForm();

    expect(screen.getByLabelText(/GitHub Personal Access Token/i)).toHaveAttribute(
      'type',
      'password',
    );
  });

  it('toggles token visibility on show/hide click', async () => {
    renderWithProviders();
    await openForm();

    const tokenInput = screen.getByLabelText(/GitHub Personal Access Token/i);
    expect(tokenInput).toHaveAttribute('type', 'password');

    await userEvent.click(screen.getByRole('button', { name: /Show/i }));
    expect(tokenInput).toHaveAttribute('type', 'text');

    await userEvent.click(screen.getByRole('button', { name: /Hide/i }));
    expect(tokenInput).toHaveAttribute('type', 'password');
  });

  it('registers the repository and points at its branches and notebooks', async () => {
    renderWithProviders();
    await openForm();

    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: /Register Repository/i }));

    // The whole sentence: "branches and notebooks" on its own also matches the
    // page's own intro copy and the cards below it.
    expect(
      await screen.findByText(/Repository registered\. Explore its branches and notebooks/i),
    ).toBeInTheDocument();
  });

  it('shows error message when API returns error', async () => {
    server.use(
      http.post('http://localhost:8000/repos', () =>
        HttpResponse.json(
          { detail: 'Failed to create GitHub webhook: rate limit exceeded' },
          { status: 502 },
        ),
      ),
    );

    renderWithProviders();
    await openForm();

    await fillForm('https://github.com/testuser/errorrepo');
    await userEvent.click(screen.getByRole('button', { name: /Register Repository/i }));

    await waitFor(() => {
      expect(screen.getByText(/rate limit exceeded/i)).toBeInTheDocument();
    });
  });

  function mockLinkedRepo(link: Record<string, unknown>, ...others: Record<string, unknown>[]) {
    server.use(
      http.get('http://localhost:8000/repos', () =>
        HttpResponse.json([
          {
            id: 1,
            github_url: 'https://github.com/testuser/ml-project',
            notebooks: [
              {
                project_id: 7,
                project_name: 'Demo',
                branch: 'main',
                notebook_path: 'notebooks/train.ipynb',
                active_pipeline_id: 'pipe-1',
                ...link,
              },
              ...others,
            ],
          },
        ]),
      ),
      http.get('http://localhost:8000/repos/1/branches', () =>
        HttpResponse.json([{ name: 'main', commit_sha: 'abc' }]),
      ),
      http.get('http://localhost:8000/repos/1/notebooks', () =>
        HttpResponse.json(['notebooks/eda.ipynb', 'notebooks/train.ipynb']),
      ),
    );
  }

  it('the green dot of the linked notebook opens its active pipeline', async () => {
    mockLinkedRepo({});
    renderWithProviders();

    const dot = await screen.findByRole('link', { name: /active pipeline of notebooks\/train/i });
    expect(dot).toHaveAttribute('href', '/pipelines/pipe-1');
    expect(screen.getAllByRole('link', { name: /active pipeline/i })).toHaveLength(1);
    // The name still opens the notebook on GitHub.
    expect(screen.getByRole('link', { name: 'notebooks/train.ipynb' })).toHaveAttribute(
      'href',
      'https://github.com/testuser/ml-project/blob/main/notebooks/train.ipynb',
    );
    expect(screen.getByText('webhook active')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Demo' })).toHaveAttribute('href', '/projects/7');
  });

  it('a linked notebook with nothing running gets a grey dot and no link', async () => {
    mockLinkedRepo({ active_pipeline_id: null });
    renderWithProviders();

    expect(await screen.findByRole('img', { name: /linked to demo/i })).toBeInTheDocument();
    expect(screen.getByText('webhook inactive')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /active pipeline/i })).not.toBeInTheDocument();
  });

  it('marks only the notebooks linked on the branch being explored', async () => {
    // The card opens on main, where eda is linked; train is linked on develop.
    mockLinkedRepo(
      { notebook_path: 'notebooks/eda.ipynb', active_pipeline_id: 'pipe-eda' },
      { project_id: 8, project_name: 'Other', branch: 'develop',
        notebook_path: 'notebooks/train.ipynb', active_pipeline_id: 'pipe-train' },
    );
    renderWithProviders();

    const dot = await screen.findByRole('link', { name: /active pipeline/i });
    expect(dot).toHaveAttribute('href', '/pipelines/pipe-eda');
    expect(screen.getAllByRole('link', { name: /active pipeline/i })).toHaveLength(1);
  });

  it('disables submit button during submission', async () => {
    // The response is held open until this test lets it go, rather than for a
    // fixed 200ms. A timed handler leaves the request in flight when the file
    // ends: vitest then deletes jsdom's globals, msw's XHR interceptor reaches
    // for `ProgressEvent` to report the response that finally arrived, and the
    // run fails with an unhandled rejection that names whichever file happened
    // to be running.
    let respond!: () => void;
    const held = new Promise<void>((resolve) => {
      respond = resolve;
    });
    server.use(
      http.post('http://localhost:8000/repos', async () => {
        await held;
        return HttpResponse.json(
          { repo_id: 3, webhook_url: 'http://test.com/webhook', status: 'webhook_created' },
          { status: 201 },
        );
      }),
    );

    renderWithProviders();
    await openForm();

    await fillForm('https://github.com/testuser/slowrepo');
    await userEvent.click(screen.getByRole('button', { name: /Register Repository/i }));

    // Unconditionally: the old version asserted inside `if (pendingBtn)`, so it
    // passed whether or not the button it was looking for ever appeared.
    expect(await screen.findByRole('button', { name: /Registering/i })).toBeDisabled();

    respond();
    await screen.findByText(/Repository registered/i);
  });
});
