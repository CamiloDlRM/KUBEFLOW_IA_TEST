import type { PhaseStatus } from '../../types';
import type { CardStatus } from './phases';

/** How a phase's status reads: shared by the canvas nodes and the code panel. */
export const STATUS_STYLES: Record<CardStatus, { border: string; dot: string; label: string }> = {
  idle: { border: 'border-slate-700', dot: 'bg-slate-600', label: 'not run' },
  waiting: { border: 'border-dashed border-slate-700', dot: 'bg-slate-600', label: 'waiting' },
  running: { border: 'border-blue-500/70', dot: 'bg-blue-400 animate-pulse', label: 'running' },
  completed: { border: 'border-emerald-600/70', dot: 'bg-emerald-400', label: 'completed' },
  failed: { border: 'border-red-600/80', dot: 'bg-red-400', label: 'failed' },
  skipped: { border: 'border-slate-800', dot: 'bg-slate-700', label: 'never ran' },
  missing: { border: 'border-dashed border-red-700/70', dot: 'bg-red-500', label: 'no cells' },
};

/** A run phase's status in the cards' vocabulary. */
export function cardStatusOfPhase(
  status: PhaseStatus | undefined,
  hasRun: boolean,
  runFinished: boolean,
): CardStatus {
  if (!hasRun) return 'idle';
  if (status === 'success') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'running') return 'running';
  return runFinished ? 'skipped' : 'waiting';
}
