import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import CleaningSteps from '../../src/components/CleaningSteps';
import type { CleaningStep, CleaningSteps as Data } from '../../src/types';

const getCleaningSteps = vi.fn();

vi.mock('../../src/api/client', () => ({
  getCleaningSteps: (...args: unknown[]) => getCleaningSteps(...args),
}));

function step(overrides: Partial<CleaningStep> = {}): CleaningStep {
  return {
    rule: 'trim_whitespace',
    title: 'Whitespace normalised',
    tier: 'structural',
    cells_changed: 0,
    rows_removed: 0,
    columns_removed: 0,
    flagged: 0,
    note: '',
    columns: [],
    changed: false,
    preview_columns: ['patient_id', 'procedure_text'],
    preview_rows: [],
    changed_cells: [],
    removed_rows: [],
    ...overrides,
  };
}

const DATA: Data = {
  run_id: 'run-1',
  source_id: 3,
  rows_in: 4,
  rows_out: 3,
  sample: 8,
  steps: [
    step({
      rule: '',
      title: 'As it arrived',
      tier: '',
      changed: true,
      preview_rows: [['p1', '  Hospice  care ']],
      changed_cells: [[false, false]],
    }),
    step({
      cells_changed: 1,
      changed: true,
      columns: ['procedure_text'],
      preview_rows: [['p1', 'Hospice care']],
      changed_cells: [[false, true]],
    }),
    step({
      rule: 'deduplicate_rows',
      title: 'Exact duplicate rows removed',
      rows_removed: 1,
      changed: true,
      note: '1 row(s) were byte-for-byte repeats',
      preview_rows: [['p1', 'Hospice care']],
      changed_cells: [[false, false]],
      removed_rows: [['p1', 'Hospice care']],
    }),
    step({
      rule: 'standardise_sex',
      title: 'Sex mapped to a standard vocabulary',
      tier: 'domain',
      changed: false,
      preview_rows: [['p1', 'Hospice care']],
      changed_cells: [[false, false]],
    }),
    step({
      rule: 'flag_implausible_measurements',
      title: 'Implausible measurements flagged',
      tier: 'domain',
      flagged: 3,
      changed: true,
      preview_rows: [['p1', 'Hospice care']],
      changed_cells: [[false, false]],
    }),
  ],
};

function renderSteps(data: Data = DATA) {
  getCleaningSteps.mockResolvedValue(data);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CleaningSteps projectId={4} streams={[]} />
    </QueryClientProvider>,
  );
}

describe('CleaningSteps', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts from the data as it arrived', async () => {
    renderSteps();
    expect(await screen.findByText('As it arrived')).toBeInTheDocument();
  });

  it('shows each rule as its own step', async () => {
    renderSteps();
    expect(await screen.findByText('Whitespace normalised')).toBeInTheDocument();
    expect(screen.getByText('Exact duplicate rows removed')).toBeInTheDocument();
  });

  it('keeps a rule that found nothing to do, rather than hiding it', async () => {
    // A standard whose inapplicable parts vanish looks tailored to the data
    // rather than applied to it.
    renderSteps();
    expect(await screen.findByText('Sex mapped to a standard vocabulary')).toBeInTheDocument();
    expect(screen.getByText('nothing to do')).toBeInTheDocument();
  });

  it('opens the steps that changed something and leaves the others closed', async () => {
    renderSteps();
    const idle = await screen.findByRole('button', { name: /Sex mapped/ });
    const busy = screen.getByRole('button', { name: /Whitespace normalised/ });

    expect(busy).toHaveAttribute('aria-expanded', 'true');
    expect(idle).toHaveAttribute('aria-expanded', 'false');
  });

  it('can open a step that did nothing, to show it ran', async () => {
    renderSteps();
    const idle = await screen.findByRole('button', { name: /Sex mapped/ });
    await userEvent.click(idle);
    expect(idle).toHaveAttribute('aria-expanded', 'true');
  });

  it('marks the cell a rule changed and leaves the rest alone', async () => {
    renderSteps();
    // Scoped to the step: the same corrected value appears in every step after
    // this one, which is the point of showing the table at each stage.
    const trim = (await screen.findByText('Whitespace normalised')).closest('li')!;
    const changed = within(trim).getByText('Hospice care', { normalizer: (t) => t });
    expect(changed.closest('td')?.className).toContain('emerald');

    const untouched = within(trim).getByText('p1', { normalizer: (t) => t });
    expect(untouched.closest('td')?.className).not.toContain('emerald');
  });

  it('keeps a whitespace difference visible', async () => {
    // The change this view most often shows is two spaces becoming one, and
    // HTML collapses runs of whitespace.
    renderSteps();
    const before = await screen.findByText('  Hospice  care ', { normalizer: (t) => t });
    expect(before.closest('.whitespace-pre')).not.toBeNull();
  });

  it('shows the rows a rule removed', async () => {
    renderSteps();
    expect(await screen.findByText(/Removed this row/)).toBeInTheDocument();
  });

  it('says a flagged value was left in place, not fixed', async () => {
    renderSteps();
    expect(await screen.findByText(/3 flagged, left in place/)).toBeInTheDocument();
  });

  it('says the rules were decided over the whole extraction', async () => {
    // Otherwise a reader could reasonably think the type was inferred from the
    // eight rows they can see.
    renderSteps();
    expect(
      await screen.findByText(/decided over the whole extraction/),
    ).toBeInTheDocument();
  });

  it('invites an extraction when nothing has been through the layers', async () => {
    getCleaningSteps.mockRejectedValue(new Error('nothing yet'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <CleaningSteps projectId={4} streams={[]} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/Run an extraction/)).toBeInTheDocument();
  });
});
