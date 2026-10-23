import { useState, type DragEvent, type ReactNode } from 'react';
import { ChevronRight, Database, Rocket } from 'lucide-react';
import type { MountedInput, PipelineInputChoice, PipelineInputState, PhaseStatus } from '../../types';
import { INPUT_DRAG_TYPE, decodeChoice, type CardStatus, type PhaseCard } from './phases';

/**
 * The nodes of the pipeline view: the input the data is dropped on, one card
 * per notebook phase, and the model at the end.
 *
 * Every node is a button. Dragging is how the input is chosen, but a card
 * that could only be operated with a mouse would shut out a keyboard, so the
 * palette also chooses on click and every card opens its detail on Enter.
 */

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

const LAYER_TONES: Record<string, string> = {
  bronze: 'from-amber-900/50 to-orange-950/30 border-amber-700/70 text-amber-100',
  silver: 'from-slate-300/20 to-slate-600/15 border-slate-400/60 text-slate-100',
  gold: 'from-yellow-700/45 to-yellow-950/30 border-yellow-600/70 text-yellow-50',
  '': 'from-slate-800/60 to-slate-900/40 border-slate-600 text-slate-100',
};

function NodeShell({
  selected,
  onSelect,
  className,
  label,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  className: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={label}
      className={`flex w-48 shrink-0 flex-col rounded-2xl border px-4 py-3 text-left transition hover:brightness-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${className} ${
        selected ? 'ring-2 ring-brand-400 ring-offset-2 ring-offset-slate-950' : ''
      }`}
    >
      {children}
    </button>
  );
}

function StatusLine({ status, extra }: { status: CardStatus; extra?: string }) {
  const style = STATUS_STYLES[status];
  return (
    <span className="mt-auto flex items-center justify-between gap-2 pt-3 text-[11px] text-slate-400">
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${style.dot}`} />
        {style.label}
      </span>
      {extra && <span className="tabular-nums">{extra}</span>}
    </span>
  );
}

/** One notebook phase. */
export function PhaseNode({
  card,
  step,
  selected,
  onSelect,
}: {
  card: PhaseCard;
  step: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const style = STATUS_STYLES[card.status];
  const firstLine = card.cells[0]?.source.split('\n').find((line) => line.trim()) ?? '';
  return (
    <NodeShell
      selected={selected}
      onSelect={onSelect}
      label={card.label}
      className={`min-h-[132px] bg-slate-900/70 ${style.border} ${
        card.status === 'skipped' ? 'opacity-60' : ''
      }`}
    >
      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {step}
      </span>
      <span className="text-sm font-semibold text-slate-100">{card.label}</span>
      <span className="text-[11px] leading-snug text-slate-500">{card.caption}</span>
      {firstLine && (
        <code className="mt-2 block truncate rounded bg-black/30 px-1.5 py-1 font-mono text-[10px] text-slate-400">
          {firstLine}
        </code>
      )}
      <StatusLine
        status={card.status}
        extra={card.cells.length ? `${card.cells.length} cell${card.cells.length === 1 ? '' : 's'}` : undefined}
      />
    </NodeShell>
  );
}

/**
 * Where the data goes in. The one node that accepts a drop.
 *
 * It says two things that are easy to conflate: what the *next* run will
 * mount (the repository's choice) and what the run on screen *did* mount.
 * They differ whenever the choice has changed since, or follows the newest
 * gold and a new build has landed — which is exactly when it matters.
 */
export function InputNode({
  state,
  mounted,
  status,
  selected,
  busy,
  onSelect,
  onChoose,
}: {
  state: PipelineInputState | undefined;
  mounted: MountedInput | undefined;
  status: CardStatus;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onChoose: (choice: PipelineInputChoice) => void;
}) {
  const [over, setOver] = useState(false);
  const layer = state?.choice.layer ?? '';
  const next = state?.resolved?.label ?? (layer ? '' : 'Active dataset');

  const accepts = (event: DragEvent) => event.dataTransfer.types.includes(INPUT_DRAG_TYPE);

  return (
    <div
      data-testid="input-drop"
      onDragOver={(event) => {
        if (!accepts(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        setOver(false);
        const choice = decodeChoice(event.dataTransfer.getData(INPUT_DRAG_TYPE));
        if (!choice) return;
        event.preventDefault();
        onChoose(choice);
      }}
      className={`rounded-2xl transition ${over ? 'scale-[1.03] ring-2 ring-yellow-300/80 ring-offset-2 ring-offset-slate-950' : ''}`}
    >
      <NodeShell
        selected={selected}
        onSelect={onSelect}
        label="Input"
        className={`min-h-[132px] bg-gradient-to-br ${LAYER_TONES[layer] ?? LAYER_TONES['']}`}
      >
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide opacity-70">
          <Database size={12} aria-hidden="true" /> Input
        </span>
        <span className="text-sm font-semibold">
          {busy ? 'Saving…' : over ? 'Drop to train on this' : next || '—'}
        </span>
        {state?.error ? (
          <span className="text-[11px] leading-snug text-red-300">{state.error}</span>
        ) : (
          <span className="text-[11px] leading-snug opacity-70">
            {layer ? 'Next run mounts this' : 'Drag a layer here to choose'}
          </span>
        )}
        {mounted?.label && mounted.label !== next && (
          <span className="mt-1 text-[11px] leading-snug opacity-80">This run: {mounted.label}</span>
        )}
        <StatusLine status={status} />
      </NodeShell>
    </div>
  );
}

/** Registration in MLflow and, when the metrics clear the bar, deployment. */
export function ModelNode({
  status,
  accuracy,
  deployed,
  selected,
  onSelect,
}: {
  status: CardStatus;
  accuracy: number | undefined;
  deployed: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <NodeShell
      selected={selected}
      onSelect={onSelect}
      label="Model"
      className={`min-h-[132px] bg-slate-900/70 ${STATUS_STYLES[status].border}`}
    >
      <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
        <Rocket size={12} aria-hidden="true" /> Model
      </span>
      <span className="text-sm font-semibold text-slate-100">Register &amp; deploy</span>
      <span className="text-[11px] leading-snug text-slate-500">
        {accuracy !== undefined
          ? `accuracy ${accuracy.toFixed(4)}${deployed ? ' · deployed' : ''}`
          : 'MLflow, then the model server'}
      </span>
      <StatusLine status={status} />
    </NodeShell>
  );
}

export function Connector() {
  return (
    <span aria-hidden="true" className="flex shrink-0 items-center px-1 text-slate-600">
      <span className="h-px w-5 bg-slate-600" />
      <ChevronRight size={14} className="-ml-1.5" />
    </span>
  );
}
