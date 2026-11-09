import type { CSSProperties } from 'react';
import { MarkerType, Position, type Edge, type Node } from '@xyflow/react';
import type { MountedInput } from '../../types';
import { NOTEBOOK_PHASES, type CardStatus } from '../canvas/phases';
import { isLayer, layerStyle } from './layerTheme';
import type { PipelineView } from './usePipelineView';

/** The row, left to right: the data, the notebook's phases, the model. */
export const steps = [
  { id: 'input', label: 'Input', caption: 'The data this pipeline trains on.' },
  ...NOTEBOOK_PHASES.map((phase) => ({ id: phase.id, label: phase.label, caption: phase.caption })),
  { id: 'model', label: 'Model', caption: 'Logged to MLflow, then deployed if it clears the bar.' },
];

const GAP = 180;

/**
 * A card's status, plus `absent`: an optional phase the notebook has no cells
 * for. The old view dropped those cards; here every phase keeps its place in
 * the row so the layout does not jump when the notebook loads.
 */
export type NodeStatus = CardStatus | 'absent';

const STATUS: Record<NodeStatus, { label: string; dot: string; border?: string; dashed?: boolean; dim?: boolean }> = {
  idle: { label: 'not run', dot: 'bg-slate-500' },
  waiting: { label: 'waiting', dot: 'bg-slate-500', dashed: true },
  running: { label: 'running', dot: 'bg-blue-400 animate-pulse', border: '#3b82f6' }, // blue-500
  completed: { label: 'completed', dot: 'bg-emerald-400', border: '#059669' }, // emerald-600
  failed: { label: 'failed', dot: 'bg-red-400', border: '#dc2626' }, // red-600
  skipped: { label: 'never ran', dot: 'bg-slate-600', dim: true },
  missing: { label: 'no cells', dot: 'bg-red-500', border: '#b91c1c', dashed: true }, // red-700
  absent: { label: 'not in notebook', dot: 'bg-slate-700', dashed: true, dim: true },
};

function statusStyle(status: NodeStatus): CSSProperties {
  const style = STATUS[status];
  return {
    ...(style.border && { borderColor: style.border }),
    ...(style.dashed && { borderStyle: 'dashed' }),
    ...(style.dim && { opacity: 0.55 }),
  };
}

/** Name, an optional detail line, and the status with its dot. */
function NodeLabel({ title, detail, status }: { title: string; detail?: string; status: NodeStatus }) {
  const style = STATUS[status];
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span>{title}</span>
      {detail && <span className="block max-w-full truncate text-[9px] opacity-75">{detail}</span>}
      <span className="flex items-center gap-1 text-[8px] uppercase tracking-wide opacity-60">
        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
        {style.label}
      </span>
    </div>
  );
}

/**
 * What Input says it trains on. `null` means nothing resolves (no layer chosen
 * and no active dataset); `undefined` means it is still loading.
 */
function inputDetail(resolved: MountedInput | null | undefined) {
  return resolved === undefined ? '…' : resolved?.label ?? 'Not dataset';
}

/** Only what the nodes show, so the page can rebuild them exactly when one of these changes. */
export type NodeInputs = Pick<PipelineView, 'cards' | 'inputStatus' | 'modelStatus' | 'accuracy' | 'deployed'>;

function phaseStatus(view: NodeInputs, id: string): NodeStatus {
  if (!view.cards) return 'idle';
  return view.cards.find((card) => card.id === id)?.status ?? 'absent';
}

export function buildNodes(resolved: MountedInput | null | undefined, view: NodeInputs): Node[] {
  return steps.map((step, index) => {
    let status: NodeStatus;
    let detail: string | undefined;
    let style: CSSProperties = {};

    if (step.id === 'input') {
      status = view.inputStatus;
      detail = inputDetail(resolved);
      // The Input node takes the metal of the layer it trains on, like the dataset cards in its
      // panel. A run's status, when there is one, then marks the border.
      style = { ...(resolved && isLayer(resolved.layer) ? layerStyle(resolved.layer) : undefined), ...statusStyle(status) };
    } else if (step.id === 'model') {
      status = view.modelStatus;
      if (view.accuracy !== undefined) {
        detail = `accuracy ${view.accuracy.toFixed(4)}${view.deployed ? ' · deployed' : ''}`;
      }
      style = statusStyle(status);
    } else {
      status = phaseStatus(view, step.id);
      const cells = view.cards?.find((card) => card.id === step.id)?.cells.length;
      if (cells) detail = `${cells} cell${cells === 1 ? '' : 's'}`;
      style = statusStyle(status);
    }

    return {
      id: step.id,
      type: index === 0 ? 'input' : index === steps.length - 1 ? 'output' : 'default',
      position: { x: index * GAP, y: 0 },
      data: { label: <NodeLabel title={step.label} detail={detail} status={status} /> },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      className: 'font-body2',
      style,
    };
  });
}

export const edges: Edge[] = steps.slice(1).map((step, index) => {
  const prev = steps[index];
  return {
    id: `${prev.id}-${step.id}`,
    source: prev.id,
    target: step.id,
    markerEnd: { type: MarkerType.Arrow, color: '#64748b', width: 20, height: 20, strokeWidth: 2 },
  };
});
