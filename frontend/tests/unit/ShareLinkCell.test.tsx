import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import ShareLinkCell from '../../src/components/models/ShareLinkCell';
import type { ModelDeployment } from '../../src/types';

const setModelShare = vi.fn().mockResolvedValue({});
const rotateModelShare = vi.fn().mockResolvedValue({});
vi.mock('../../src/api/client', () => ({
  setModelShare: (...args: unknown[]) => setModelShare(...args),
  rotateModelShare: (...args: unknown[]) => rotateModelShare(...args),
}));

function model(overrides: Partial<ModelDeployment> = {}): ModelDeployment {
  return {
    model_name: 'iris',
    version: '3',
    accuracy: 0.95,
    endpoint_url: 'http://model-server:8001/predict/iris',
    deployed_at: '2026-11-01T00:00:00Z',
    is_active: true,
    pipeline_id: 'run-1',
    owner_username: null,
    share_url: null,
    ...overrides,
  };
}

function renderCell(m: ModelDeployment) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ShareLinkCell model={m} />
    </QueryClientProvider>,
  );
}

describe('ShareLinkCell', () => {
  it('offers to share a model that is not shared', async () => {
    renderCell(model());

    await userEvent.click(screen.getByRole('button', { name: 'Share' }));

    await waitFor(() => expect(setModelShare).toHaveBeenCalledWith('iris', true));
  });

  it('shows the public link of a shared model, never the internal one', () => {
    renderCell(model({ share_url: 'http://localhost:8000/public/predict/abc123' }));

    expect(screen.getByText('http://localhost:8000/public/predict/abc123')).toBeInTheDocument();
    expect(screen.queryByText(/model-server:8001/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy public link' })).toBeInTheDocument();
  });

  it('stops sharing, and replaces the link only once confirmed', async () => {
    renderCell(model({ share_url: 'http://localhost:8000/public/predict/abc123' }));

    await userEvent.click(screen.getByRole('button', { name: /stop/i }));
    await waitFor(() => expect(setModelShare).toHaveBeenCalledWith('iris', false));

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    await userEvent.click(screen.getByRole('button', { name: /new link/i }));
    expect(rotateModelShare).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /new link/i }));
    await waitFor(() => expect(rotateModelShare).toHaveBeenCalledWith('iris'));
    confirm.mockRestore();
  });
});
