import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ModelPanel, type NodePanelContext } from '../../src/components/flow/NodePanelContent';
import type { PipelineView } from '../../src/components/flow/usePipelineView';
import type { Pipeline } from '../../src/types';

const getPipelineLogs = vi.fn();
const useWebSocket = vi.fn();

vi.mock('../../src/api/client', () => ({
  getPipelineLogs: (...args: unknown[]) => getPipelineLogs(...args),
  getWsUrl: (id: string) => `ws://test/${id}`,
  getPipelineInput: vi.fn(),
  getPipelineInputOptions: vi.fn(),
}));
vi.mock('../../src/hooks/useWebSocket', () => ({
  useWebSocket: (url: string | null) => useWebSocket(url),
}));

function run(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: 'run-1',
    repo_id: 9,
    project_id: 4,
    status: 'success',
    commit_sha: 'abc',
    branch: 'main',
    started_at: '2026-10-01T00:00:00Z',
    finished_at: '2026-10-01T00:05:00Z',
    phases: [],
    metrics: { accuracy: 0.91 },
    owner_username: null,
    ...overrides,
  };
}

function renderPanel(shownRun: Pipeline) {
  const view = { shownRun, runs: [shownRun], errorNode: 'input', fromRun: false } as unknown as PipelineView;
  const context = { projectId: 4, chooseInput: {} as NodePanelContext['chooseInput'], view };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ModelPanel {...context} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const log = (logs: string, phase = 'register') => ({ pipeline_id: 'run-1', phase, status: 'success', logs, timestamp: '2026-10-01T00:01:00Z' });

describe('ModelPanel', () => {
  it('shows the metrics and the stored logs of a finished run', async () => {
    useWebSocket.mockReturnValue({ messages: [], status: 'disconnected' });
    getPipelineLogs.mockResolvedValue({ pipeline_id: 'run-1', logs: [log('trained the model')] });

    renderPanel(run());

    expect(await screen.findByText(/trained the model/)).toBeInTheDocument();
    expect(screen.getAllByText('accuracy').length).toBeGreaterThan(0);
    expect(useWebSocket).toHaveBeenCalledWith(null);
    expect(screen.getByRole('link', { name: /AI advice/i })).toHaveAttribute('href', '/pipelines/run-1');
  });

  it('streams the logs of a run still in flight', () => {
    getPipelineLogs.mockClear();
    useWebSocket.mockReturnValue({ messages: [log('epoch 3/10')], status: 'connected' });

    renderPanel(run({ status: 'running', metrics: {} }));

    expect(screen.getByText(/epoch 3\/10/)).toBeInTheDocument();
    expect(useWebSocket).toHaveBeenCalledWith('ws://test/run-1');
    expect(getPipelineLogs).not.toHaveBeenCalled();
  });
});
