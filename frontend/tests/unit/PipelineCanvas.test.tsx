import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PipelineCanvas from '../../src/pages/PipelineCanvas';
import type {
  NotebookCell,
  Pipeline,
  PipelineInputOptions,
  PipelineInputState,
  Project,
} from '../../src/types';

const api = {
  getProject: vi.fn(),
  getPipelines: vi.fn(),
  getPipeline: vi.fn(),
  getRepoNotebook: vi.fn(),
  getPipelineInput: vi.fn(),
  getPipelineInputOptions: vi.fn(),
  setPipelineInput: vi.fn(),
  triggerPipeline: vi.fn(),
  previewLayer: vi.fn(),
};

vi.mock('../../src/api/client', () => ({
  getProject: (...args: unknown[]) => api.getProject(...args),
  getPipelines: (...args: unknown[]) => api.getPipelines(...args),
  getPipeline: (...args: unknown[]) => api.getPipeline(...args),
  getRepoNotebook: (...args: unknown[]) => api.getRepoNotebook(...args),
  getPipelineInput: (...args: unknown[]) => api.getPipelineInput(...args),
  getPipelineInputOptions: (...args: unknown[]) => api.getPipelineInputOptions(...args),
  setPipelineInput: (...args: unknown[]) => api.setPipelineInput(...args),
  triggerPipeline: (...args: unknown[]) => api.triggerPipeline(...args),
  previewLayer: (...args: unknown[]) => api.previewLayer(...args),
}));

const PROJECT: Project = {
  id: 4,
  name: 'Readmissions',
  description: '',
  owner_id: 1,
  created_at: '2026-10-01T00:00:00Z',
  repository: { id: 9, github_url: 'https://github.com/acme/train', branch: 'main', notebook_path: 'train.ipynb' },
  sources: 1,
  gold_rows: 120,
};

function cell(index: number, phase: string, overrides: Partial<NotebookCell> = {}): NotebookCell {
  return {
    index,
    phase,
    tags: phase ? [`mlops:${phase}`] : [],
    source: `${phase}_code()`,
    output: '',
    error: '',
    status: 'pending',
    ...overrides,
  };
}

const BRANCH_CELLS = [
  cell(0, 'config'),
  cell(1, 'data'),
  cell(2, 'preprocessing'),
  cell(3, 'training'),
  cell(4, 'export'),
];

const OPTIONS: PipelineInputOptions = {
  bronze: [],
  silver: [{ source_id: 2, source_name: 'Hospital HIS', objects: 3, size_bytes: 2048 }],
  gold: [{ version: 2, key: 'project-4/gold/v0002.parquet', size_bytes: 4096, built_at: null, latest: true }],
};

const NO_CHOICE: PipelineInputState = { choice: {}, resolved: null, error: '' };

function pipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: 'run-1',
    repo_id: 9,
    status: 'failed',
    commit_sha: 'abc',
    branch: 'main',
    started_at: '2026-10-23T10:00:00Z',
    finished_at: '2026-10-23T10:05:00Z',
    phases: [{ name: 'dataset', status: 'success', timestamp: '', logs: '' }],
    metrics: {},
    mounted_input: { layer: 'gold', label: 'gold v2', bucket: 'gold', keys: ['project-4/gold/v0002.parquet'] },
    ...overrides,
  };
}

function renderCanvas() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/projects/4/pipeline']}>
        <Routes>
          <Route path="/projects/:projectId/pipeline" element={<PipelineCanvas />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PipelineCanvas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getProject.mockResolvedValue(PROJECT);
    api.getPipelines.mockResolvedValue({ items: [], total: 0, page: 1, size: 15 });
    api.getRepoNotebook.mockResolvedValue({ branch: 'main', notebook_path: 'train.ipynb', cells: BRANCH_CELLS });
    api.getPipelineInput.mockResolvedValue(NO_CHOICE);
    api.getPipelineInputOptions.mockResolvedValue(OPTIONS);
    api.setPipelineInput.mockResolvedValue({
      choice: { layer: 'gold' },
      resolved: { layer: 'gold', label: 'gold v2', bucket: 'gold', keys: [] },
      error: '',
    });
    api.triggerPipeline.mockResolvedValue({ status: 'queued', pipeline_id: 'run-new' });
    api.previewLayer.mockResolvedValue({
      layer: 'silver',
      key: 'project-4/source-2/run-b.parquet',
      columns: [{ name: 'patient_id', type: 'string' }, { name: 'age', type: 'integer' }],
      rows: [['p1', 44], ['p2', null]],
      object_rows: 2,
      truncated: false,
    });
  });

  it('shows the branch code as cards before anything has run', async () => {
    renderCanvas();

    const row = await screen.findByRole('list', { name: 'Pipeline' });
    await within(row).findByRole('button', { name: 'Training' });
    expect(api.getRepoNotebook).toHaveBeenCalledWith(9);
    expect(screen.getByRole('button', { name: /Code on main/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens a card to the code of its phase', async () => {
    renderCanvas();

    await userEvent.click(await screen.findByRole('button', { name: 'Preprocessing' }));

    const detail = screen.getByRole('region', { name: 'Preprocessing detail' });
    // Highlighted, so the text is split across tokens; read it whole.
    expect(within(detail).getByRole('article', { name: 'cell 3' })).toHaveTextContent('preprocessing_code()');
    expect(within(detail).getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('train.ipynb›Preprocessing');
  });

  it('chooses the input when a layer is dropped on it', async () => {
    renderCanvas();
    await screen.findByRole('button', { name: /gold · newest/ });

    fireEvent.drop(screen.getByTestId('input-drop'), {
      dataTransfer: {
        types: ['application/x-pipeline-input'],
        getData: () => JSON.stringify({ layer: 'gold' }),
      },
    });

    await waitFor(() => expect(api.setPipelineInput).toHaveBeenCalledWith(9, { layer: 'gold' }));
    const input = screen.getByRole('button', { name: 'Input' });
    expect(await within(input).findByText('gold v2')).toBeInTheDocument();
  });

  it('ignores a drop that is not a layer', async () => {
    renderCanvas();
    await screen.findByRole('button', { name: /gold · newest/ });

    fireEvent.drop(screen.getByTestId('input-drop'), {
      dataTransfer: { types: ['text/plain'], getData: () => 'some text' },
    });

    expect(api.setPipelineInput).not.toHaveBeenCalled();
  });

  it('previews a layer on click without choosing it', async () => {
    // Looking at the data must not change what the model trains on.
    renderCanvas();

    await userEvent.click(await screen.findByRole('button', { name: /silver · Hospital HIS/ }));

    const peek = await screen.findByRole('dialog', { name: 'Preview of silver · Hospital HIS' });
    expect(await within(peek).findByText('patient_id')).toBeInTheDocument();
    expect(within(peek).getByText('null')).toBeInTheDocument();
    expect(api.previewLayer).toHaveBeenCalledWith(4, 'silver', { sourceId: 2, version: undefined, limit: 25 });
    expect(api.setPipelineInput).not.toHaveBeenCalled();
  });

  it('previews the gold build that was clicked, not the newest', async () => {
    renderCanvas();

    await userEvent.click(await screen.findByRole('button', { name: /gold v2/ }));

    await waitFor(() =>
      expect(api.previewLayer).toHaveBeenCalledWith(4, 'gold', { sourceId: undefined, version: 2, limit: 25 }),
    );
  });

  it('chooses from the preview, for anyone not dragging', async () => {
    renderCanvas();
    await userEvent.click(await screen.findByRole('button', { name: /silver · Hospital HIS/ }));

    await userEvent.click(await screen.findByRole('button', { name: 'Use as input' }));

    await waitFor(() =>
      expect(api.setPipelineInput).toHaveBeenCalledWith(9, { layer: 'silver', source_id: 2 }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes the preview on Escape', async () => {
    renderCanvas();
    await userEvent.click(await screen.findByRole('button', { name: /silver · Hospital HIS/ }));
    await screen.findByRole('dialog');

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says why a choice was refused', async () => {
    api.setPipelineInput.mockRejectedValue(new Error('gold has not been built for this project yet'));
    renderCanvas();
    await userEvent.click(await screen.findByRole('button', { name: /gold · newest/ }));

    await userEvent.click(await screen.findByRole('button', { name: 'Use as input' }));

    expect(await screen.findByText(/gold has not been built/)).toBeInTheDocument();
  });

  it('starts a run and shows it', async () => {
    api.getPipeline.mockResolvedValue(pipeline({ id: 'run-new', status: 'queued', cells: [] }));
    renderCanvas();

    await userEvent.click(await screen.findByRole('button', { name: /Run pipeline/ }));

    await waitFor(() => expect(api.triggerPipeline).toHaveBeenCalledWith(9));
    await waitFor(() => expect(api.getPipeline).toHaveBeenCalledWith('run-new'));
  });

  it('will not start a second run while one is going', async () => {
    api.getPipelines.mockResolvedValue({ items: [pipeline({ status: 'running' })], total: 1, page: 1, size: 15 });
    api.getPipeline.mockResolvedValue(pipeline({ status: 'running', cells: BRANCH_CELLS }));
    renderCanvas();

    expect(await screen.findByRole('button', { name: /Running/ })).toBeDisabled();
  });

  it('shows the latest run as it left the code, failure included', async () => {
    const cells = [
      cell(0, 'config', { status: 'completed' }),
      cell(1, 'preprocessing', { status: 'failed', error: "KeyError: 'age'" }),
      cell(2, 'training'),
      cell(3, 'export'),
    ];
    api.getPipelines.mockResolvedValue({ items: [pipeline()], total: 1, page: 1, size: 15 });
    api.getPipeline.mockResolvedValue(pipeline({ cells }));
    renderCanvas();

    const training = await screen.findByRole('button', { name: 'Training' });
    expect(within(training).getByText('never ran')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: 'Preprocessing' })).getByText('failed')).toBeInTheDocument();
    // The code shown is the run's own copy, so the branch is not read.
    expect(api.getRepoNotebook).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Preprocessing' }));
    expect(screen.getByText("KeyError: 'age'")).toBeInTheDocument();
  });

  it('says what the run on screen mounted when the next run will differ', async () => {
    api.getPipelineInput.mockResolvedValue({
      choice: { layer: 'silver', source_id: 2 },
      resolved: { layer: 'silver', label: 'silver · Hospital HIS (3 objects)', bucket: 'silver', keys: [] },
      error: '',
    });
    api.getPipelines.mockResolvedValue({ items: [pipeline()], total: 1, page: 1, size: 15 });
    api.getPipeline.mockResolvedValue(pipeline({ cells: BRANCH_CELLS }));
    renderCanvas();

    const input = await screen.findByRole('button', { name: 'Input' });
    expect(await within(input).findByText('This run: gold v2')).toBeInTheDocument();
    expect(within(input).getByText('silver · Hospital HIS (3 objects)')).toBeInTheDocument();
  });

  it('points to linking a repository when there is none', async () => {
    api.getProject.mockResolvedValue({ ...PROJECT, repository: null });
    renderCanvas();

    expect(await screen.findByText(/no repository linked/)).toBeInTheDocument();
  });
});
