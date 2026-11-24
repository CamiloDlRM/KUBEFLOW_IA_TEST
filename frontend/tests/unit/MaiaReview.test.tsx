import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MaiaReview from '../../src/components/notebook/MaiaReview';
import type { EditorCell } from '../../src/types';

const reviewRepoNotebook = vi.fn();
vi.mock('../../src/api/client', () => ({
  reviewRepoNotebook: (...args: unknown[]) => reviewRepoNotebook(...args),
}));

const cells: EditorCell[] = [
  { index: 0, cell_type: 'markdown', source: '# Title', tags: [] },
  { index: 1, cell_type: 'code', source: 'model.fit(X)', tags: ['mlops:training'] },
];
const failure = { index: 1, error: 'NameError: X', stale: false };

function renderMaia(props: Partial<Parameters<typeof MaiaReview>[0]> = {}) {
  const onApply = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MaiaReview repoId={7} cells={cells} selected={1} failure={failure} onApply={onApply} {...props} />
    </QueryClientProvider>,
  );
  return onApply;
}

describe('MaiaReview', () => {
  beforeEach(() => {
    reviewRepoNotebook.mockReset();
    reviewRepoNotebook.mockResolvedValue({
      comment: 'X is not defined.',
      cells: [{ index: 1, source: 'model.fit(X_train)' }],
    });
  });

  it('reviews the selected cell with the error it raised, and applies her proposal as an edit', async () => {
    const user = userEvent.setup();
    const onApply = renderMaia();

    await user.click(screen.getByRole('button', { name: /ask maia/i }));
    await user.click(screen.getByRole('button', { name: 'Review cell [2]' }));

    expect(reviewRepoNotebook).toHaveBeenCalledWith(7, { cells, focus_index: 1, error: 'NameError: X' });
    expect(await screen.findByText('X is not defined.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Apply to cell [2]' }));

    expect(onApply).toHaveBeenCalledWith(1, 'model.fit(X_train)');
    expect(screen.getByRole('button', { name: /applied/i })).toBeDisabled();
  });

  it('reviews the whole notebook, without the error, when asked to', async () => {
    const user = userEvent.setup();
    renderMaia({ selected: null });

    await user.click(screen.getByRole('button', { name: /ask maia/i }));
    expect(screen.queryByRole('button', { name: /review cell/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review the whole notebook' }));

    expect(reviewRepoNotebook).toHaveBeenCalledWith(7, { cells, focus_index: null, error: '' });
  });
});
