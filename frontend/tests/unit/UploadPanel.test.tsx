import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UploadPanel from '../../src/components/UploadPanel';
import type { UploadStatus } from '../../src/types';

const getUploads = vi.fn();
const uploadDataset = vi.fn();

vi.mock('../../src/api/client', () => ({
  getUploads: (...args: unknown[]) => getUploads(...args),
  uploadDataset: (...args: unknown[]) => uploadDataset(...args),
}));

function status(overrides: Partial<UploadStatus>): UploadStatus {
  return {
    dataset_id: 1,
    name: 'admissions.csv',
    size_bytes: 30_825,
    created_at: '2026-11-09T10:00:00Z',
    status: 'queued',
    error: '',
    rows_in: null,
    rows_kept: null,
    source_id: null,
    source_name: '',
    ...overrides,
  };
}

function renderPanel(onOpenStage = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <UploadPanel projectId={4} onOpenStage={onOpenStage} />
    </QueryClientProvider>,
  );
  return { invalidate, onOpenStage };
}

describe('UploadPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUploads.mockResolvedValue([]);
  });
  afterEach(() => vi.useRealTimers());

  it('shows each upload with how far it has got through the layers', async () => {
    getUploads.mockResolvedValue([
      status({ dataset_id: 4, name: 'new.csv', status: 'queued' }),
      status({ dataset_id: 3, name: 'cleaning.csv', status: 'running' }),
      status({ dataset_id: 2, name: 'done.csv', status: 'success', rows_in: 800, rows_kept: 798, source_name: 'done' }),
      status({ dataset_id: 1, name: 'broken.xlsx', status: 'failed', error: 'the file contained no rows' }),
    ]);
    renderPanel();

    const list = await screen.findByRole('region', { name: 'Your uploads' });
    const row = (name: string) => within(list).getByText(name).closest('li')!;
    expect(within(row('new.csv')).getByText('Waiting for the worker')).toBeInTheDocument();
    expect(within(row('cleaning.csv')).getByText(/Cleaning into the layers/)).toBeInTheDocument();
    expect(row('done.csv')).toHaveTextContent('800 rows in bronze, 798 kept in silver as done, and gold rebuilt.');
    expect(row('broken.xlsx')).toHaveTextContent('Could not be cleaned into the layers: the file contained no rows');
  });

  it('opens the layer an upload landed in', async () => {
    getUploads.mockResolvedValue([status({ status: 'success', rows_in: 10, rows_kept: 10 })]);
    const { onOpenStage } = renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'View silver' }));

    expect(onOpenStage).toHaveBeenCalledWith('silver');
  });

  it('shows nothing extra before anything has been uploaded', async () => {
    renderPanel();

    await waitFor(() => expect(getUploads).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: 'Your uploads' })).not.toBeInTheDocument();
  });

  it('lists a new upload right after it is sent', async () => {
    uploadDataset.mockResolvedValue({});
    renderPanel();
    await waitFor(() => expect(getUploads).toHaveBeenCalledTimes(1));
    getUploads.mockResolvedValue([status({ status: 'queued' })]);

    await userEvent.upload(screen.getByLabelText('Dataset file'), new File(['a,b\n1,2\n'], 'admissions.csv'));
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }));

    expect(await screen.findByText('Waiting for the worker')).toBeInTheDocument();
    expect(screen.getByText(/follow it below/)).toBeInTheDocument();
  });

  it('refreshes the layers on the page when an upload finishes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getUploads.mockResolvedValue([status({ status: 'running' })]);
    const { invalidate } = renderPanel();
    await screen.findByText(/Cleaning into the layers/);

    getUploads.mockResolvedValue([status({ status: 'success', rows_in: 5, rows_kept: 5 })]);
    await vi.advanceTimersByTimeAsync(3_500);

    await screen.findByText('In the layers');
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['medallion', 4] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['project', 4] });
  });
});
