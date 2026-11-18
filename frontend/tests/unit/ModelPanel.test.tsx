import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ModelPanel, type NodePanelContext } from '../../src/components/flow/NodePanelContent';
import type { PipelineView } from '../../src/components/flow/usePipelineView';
import type { Pipeline } from '../../src/types';

const getPipelineLogs = vi.fn();
const useWebSocket = vi.fn();
const openMaia = vi.fn();

vi.mock('../../src/api/client', () => ({
  getPipelineLogs: (...args: unknown[]) => getPipelineLogs(...args),
  getWsUrl: (id: string) => `ws://test/${id}`,
  getPipelineInput: vi.fn(),
  getPipelineInputOptions: vi.fn(),
  getModels: () => Promise.resolve([]),
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
  const context = { projectId: 4, chooseInput: {} as NodePanelContext['chooseInput'], view, openMaia };
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
  it("shows a finished run's register and deploy logs from its saved phases, however old", () => {
    getPipelineLogs.mockClear();
    useWebSocket.mockReturnValue({ messages: [], status: 'disconnected' });

    renderPanel(
      run({
        phases: [
          { name: 'download', status: 'success', timestamp: '2026-10-01T00:00:10Z', logs: 'Notebook downloaded' },
          { name: 'register', status: 'success', timestamp: '2026-10-01T00:04:00Z', logs: 'Model registered in MLflow run abc123. Accuracy: 0.9100' },
          { name: 'deploy', status: 'success', timestamp: '2026-10-01T00:04:30Z', logs: 'Model deployed successfully. Endpoint: http://model-server:8001/predict/m' },
        ],
      }),
    );

    expect(screen.getByText(/Model registered in MLflow run abc123/)).toBeInTheDocument();
    expect(screen.getByText(/Model deployed successfully/)).toBeInTheDocument();
    // Download belongs to Input, not here.
    expect(screen.queryByText('Notebook downloaded')).not.toBeInTheDocument();
    // Redis's copy expires after a day; the panel no longer depends on it.
    expect(getPipelineLogs).not.toHaveBeenCalled();
    expect(useWebSocket).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByRole('button', { name: /Ask Maia about this run/i }));
    expect(openMaia).toHaveBeenCalled();
  });

  it('adds what the WebSocket streams after the last saved phase', () => {
    useWebSocket.mockReturnValue({
      messages: [
        log('Registering model artifact in MLflow...', 'register'),
        { ...log('Deploying model to model server...', 'deploy'), timestamp: '2026-10-01T00:05:00Z' },
      ],
      status: 'connected',
    });

    renderPanel(
      run({
        status: 'running',
        metrics: {},
        phases: [{ name: 'register', status: 'running', timestamp: '2026-10-01T00:04:00Z', logs: 'Registering model artifact in MLflow...' }],
      }),
    );

    expect(useWebSocket).toHaveBeenCalledWith('ws://test/run-1');
    // Saved once, not again from the stream.
    expect(screen.getAllByText(/Registering model artifact/)).toHaveLength(1);
    expect(screen.getByText(/Deploying model to model server/)).toBeInTheDocument();
  });
});
