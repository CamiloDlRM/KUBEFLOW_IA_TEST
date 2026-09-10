import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import Datasets from '../../src/pages/Datasets';
import type { Dataset } from '../../src/types';

const mockDataset: Dataset = {
  id: 7,
  repo_id: 1,
  name: 'iris.csv',
  description: 'Iris training set',
  bucket: 'datasets',
  object_key: 'repo-1/iris.csv',
  content_type: 'text/csv',
  size_bytes: 2048,
  checksum: 'abc',
  uploaded_by: 'tester',
  created_at: '2026-02-23T10:00:00Z',
  is_active: true,
};

const getDatasets = vi.fn();
const getDatasetPreview = vi.fn();
const uploadDataset = vi.fn();

vi.mock('../../src/api/client', () => ({
  getDatasets: (...a: unknown[]) => getDatasets(...a),
  getDatasetPreview: (...a: unknown[]) => getDatasetPreview(...a),
  uploadDataset: (...a: unknown[]) => uploadDataset(...a),
  activateDataset: vi.fn(),
  deleteDataset: vi.fn(),
  getRepos: vi.fn().mockResolvedValue([
    { id: 1, github_url: 'https://github.com/testuser/ml-project' },
  ]),
  getPipelines: vi.fn(),
  getPipeline: vi.fn(),
  getReady: vi.fn(),
  getPipelineLogs: vi.fn(),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/repos/1/datasets']}>
        <Routes>
          <Route path="/repos/:repoId/datasets" element={<Datasets />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Datasets page', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders repo name, upload zone and dataset row', async () => {
    getDatasets.mockResolvedValue([mockDataset]);
    renderPage();

    expect(screen.getByText('Datasets')).toBeInTheDocument();
    expect(await screen.findByText('testuser/ml-project')).toBeInTheDocument();
    expect(await screen.findByText('iris.csv')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(screen.getByText('Activo')).toBeInTheDocument();
    expect(screen.getByLabelText('Dataset file')).toBeInTheDocument();
    // active dataset cannot be re-activated
    expect(screen.getByText('Activate')).toBeDisabled();
  });

  it('shows empty state', async () => {
    getDatasets.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/No datasets uploaded yet/)).toBeInTheDocument();
  });

  it('shows error state', async () => {
    getDatasets.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByText(/Failed to load datasets: boom/)).toBeInTheDocument();
  });

  it('opens preview modal with columns and rows', async () => {
    getDatasets.mockResolvedValue([mockDataset]);
    getDatasetPreview.mockResolvedValue({
      dataset_id: 7,
      columns: ['sepal_length', 'species'],
      rows: [[5.1, 'setosa']],
      truncated: true,
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByText('Preview'));
    expect(await screen.findByText('sepal_length')).toBeInTheDocument();
    expect(screen.getByText('setosa')).toBeInTheDocument();
    expect(getDatasetPreview).toHaveBeenCalledWith(7);
  });

  it('uploads a selected file with description', async () => {
    getDatasets.mockResolvedValue([]);
    uploadDataset.mockResolvedValue(mockDataset);
    const user = userEvent.setup();
    renderPage();

    const file = new File(['a,b\n1,2'], 'data.csv', { type: 'text/csv' });
    await user.upload(screen.getByLabelText('Dataset file'), file);
    await user.type(screen.getByLabelText(/Description/), 'hello');
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    expect(uploadDataset).toHaveBeenCalledWith(1, file, 'hello');
  });
});
