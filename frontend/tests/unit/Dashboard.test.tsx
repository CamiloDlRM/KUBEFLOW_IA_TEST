import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import Dashboard from '../../src/pages/Dashboard';

vi.mock('../../src/api/client', () => ({
  API_BASE: 'http://api.test',
  TOKEN_KEY: 'mlops_token',
}));

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({ isAdmin: false }),
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
    await renderDashboard();

    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Service Health')).toBeInTheDocument();
    expect(screen.getByText('Recent Pipelines')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Model metrics' })).toBeInTheDocument();
  });

  it('does not list repositories', async () => {
    // A repository is something a project links to, not a top-level thing.
    await renderDashboard();

    expect(screen.queryByRole('heading', { name: 'Repositories' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Add Repository/i })).not.toBeInTheDocument();
  });

  it('sends you to projects instead', async () => {
    await renderDashboard();
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/projects');
  });

  it('still names the repository each run came from', async () => {
    // Dropping the section does not drop the fact: a pipeline runs on a repo.
    await renderDashboard();
    expect(screen.getByText('testuser/ml-project')).toBeInTheDocument();
  });
});
