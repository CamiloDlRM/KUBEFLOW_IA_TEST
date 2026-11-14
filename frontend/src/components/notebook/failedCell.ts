import type { EditorCell, NotebookCell } from '../../types';

export interface CellFailure {
  /** The cell's index in the editor, which is its place in the file. */
  index: number;
  error: string;
  /** The code in the editor is no longer what the run executed. */
  stale: boolean;
}

/**
 * The cell a failed run broke on, as a cell of the editor.
 *
 * A run numbers only its code cells and leaves out papermill's injected one;
 * the editor numbers every cell of the file, markdown included. So the run's
 * cell k is the file's k-th code cell.
 */
export function failedCell(editorCells: EditorCell[], runCells: NotebookCell[] | undefined): CellFailure | null {
  const failed = runCells?.find((cell) => cell.status === 'failed' || cell.error);
  if (!failed) return null;
  const code = editorCells.filter(
    (cell) => cell.cell_type === 'code' && !cell.tags.includes('injected-parameters'),
  );
  const target = code[failed.index];
  if (!target) return null;
  return {
    index: target.index,
    error: failed.error,
    // shortcut: a run keeps a cell's first 20,000 characters, so a longer cell always reads as changed.
    stale: target.source.trimEnd() !== failed.source.trimEnd(),
  };
}
