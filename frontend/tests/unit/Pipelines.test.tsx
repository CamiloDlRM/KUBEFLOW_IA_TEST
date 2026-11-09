import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import Pipelines from '../../src/pages/Pipelines';
import type { Pipeline } from '../../src/types';

function run(id: string, project_id: number | null, notebook_path: string): Pipeline {
  return {
    id,
    repo_id: 9,
    project_id,
    notebook_path,
    status: 'success',
    commit_sha: 'abc1234',
    branch: 'main',
    started_at: '2026-10-01T00:00:00Z',
    finished_at: '2026-10-01T00:05:00Z',
    phases: [],
    metrics: {},
    owner_username: null,
  };
}

vi.mock('../../src/api/client', () => ({ getProjects: () => Promise.resolve([]) }));
vi.mock('../../src/context/AuthContext', () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock('../../src/hooks/usePipelines', () => ({
  useRepos: () => ({ data: [] }),
  usePipelines: () => ({
    data: { items: [run('run-1', 4, 'train.ipynb'), run('legacy-1', null, 'old.ipynb')] },
    isLoading: false,
    error: null,
  }),
}));

describe('Pipelines', () => {
  it('opens a run on its project canvas, and a run without a project on its own page', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <Pipelines />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByRole('link', { name: /train\.ipynb/ })).toHaveAttribute('href', '/pipelines/canvas/4?run=run-1');
    expect(screen.getByRole('link', { name: /old\.ipynb/ })).toHaveAttribute('href', '/pipelines/legacy-1');
  });
});
