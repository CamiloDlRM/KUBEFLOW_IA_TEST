import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VersionsDialog from '../../src/components/models/VersionsDialog';
import type { ModelVersion } from '../../src/types';

const getModelVersions = vi.fn();
const serveModelVersion = vi.fn();

vi.mock('../../src/api/client', () => ({
  getModelVersions: (...args: unknown[]) => getModelVersions(...args),
  serveModelVersion: (...args: unknown[]) => serveModelVersion(...args),
}));

function version(overrides: Partial<ModelVersion>): ModelVersion {
  return {
    version: '1',
    pipeline_id: 'run-1',
    mlflow_run_id: 'mlflow-1',
    trained_at: '2026-11-01T10:00:00Z',
    metrics: { accuracy: 0.9, f1_weighted: 0.88 },
    accuracy: 0.9,
    branch: 'main',
    commit_sha: 'abcdef1234',
    input_label: 'gold v1',
    deployed_at: null,
    is_active: false,
    deployable: true,
    ...overrides,
  };
}

const VERSIONS = [
  version({ version: '3', pipeline_id: 'run-3', metrics: { accuracy: 0.79 }, accuracy: 0.79 }),
  version({ version: '2', pipeline_id: 'run-2', is_active: true, deployed_at: '2026-11-02T10:00:00Z', metrics: { accuracy: 0.88 } }),
  version({ version: '1', pipeline_id: 'run-1', deployed_at: '2026-11-01T11:00:00Z', metrics: { accuracy: 0.91 } }),
];

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <VersionsDialog modelName="encounters" onClose={() => {}} />
    </QueryClientProvider>,
  );
}

function row(name: RegExp) {
  return screen.getAllByRole('row').find((r) => name.test(r.textContent ?? ''))!;
}

describe('VersionsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getModelVersions.mockResolvedValue(VERSIONS);
    serveModelVersion.mockResolvedValue({ message: 'encounters is now serving version 3.' });
  });

  it('lists every version with what it scored and whether it served', async () => {
    renderDialog();

    await screen.findByText('v3');
    expect(screen.getByText(/Serving v2/)).toBeInTheDocument();
    expect(within(row(/^v3/)).getByText('never served')).toBeInTheDocument();
    expect(within(row(/^v2/)).getByText('serving')).toBeInTheDocument();
    expect(within(row(/^v1/)).getByText('0.9100')).toBeInTheDocument();
  });

  it('calls going to an older version a rollback, and a never-served one a deploy', async () => {
    renderDialog();
    await screen.findByText('v3');

    expect(within(row(/^v1/)).getByRole('button', { name: 'Roll back to this' })).toBeInTheDocument();
    expect(within(row(/^v3/)).getByRole('button', { name: 'Deploy this' })).toBeInTheDocument();
    expect(within(row(/^v2/)).queryByRole('button')).not.toBeInTheDocument();
  });

  it('switches only after a confirmation on the same row', async () => {
    renderDialog();
    await screen.findByText('v3');

    await userEvent.click(within(row(/^v3/)).getByRole('button', { name: 'Deploy this' }));
    expect(serveModelVersion).not.toHaveBeenCalled();

    await userEvent.click(within(row(/^v3/)).getByRole('button', { name: 'Serve v3' }));

    await waitFor(() => expect(serveModelVersion).toHaveBeenCalledWith('encounters', 'run-3'));
    expect(await screen.findByText('encounters is now serving version 3.')).toBeInTheDocument();
  });

  it('says why a switch failed', async () => {
    serveModelVersion.mockRejectedValue(new Error('Failed to reload model: model server down'));
    renderDialog();
    await screen.findByText('v3');

    await userEvent.click(within(row(/^v1/)).getByRole('button', { name: 'Roll back to this' }));
    await userEvent.click(within(row(/^v1/)).getByRole('button', { name: 'Serve v1' }));

    expect(await screen.findByText(/model server down/)).toBeInTheDocument();
  });

  it('does not offer a version whose artifact cannot be found', async () => {
    getModelVersions.mockResolvedValue([version({ version: '1', deployable: false })]);
    renderDialog();

    expect(await screen.findByText('unavailable')).toBeInTheDocument();
    expect(within(row(/^v1/)).queryByRole('button')).not.toBeInTheDocument();
  });
});
