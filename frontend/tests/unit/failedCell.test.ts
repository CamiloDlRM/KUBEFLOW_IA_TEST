import { describe, expect, it } from 'vitest';
import { failedCell } from '../../src/components/notebook/failedCell';
import type { EditorCell, NotebookCell } from '../../src/types';

const editor = (cells: [EditorCell['cell_type'], string][]): EditorCell[] =>
  cells.map(([cell_type, source], index) => ({ index, cell_type, source, tags: [] }));

const ran = (cells: Partial<NotebookCell>[]): NotebookCell[] =>
  cells.map((cell, index) => ({
    index,
    phase: '',
    tags: [],
    source: '',
    output: '',
    error: '',
    status: 'completed',
    ...cell,
  }));

describe('failedCell', () => {
  it('finds the failed code cell past the markdown cells the run does not count', () => {
    const cells = editor([
      ['markdown', '# Title'],
      ['code', 'import pandas'],
      ['markdown', 'Train'],
      ['code', 'model.fit(X)\n'],
    ]);
    const run = ran([{ source: 'import pandas' }, { source: 'model.fit(X)', status: 'failed', error: 'NameError: X' }]);

    expect(failedCell(cells, run)).toEqual({ index: 3, error: 'NameError: X', stale: false });
  });

  it('says so when the branch no longer has the code that ran', () => {
    const cells = editor([['code', 'model.fit(X_train)']]);
    const run = ran([{ source: 'model.fit(X)', status: 'failed', error: 'NameError: X' }]);

    expect(failedCell(cells, run)?.stale).toBe(true);
  });

  it('is null when no cell failed, the run kept no cells, or the cell is gone', () => {
    const cells = editor([['code', 'a = 1']]);

    expect(failedCell(cells, ran([{ source: 'a = 1' }]))).toBeNull();
    expect(failedCell(cells, undefined)).toBeNull();
    expect(failedCell(cells, ran([{}, { status: 'failed', error: 'boom' }]))).toBeNull();
  });
});
