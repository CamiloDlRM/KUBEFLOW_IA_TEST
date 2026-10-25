import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import Projects from '../../src/pages/Projects';
import ProjectDetail from '../../src/pages/ProjectDetail';
import type { Project } from '../../src/types';

const getProjects = vi.fn();
const getProject = vi.fn();
const createProject = vi.fn();
const getRepos = vi.fn();
const getRepoBranches = vi.fn();
const getRepoNotebooks = vi.fn();
const linkRepository = vi.fn();
const unlinkRepository = vi.fn();
const getPipelineInput = vi.fn();
const runProject = vi.fn();

vi.mock('../../src/api/client', () => ({
  getProjects: (...args: unknown[]) => getProjects(...args),
  getProject: (...args: unknown[]) => getProject(...args),
  createProject: (...args: unknown[]) => createProject(...args),
  getRepos: (...args: unknown[]) => getRepos(...args),
  getRepoBranches: (...args: unknown[]) => getRepoBranches(...args),
  getRepoNotebooks: (...args: unknown[]) => getRepoNotebooks(...args),
  linkRepository: (...args: unknown[]) => linkRepository(...args),
  unlinkRepository: (...args: unknown[]) => unlinkRepository(...args),
  getPipelineInput: (...args: unknown[]) => getPipelineInput(...args),
  runProject: (...args: unknown[]) => runProject(...args),
}));

/**
 * Linking is no longer one click. A repository is registered once and carries
 * no notebook, so a project picks the branch and the notebook it wants at the
 * moment it links — which is four steps, and the button stays disabled until
 * there is a notebook to link.
 */
async function linkFirstNotebook() {
  await userEvent.click(await screen.findByRole('button', { name: /link a repository/i }));
  await userEvent.click(await screen.findByRole('button', { name: /first/i }));

  const notebooks = await screen.findByRole('button', { name: /select a notebook/i });
  await waitFor(() => expect(notebooks).toBeEnabled());
  await userEvent.click(notebooks);
  await userEvent.click(
    within(screen.getByRole('listbox')).getByRole('button', { name: /train\.ipynb/ }),
  );

  await userEvent.click(screen.getByRole('button', { name: /link selected notebook/i }));
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 4,
    name: 'Hospital readmissions',
    description: '',
    owner_id: 1,
    created_at: '2026-09-12T10:00:00Z',
    repository: null,
    sources: 2,
    gold_rows: 21_455,
    ...overrides,
  };
}

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Projects />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/projects/4']}>
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Projects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProjects.mockResolvedValue([project()]);
    createProject.mockResolvedValue(project({ id: 5, name: 'New one' }));
  });

  it('creates a project from a name alone', async () => {
    // The whole point of the entity: work can start before there is a
    // repository, so the form must not ask for one.
    renderList();
    await userEvent.type(await screen.findByPlaceholderText(/Hospital readmissions/), 'New one');
    await userEvent.click(screen.getByRole('button', { name: /new project/i }));

    await waitFor(() => expect(createProject).toHaveBeenCalledWith({ name: 'New one' }));
  });

  it('will not submit an empty name', async () => {
    renderList();
    await screen.findByPlaceholderText(/Hospital readmissions/);
    expect(screen.getByRole('button', { name: /new project/i })).toBeDisabled();
  });

  it('shows what each project holds', async () => {
    renderList();
    expect(await screen.findByText('Hospital readmissions')).toBeInTheDocument();
    const counts = document.body.textContent?.replace(/[.,\s]/g, '') ?? '';
    expect(counts).toContain('21455');
  });

  it('says a project has no repository without treating it as a problem', async () => {
    renderList();
    const note = await screen.findByText(/No repository linked yet/);
    // Muted, not red: data work starting first is the normal case.
    expect(note.className).toContain('slate');
  });

  it('names the repository when there is one', async () => {
    getProjects.mockResolvedValue([
      project({
        repository: {
          id: 1,
          github_url: 'https://github.com/CamiloDlRM/Mlops-notebooks.git',
          branch: 'main',
          notebook_path: 'nb.ipynb',
        },
      }),
    ]);
    renderList();
    expect(await screen.findByText(/Mlops-notebooks/)).toBeInTheDocument();
  });

  it('invites a first project when there are none', async () => {
    getProjects.mockResolvedValue([]);
    renderList();
    expect(await screen.findByText(/No projects yet/)).toBeInTheDocument();
  });
});

describe('ProjectDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProject.mockResolvedValue(project());
    getRepos.mockResolvedValue([
      { id: 1, github_url: 'https://github.com/a/first.git', notebooks: [] },
    ]);
    getRepoBranches.mockResolvedValue([{ name: 'main', commit_sha: 'abc1234' }]);
    getRepoNotebooks.mockResolvedValue(['notebooks/train.ipynb']);
    linkRepository.mockResolvedValue(project());
    unlinkRepository.mockResolvedValue(project());
    getPipelineInput.mockResolvedValue({ choice: {}, resolved: null, error: '' });
  });

  it('leads to the data factory with what it currently holds', async () => {
    renderDetail();
    const link = await screen.findByRole('link', { name: /Data Factory/ });
    expect(link).toHaveAttribute('href', '/projects/4/data');
  });

  it('links a repository with the branch and notebook that were chosen', async () => {
    renderDetail();
    await linkFirstNotebook();

    await waitFor(() =>
      expect(linkRepository).toHaveBeenCalledWith(4, 1, 'main', 'notebooks/train.ipynb'),
    );
  });

  it('will not link until a notebook has been chosen', async () => {
    // The repository alone is not enough any more, and the button says so by
    // staying inert rather than failing on the server.
    renderDetail();
    await userEvent.click(await screen.findByRole('button', { name: /link a repository/i }));
    await userEvent.click(await screen.findByRole('button', { name: /first/i }));

    expect(await screen.findByRole('button', { name: /link selected notebook/i })).toBeDisabled();
    expect(linkRepository).not.toHaveBeenCalled();
  });

  it('says the data factory works without a repository', async () => {
    renderDetail();
    expect(await screen.findByText(/works without one/)).toBeInTheDocument();
  });

  it('points at adding a repository when the user has none', async () => {
    getRepos.mockResolvedValue([]);
    renderDetail();
    await userEvent.click(await screen.findByRole('button', { name: /link a repository/i }));

    expect(await screen.findByText(/no repositories registered/i)).toBeInTheDocument();
  });

  it('unlinks without touching the data', async () => {
    getProject.mockResolvedValue(
      project({
        repository: {
          id: 1,
          github_url: 'https://github.com/a/first.git',
          branch: 'main',
          notebook_path: 'nb.ipynb',
        },
      }),
    );
    renderDetail();
    // The copy is the promise being made, so it is worth asserting.
    expect(await screen.findByText(/unlinking leaves the data exactly where it is/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /unlink/i }));
    await waitFor(() => expect(unlinkRepository).toHaveBeenCalledWith(4));
  });

  it('reports a failed link rather than doing nothing', async () => {
    linkRepository.mockRejectedValue(new Error('Repository 1 not found.'));
    renderDetail();
    await linkFirstNotebook();

    expect(await screen.findByText(/not found/)).toBeInTheDocument();
  });

  describe('running', () => {
    const linked = {
      repository: { id: 1, github_url: 'https://github.com/a/first.git', branch: 'main', notebook_path: 'train.ipynb' },
      active_dataset: null,
    };
    const silver = {
      choice: { layer: 'silver' as const, source_id: 2 },
      resolved: { label: 'silver · Hospital HIS' },
      error: '',
    };

    it('asks for data when there is neither gold nor a chosen layer', async () => {
      getProject.mockResolvedValue(project(linked));
      renderDetail();

      const [run] = await screen.findAllByRole('button', { name: /run pipeline/i });
      await waitFor(() => expect(getPipelineInput).toHaveBeenCalledWith(4));
      expect(run).toBeDisabled();
      expect(run).toHaveAttribute('title', expect.stringMatching(/choose a layer/));
    });

    it('runs on a chosen layer without gold, and says which in the summary', async () => {
      getProject.mockResolvedValue(project(linked));
      getPipelineInput.mockResolvedValue(silver);
      renderDetail();

      const [run] = await screen.findAllByRole('button', { name: /run pipeline/i });
      await waitFor(() => expect(run).toBeEnabled());
      await userEvent.click(run);

      const dialog = await screen.findByRole('dialog');
      expect(await within(dialog).findByText('silver · Hospital HIS')).toBeInTheDocument();
      expect(within(dialog).queryByText('Gold data')).not.toBeInTheDocument();
    });
  });
});
