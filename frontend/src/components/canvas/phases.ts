import type { MountedInput, NotebookCell, Pipeline, PipelinePhase, PipelineInputChoice } from '../../types';

/**
 * How a notebook becomes the row of cards in the pipeline view.
 *
 * Kept apart from the components because this is where the view can lie: a
 * card that says "completed" for a phase that never ran, or that hides cells
 * because they carry no tag. Everything here is plain data in, plain data out,
 * so it can be pinned by tests without rendering anything.
 */

export interface PhaseDef {
  id: string;
  label: string;
  caption: string;
  /** Validation fails without it, so its absence is shown, not hidden. */
  required?: boolean;
}

/** Notebook order, which is also run order. Mirrors the backend's PHASE_TAGS. */
export const NOTEBOOK_PHASES: PhaseDef[] = [
  { id: 'setup', label: 'Setup', caption: 'Cells with no mlops tag: imports, parameters' },
  { id: 'config', label: 'Config', caption: 'MODEL_NAME and VERSION', required: true },
  { id: 'data', label: 'Data', caption: 'Reads DATASET_PATH' },
  { id: 'preprocessing', label: 'Preprocessing', caption: 'Features and splits', required: true },
  { id: 'training', label: 'Training', caption: 'Fits the model', required: true },
  { id: 'evaluation', label: 'Evaluation', caption: 'Metrics into MLflow' },
  { id: 'export', label: 'Export', caption: 'joblib.dump to MODEL_OUTPUT_PATH', required: true },
];

/**
 * - `idle`: code shown from the branch, not from a run — nothing to report.
 * - `waiting`: the run has not reached the notebook yet.
 * - `skipped`: the run ended before reaching it. Not the same as pending: it
 *   will never run in this run, and saying "pending" would suggest it might.
 * - `missing`: a required phase with no cells. The run will fail validation.
 */
export type CardStatus =
  | 'idle'
  | 'waiting'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'missing';

export interface PhaseCard extends PhaseDef {
  cells: NotebookCell[];
  status: CardStatus;
}

const FINISHED = new Set(['success', 'failed']);

/** The newest entry for each phase name. A phase logs running, then its outcome. */
export function latestPhases(phases: PipelinePhase[]): Record<string, PipelinePhase> {
  const latest: Record<string, PipelinePhase> = {};
  for (const phase of phases) latest[phase.name] = phase;
  return latest;
}

function statusOf(cells: NotebookCell[], run: Pipeline | undefined): CardStatus {
  if (!run) return 'idle';
  if (cells.some((cell) => cell.status === 'failed')) return 'failed';
  if (cells.some((cell) => cell.status === 'running')) return 'running';
  if (cells.length > 0 && cells.every((cell) => cell.status === 'completed')) return 'completed';

  // Nothing in the cells says how far the run got: papermill only reports per
  // cell once the notebook has finished. The run's own phases say the rest.
  const execute = latestPhases(run.phases).execute;
  if (FINISHED.has(run.status)) return 'skipped';
  if (execute?.status === 'running') return 'running';
  return 'waiting';
}

/**
 * The cards for a notebook. `run` is the run the cells came from, or
 * undefined when they came from the branch and nothing has executed them.
 *
 * Untagged cells are gathered into Setup rather than dropped: they run, and a
 * view that hid them would show less code than the notebook executes.
 */
export function phaseCards(cells: NotebookCell[], run?: Pipeline): PhaseCard[] {
  return NOTEBOOK_PHASES.flatMap((def) => {
    const mine = cells.filter((cell) => (cell.phase || 'setup') === def.id);
    if (mine.length === 0) {
      return def.required ? [{ ...def, cells: mine, status: 'missing' as const }] : [];
    }
    return [{ ...def, cells: mine, status: statusOf(mine, run) }];
  });
}

/** What travels in a drag from the palette to the input card. */
export const INPUT_DRAG_TYPE = 'application/x-pipeline-input';

export function encodeChoice(choice: PipelineInputChoice): string {
  return JSON.stringify(choice);
}

/** Null for anything that is not a choice, so a stray drop does nothing. */
export function decodeChoice(raw: string): PipelineInputChoice | null {
  try {
    const value = JSON.parse(raw) as PipelineInputChoice;
    if (value && typeof value === 'object' && ['', 'bronze', 'silver', 'gold'].includes(value.layer ?? '')) {
      return value;
    }
  } catch {
    // fall through
  }
  return null;
}

/** Whether two choices name the same thing, to mark the palette entry in use. */
export function sameChoice(a: PipelineInputChoice, b: PipelineInputChoice): boolean {
  return (
    (a.layer ?? '') === (b.layer ?? '') &&
    (a.source_id ?? null) === (b.source_id ?? null) &&
    (a.version ?? null) === (b.version ?? null)
  );
}

/** What a run mounted, if it recorded it. Runs from before the record have `{}`. */
export function mountedOf(run: Pipeline | undefined): MountedInput | undefined {
  const input = run?.mounted_input as Partial<MountedInput> | undefined;
  return input?.label ? (input as MountedInput) : undefined;
}
