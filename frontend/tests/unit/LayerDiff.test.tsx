import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import LayerDiff from '../../src/components/LayerDiff';
import type { LayerDiff as LayerDiffData } from '../../src/types';

const getLayerDiff = vi.fn();

vi.mock('../../src/api/client', () => ({
  getLayerDiff: (...args: unknown[]) => getLayerDiff(...args),
}));

const DIFF: LayerDiffData = {
  run_id: 'run-1',
  source_id: 3,
  key: 'project-4/source-3/run-1.parquet',
  bronze_rows: 4,
  silver_rows: 3,
  approximate: false,
  columns: [
    {
      bronze: 'Procedure Text',
      silver: 'procedure_text',
      bronze_type: 'string',
      silver_type: 'string',
      change: 'renamed',
    },
    { bronze: 'Edad', silver: 'edad', bronze_type: 'string', silver_type: 'int64', change: 'renamed' },
    { bronze: 'Notes', silver: null, bronze_type: 'string', silver_type: '', change: 'dropped' },
    {
      bronze: null,
      silver: 'procedure_code_method',
      bronze_type: '',
      silver_type: 'string',
      change: 'added',
    },
  ],
  rows: [
    {
      row: 0,
      bronze: ['  Hospice  care ', '44', null, null],
      silver: ['Hospice care', 44, null, 'source'],
      cells: ['value', 'type', 'absent', 'value'],
      removed: false,
    },
    {
      row: 1,
      bronze: ['Colonoscopy', 'N/A', null, null],
      silver: ['Colonoscopy', null, null, 'cascade:exact'],
      cells: ['same', 'null', 'absent', 'value'],
      removed: false,
    },
    {
      row: 2,
      bronze: ['  Hospice  care ', '44', null, null],
      silver: [],
      cells: ['absent', 'absent', 'absent', 'absent'],
      removed: true,
    },
  ],
};

function renderDiff(data: LayerDiffData = DIFF) {
  getLayerDiff.mockResolvedValue(data);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LayerDiff repoId={4} streams={[]} />
    </QueryClientProvider>,
  );
}

describe('LayerDiff', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows both sides of a corrected value', async () => {
    renderDiff();
    // Whitespace-exact on both sides: the correction this view most often
    // shows is two spaces becoming one, which plain rendering would collapse.
    // Two matches on purpose: the duplicate row shows the same bronze value.
    const before = await screen.findAllByText('  Hospice  care ', { normalizer: (t) => t });
    expect(before).toHaveLength(2);
    expect(before[0].closest('.whitespace-pre')).not.toBeNull();
    expect(screen.getByText('Hospice care', { normalizer: (t) => t })).toBeInTheDocument();
  });

  it('marks a cast as a type change rather than as unchanged', async () => {
    // "44" and 44 are the same glyphs. Calling that unchanged would hide the
    // most common thing the cleaning does; calling it a value change would be
    // a lie about the text.
    renderDiff();
    const cell = await screen.findByTitle('string → int64');
    expect(cell.className).toContain('sky');
  });

  it('shows a placeholder that became null as null', async () => {
    renderDiff();
    expect(await screen.findByTitle(/meant "no value"/)).toBeInTheDocument();
    expect(screen.getAllByText('null').length).toBeGreaterThan(0);
  });

  it('shows a removed row with no counterpart', async () => {
    renderDiff();
    expect(await screen.findByText('−2')).toBeInTheDocument();
  });

  it('shows a renamed column under both of its names', async () => {
    renderDiff();
    expect(await screen.findByText('Procedure Text')).toBeInTheDocument();
    expect(screen.getByText('procedure_text')).toBeInTheDocument();
  });

  it('says a dropped column was dropped and why', async () => {
    renderDiff();
    expect(await screen.findByText(/dropped — empty/)).toBeInTheDocument();
  });

  it('says an added column was added', async () => {
    renderDiff();
    expect(await screen.findByText(/added — string/)).toBeInTheDocument();
  });

  it('shows the type on each side of a column that was cast', async () => {
    renderDiff();
    expect(await screen.findByText('int64')).toBeInTheDocument();
  });

  it('reports the row count of both objects', async () => {
    renderDiff();
    expect(await screen.findByText(/4 rows in bronze, 3 in silver/)).toBeInTheDocument();
  });

  it('says when the pairing could not be made exact', async () => {
    renderDiff({ ...DIFF, approximate: true });
    expect(await screen.findByText(/matched by position/)).toBeInTheDocument();
  });

  it('does not claim an approximate pairing when it is exact', async () => {
    renderDiff();
    await screen.findByText(/4 rows in bronze/);
    expect(screen.queryByText(/matched by position/)).not.toBeInTheDocument();
  });

  it('invites an extraction when nothing has been through the layers', async () => {
    getLayerDiff.mockRejectedValue(new Error('nothing yet'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <LayerDiff repoId={4} streams={[]} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/Run an extraction/)).toBeInTheDocument();
  });
});
