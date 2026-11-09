import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import Dashboard from '../../src/pages/Dashboard';

vi.mock('../../src/api/client', () => ({
  API_BASE: 'http://api.test',
  TOKEN_KEY: 'mlops_token',
}));

const auth = { isAdmin: false };
vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => auth,
}));

const useRepos = vi.fn();
const usePipelines = vi.fn();
const useServiceHealth = vi.fn();

vi.mock('../../src/hooks/usePipelines', () => ({
  useRepos: () => useRepos(),
  usePipelines: () => usePipelines(),
  useServiceHealth: () => useServiceHealth(),
}));

const PIPELINE = {
  id: 'pipeline-001',
  repo_id: 1,
  status: 'success',
  commit_sha: 'abc1234567',
  started_at: '2026-02-23T10:00:00Z',
  finished_at: '2026-02-23T10:05:00Z',
  phases: [],
  metrics: {},
};

/**
 * Renders and waits for the metrics section to finish opening its Grafana
 * proxy session. Without the wait its state lands after the test body, which
 * React reports as an update outside `act`.
 */
async function renderDashboard() {
  const result = render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
  await screen.findByTitle(/Grafana dashboard/);
  return result;
}

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRepos.mockReturnValue({
      data: [{ id: 1, github_url: 'https://github.com/testuser/ml-project' }],
    });
    usePipelines.mockReturnValue({ data: { items: [PIPELINE] }, isLoading: false });
    useServiceHealth.mockReturnValue({ data: { redis: true, mlflow: true, model_server: true } });
    // MetricsPanels primes the Grafana proxy cookie before mounting its iframe.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('is one page: health, what ran, and the metrics', async () => {
    // The whole point of the change: the Grafana panels were a second page
    // called "Dashboards", one nav item below this one.
    auth.isAdmin = true;
    await renderDashboard();
    auth.isAdmin = false;

    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Service Health')).toBeInTheDocument();
    expect(screen.getByText('Recent Pipelines')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Model metrics' })).toBeInTheDocument();
  });

  it('shows the service health to admins only', async () => {
    await renderDashboard();

    expect(screen.queryByText('Service Health')).not.toBeInTheDocument();
    expect(screen.getByText('Recent Pipelines')).toBeInTheDocument();
  });

  it('does not list repositories', async () => {
    // A repository is something a project links to, not a top-level thing.
    await renderDashboard();

    expect(screen.queryByRole('heading', { name: 'Repositories' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Add Repository/i })).not.toBeInTheDocument();
  });

  it('still names the repository each run came from', async () => {
    // Dropping the section does not drop the fact: a pipeline runs on a repo.
    await renderDashboard();
    expect(screen.getByText('testuser/ml-project')).toBeInTheDocument();
  });
});
