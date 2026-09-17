import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import CleaningSteps from '../../src/components/CleaningSteps';
import type {
  CleaningColumn,
  CleaningRow,
  CleaningStep,
  CleaningSteps as Data,
} from '../../src/types';

const getCleaningSteps = vi.fn();

vi.mock('../../src/api/client', () => ({
  getCleaningSteps: (...args: unknown[]) => getCleaningSteps(...args),
}));

const COLUMNS: CleaningColumn[] = [
  { before: 'patient_id', after: 'patient_id', change: 'same' },
  { before: 'procedure_text', after: 'procedure_text', change: 'same' },
];

function row(overrides: Partial<CleaningRow> = {}): CleaningRow {
  return {
    row: 0,
    before: ['p1', 'Hospice care'],
    after: ['p1', 'Hospice care'],
    cells: ['same', 'same'],
    removed: false,
    ...overrides,
  };
}

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
    preview_columns: COLUMNS,
    preview_rows: [row()],
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
      preview_columns: [
        { before: null, after: 'Patient ID', change: 'same' },
        { before: null, after: 'Procedure Text', change: 'same' },
      ],
      preview_rows: [row({ before: [], after: ['p1', '  Hospice  care '] })],
    }),
    step({
      rule: 'normalise_column_names',
      title: 'Column names standardised',
      changed: true,
      columns: ['patient_id'],
      preview_columns: [
        { before: 'Patient ID', after: 'patient_id', change: 'renamed' },
        { before: 'Procedure Text', after: 'procedure_text', change: 'renamed' },
      ],
      preview_rows: [row({ before: ['p1', '  Hospice  care '], after: ['p1', '  Hospice  care '] })],
    }),
    step({
      cells_changed: 1,
      changed: true,
      columns: ['procedure_text'],
      preview_rows: [
        row({
          before: ['p1', '  Hospice  care '],
          after: ['p1', 'Hospice care'],
          cells: ['same', 'changed'],
        }),
      ],
    }),
    step({
      rule: 'drop_empty_columns',
      title: 'Empty columns removed',
      columns_removed: 1,
      changed: true,
      preview_columns: [...COLUMNS, { before: 'notes', after: null, change: 'dropped' }],
      preview_rows: [
        row({ before: ['p1', 'Hospice care', null], after: ['p1', 'Hospice care', null], cells: ['same', 'same', 'absent'] }),
      ],
    }),
    step({
      rule: 'cast_types',
      title: 'Types inferred and applied',
      changed: true,
      preview_rows: [
        row({ before: ['p1', '44'], after: ['p1', 44], cells: ['same', 'changed'] }),
      ],
    }),
    step({
      rule: 'deduplicate_rows',
      title: 'Exact duplicate rows removed',
      rows_removed: 1,
      changed: true,
      note: '1 row(s) were byte-for-byte repeats',
      preview_rows: [row(), row({ row: 2, after: [], removed: true })],
    }),
    step({
      rule: 'standardise_sex',
      title: 'Sex mapped to a standard vocabulary',
      tier: 'domain',
      changed: false,
    }),
    step({
      rule: 'flag_implausible_measurements',
      title: 'Implausible measurements flagged',
      tier: 'domain',
      flagged: 3,
      changed: true,
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

/** The card for one rule, so a value is read from the step that produced it. */
async function card(title: string) {
  return (await screen.findByText(title)).closest('li')!;
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

  it('shows the value a rule replaced next to the one it wrote', async () => {
    // The whole point of folding the old row-by-row diff in here: a tinted
    // "Hospice care" is not evidence of anything until the reader can see the
    // "  Hospice  care " it replaced.
    renderSteps();
    const trim = await card('Whitespace normalised');

    expect(within(trim).getByText('  Hospice  care ', { normalizer: (t) => t })).toBeInTheDocument();
    expect(within(trim).getByText('Hospice care', { normalizer: (t) => t })).toBeInTheDocument();
  });

  it('marks the cell a rule changed and leaves the rest alone', async () => {
    renderSteps();
    const trim = await card('Whitespace normalised');
    const changed = within(trim).getByText('Hospice care', { normalizer: (t) => t });
    expect(changed.closest('td')?.className).toContain('emerald');

    const untouched = within(trim).getAllByText('p1', { normalizer: (t) => t })[0];
    expect(untouched.closest('td')?.className).not.toContain('emerald');
  });

  it('keeps a whitespace difference visible', async () => {
    // The change this view most often shows is two spaces becoming one, and
    // HTML collapses runs of whitespace.
    renderSteps();
    const before = (await screen.findAllByText('  Hospice  care ', { normalizer: (t) => t }))[0];
    expect(before.closest('.whitespace-pre')).not.toBeNull();
  });

  it('gives a cast its own colour, because the glyphs did not move', async () => {
    renderSteps();
    const cast = await card('Types inferred and applied');
    // Scoped to the "+" line: "44" and the quoted "44" it replaced are the
    // same two glyphs, which is exactly why the cast needs its own colour.
    const written = within(cast).getByText('+0').closest('tr')!;

    expect(within(written).getByText('44').closest('td')?.className).toContain('sky');
    expect(within(cast).getByText('−0')).toBeInTheDocument();
  });

  it('names both sides of a renamed column and marks no cell', async () => {
    // Keyed by name rather than by identity, every cell of a renamed column
    // reads as a value that appeared from nowhere — which would make the
    // loudest step of the standard the one that touches no data at all.
    renderSteps();
    const renamed = await card('Column names standardised');

    expect(within(renamed).getByText('Patient ID')).toBeInTheDocument();
    expect(within(renamed).getByText('patient_id')).toBeInTheDocument();
    expect(within(renamed).queryByText('−0'), 'no before/after pair').toBeNull();
  });

  it('strikes a dropped column from the header, once', async () => {
    renderSteps();
    const dropped = await card('Empty columns removed');

    expect(within(dropped).getByText('notes').className).toContain('line-through');
    expect(within(dropped).getByText('dropped')).toBeInTheDocument();
  });

  it('shows the row a rule removed, with no counterpart', async () => {
    renderSteps();
    const dedupe = await card('Exact duplicate rows removed');
    const gutter = within(dedupe).getByText('−2');

    expect(gutter.closest('tr')?.className).toContain('rose');
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

  it('names the two layers the standard runs between', async () => {
    // The section this replaced was the one that said "bronze" and "silver".
    renderSteps();
    expect(await screen.findByText('bronze')).toBeInTheDocument();
    expect(screen.getByText('silver')).toBeInTheDocument();
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
