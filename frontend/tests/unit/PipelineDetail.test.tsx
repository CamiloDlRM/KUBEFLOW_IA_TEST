import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PipelineDetail from '../../src/pages/PipelineDetail';
import type { Pipeline } from '../../src/types';

const usePipeline = vi.fn();

vi.mock('../../src/hooks/usePipelines', () => ({
  usePipeline: (...args: unknown[]) => usePipeline(...args),
  useRepos: () => ({ data: [] }),
  usePipelineLogs: () => ({ data: { logs: [] }, isLoading: false }),
}));
vi.mock('../../src/hooks/useWebSocket', () => ({
  useWebSocket: () => ({ messages: [], status: 'disconnected' }),
}));
vi.mock('../../src/context/AuthContext', () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock('../../src/api/client', () => ({
  getWsUrl: () => '',
  getPipelines: () => Promise.resolve({ items: [], total: 0, page: 1, size: 10 }),
}));
vi.mock('../../src/components/AIInsights', () => ({ default: () => null }));

function run(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: 'run-1',
    repo_id: 9,
    project_id: 4,
    status: 'success',
    commit_sha: 'abc',
    branch: 'main',
    started_at: '2026-10-24T10:00:00Z',
    finished_at: '2026-10-24T10:05:00Z',
    phases: [],
    metrics: {},
    owner_username: null,
    ...overrides,
  };
}

function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/pipelines/run-1']}>
        <Routes>
          <Route path="/pipelines/:id" element={<PipelineDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PipelineDetail', () => {
  beforeEach(() => vi.clearAllMocks());

  it('leads to the same run on its project canvas, not back to the dashboard', () => {
    usePipeline.mockReturnValue({ data: run(), isLoading: false, error: null });
    renderDetail();

    expect(screen.getByRole('link', { name: /code and data of this run/i })).toHaveAttribute(
      'href',
      '/projects/4/pipeline?run=run-1',
    );
    expect(screen.queryByText(/back to dashboard/i)).not.toBeInTheDocument();
  });

  it('has no canvas link for a run older than projects', () => {
    usePipeline.mockReturnValue({ data: run({ project_id: null }), isLoading: false, error: null });
    renderDetail();

    expect(screen.queryByRole('link', { name: /code and data of this run/i })).not.toBeInTheDocument();
  });
});
