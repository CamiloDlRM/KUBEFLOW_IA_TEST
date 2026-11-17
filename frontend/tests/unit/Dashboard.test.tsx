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

const useDeployedModels = vi.fn();
const useModelTraffic = vi.fn();

vi.mock('../../src/hooks/useDeployedModels', () => ({
  useDeployedModels: () => useDeployedModels(),
  useModelTraffic: () => useModelTraffic(),
}));

const usePipelineStats = vi.fn();
const useProjects = vi.fn();

vi.mock('../../src/hooks/useDashboard', () => ({
  usePipelineStats: () => usePipelineStats(),
  useProjects: () => useProjects(),
}));

function model(name: string, owner = 'alice') {
  return {
    model_name: name,
    version: '1',
    accuracy: 0.9,
    metric: 'accuracy',
    metric_value: 0.9,
    endpoint_url: '',
    deployed_at: '2026-11-01T10:00:00Z',
    is_active: true,
    pipeline_id: `run-${name}`,
    owner_username: owner,
  };
}

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
    useDeployedModels.mockReturnValue({ data: [], isLoading: false });
    useModelTraffic.mockReturnValue({ data: { window: '30d', available: true, requests: {} } });
    usePipelineStats.mockReturnValue({ data: undefined });
    useProjects.mockReturnValue({ data: [] });
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

  it("lists a member's deployed models, busiest first", async () => {
    useDeployedModels.mockReturnValue({ data: [model('iris'), model('wine')], isLoading: false });
    useModelTraffic.mockReturnValue({
      data: { window: '30d', available: true, requests: { iris: 3, wine: 40 } },
    });
    await renderDashboard();

    expect(screen.getByRole('heading', { name: 'My deployed models' })).toBeInTheDocument();
    const names = screen.getAllByText(/^(iris|wine)$/).map((el) => el.textContent);
    expect(names).toEqual(['wine', 'iris']);
    expect(screen.getAllByTestId('model-requests').map((el) => el.textContent)).toEqual(['40', '3']);
    // Members see only their own models, so naming the owner would say nothing.
    expect(screen.queryByText('alice')).not.toBeInTheDocument();
  });

  it('shows admins only the most requested models, with their owners', async () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f'];
    useDeployedModels.mockReturnValue({ data: names.map((n) => model(n, `owner-${n}`)), isLoading: false });
    useModelTraffic.mockReturnValue({
      data: { window: '30d', available: true, requests: { a: 1, b: 9, c: 5, d: 7, e: 3, f: 8 } },
    });
    auth.isAdmin = true;
    await renderDashboard();
    auth.isAdmin = false;

    expect(screen.getByRole('heading', { name: 'Most requested models' })).toBeInTheDocument();
    // Top five by requests: b 9, f 8, d 7, c 5, e 3. The least requested is left out.
    expect(screen.getAllByTestId('deployed-model')).toHaveLength(5);
    expect(screen.getByText('owner-b')).toBeInTheDocument();
    expect(screen.queryByText('owner-a')).not.toBeInTheDocument();
  });

  it('says the request count is unknown when Prometheus is down', async () => {
    useDeployedModels.mockReturnValue({ data: [model('iris')], isLoading: false });
    useModelTraffic.mockReturnValue({ data: { window: '30d', available: false, requests: { iris: 0 } } });
    await renderDashboard();

    expect(screen.getByTestId('model-requests')).toHaveTextContent(/^--$/);
  });

  it('names a run by its project, with its branch', async () => {
    usePipelines.mockReturnValue({
      data: { items: [{ ...PIPELINE, project_id: 7, branch: 'ai/tune-depth' }] },
      isLoading: false,
    });
    useProjects.mockReturnValue({ data: [{ id: 7, name: 'Churn' }] });
    await renderDashboard();

    expect(screen.getByText('Churn')).toBeInTheDocument();
    expect(screen.getByText('ai/tune-depth')).toBeInTheDocument();
    expect(screen.queryByText('testuser/ml-project')).not.toBeInTheDocument();
  });

  describe('key figures', () => {
    const tile = (label: string) => screen.getByText(label).parentElement!;

    it('adds up what is serving, how runs go and how much models are called', async () => {
      useDeployedModels.mockReturnValue({
        data: [model('iris', 'ana'), model('wine', 'luis'), model('beer', 'ana')],
        isLoading: false,
      });
      useModelTraffic.mockReturnValue({
        data: { window: '30d', available: true, requests: { iris: 1200, wine: 34, beer: 0 } },
      });
      usePipelineStats.mockReturnValue({
        data: { window_days: 30, finished: 20, succeeded: 17, success_rate: 0.85, previous_success_rate: 0.8 },
      });
      auth.isAdmin = true;
      await renderDashboard();
      auth.isAdmin = false;

      expect(tile('Deployed models')).toHaveTextContent('3across 2 users');
      expect(tile('Pipeline success · 30d')).toHaveTextContent('85%+5 pts vs previous 30d');
      expect(tile('Prediction requests · 30d')).toHaveTextContent('1,234across 3 models');
      expect(tile('Last run')).toHaveTextContent('pipeline');
    });

    it('says a figure is unknown rather than zero', async () => {
      useModelTraffic.mockReturnValue({ data: { window: '30d', available: false, requests: {} } });
      usePipelineStats.mockReturnValue({
        data: { window_days: 30, finished: 0, succeeded: 0, success_rate: null, previous_success_rate: null },
      });
      await renderDashboard();

      expect(tile('Pipeline success · 30d')).toHaveTextContent('--no finished runs');
      expect(tile('Prediction requests · 30d')).toHaveTextContent('--Prometheus unreachable');
    });
  });
});
