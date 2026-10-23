import type { ReactNode } from 'react';
import { GripVertical, RotateCcw } from 'lucide-react';
import type { InputStream, PipelineInputChoice, PipelineInputOptions } from '../../types';
import { formatBytes } from '../../utils/format';
import { INPUT_DRAG_TYPE, encodeChoice, sameChoice } from './phases';

/**
 * What the pipeline can train on, ready to be dragged onto the input.
 *
 * Gold comes first because it is what a project is built to train on; bronze
 * last because training on it is a deliberate experiment — whether the
 * cleaning helps — not the default. "Newest gold" is its own entry, separate
 * from the versions, because following new builds and pinning one are
 * different decisions and both have to be visible as choices.
 */
export default function InputPalette({
  options,
  current,
  disabled,
  onChoose,
}: {
  options: PipelineInputOptions | undefined;
  current: PipelineInputChoice;
  disabled: boolean;
  onChoose: (choice: PipelineInputChoice) => void;
}) {
  if (!options) {
    return <p className="text-xs text-slate-500">Loading layers…</p>;
  }

  const empty = !options.gold.length && !options.silver.length && !options.bronze.length;

  const chip = (choice: PipelineInputChoice, label: string, detail: string, tone: string) => (
    <Chip
      key={label}
      choice={choice}
      label={label}
      detail={detail}
      tone={tone}
      active={sameChoice(choice, current)}
      disabled={disabled}
      onChoose={onChoose}
    />
  );

  const streams = (layer: 'silver' | 'bronze', items: InputStream[], tone: string) =>
    items.map((stream) =>
      chip(
        { layer, source_id: stream.source_id },
        `${layer} · ${stream.source_name}`,
        `${stream.objects} object${stream.objects === 1 ? '' : 's'} · ${formatBytes(stream.size_bytes)}`,
        tone,
      ),
    );

  return (
    <div className="space-y-4">
      {empty && (
        <p className="text-xs leading-relaxed text-slate-500">
          Nothing has landed in any layer yet. Extract from a source in the Data Factory and
          the layers appear here.
        </p>
      )}

      {options.gold.length > 0 && (
        <Group title="Gold" className="text-yellow-300">
          {chip({ layer: 'gold' }, 'gold · newest', 'follows every new build', GOLD)}
          {options.gold.map((build) =>
            chip(
              { layer: 'gold', version: build.version },
              `gold v${build.version}`,
              `${build.latest ? 'newest · ' : ''}${formatBytes(build.size_bytes)}`,
              GOLD,
            ),
          )}
        </Group>
      )}

      {options.silver.length > 0 && (
        <Group title="Silver" className="text-slate-200">
          {streams('silver', options.silver, SILVER)}
        </Group>
      )}

      {options.bronze.length > 0 && (
        <Group title="Bronze · uncleaned" className="text-amber-300">
          {streams('bronze', options.bronze, BRONZE)}
        </Group>
      )}

      <button
        type="button"
        onClick={() => onChoose({ layer: '' })}
        disabled={disabled || !current.layer}
        className="flex w-full items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-left text-xs text-slate-300 transition hover:bg-slate-800 disabled:cursor-default disabled:opacity-40"
      >
        <RotateCcw size={12} aria-hidden="true" />
        Use the active dataset instead
      </button>
    </div>
  );
}

const GOLD = 'border-yellow-700/60 bg-yellow-900/20 text-yellow-100';
const SILVER = 'border-slate-500/60 bg-slate-400/10 text-slate-100';
const BRONZE = 'border-amber-800/70 bg-amber-950/30 text-amber-100';

function Group({ title, className, children }: { title: string; className: string; children: ReactNode }) {
  return (
    <section>
      <h4 className={`mb-1.5 text-[11px] font-semibold uppercase tracking-wider ${className}`}>{title}</h4>
      <ul className="space-y-1.5">{children}</ul>
    </section>
  );
}

function Chip({
  choice,
  label,
  detail,
  tone,
  active,
  disabled,
  onChoose,
}: {
  choice: PipelineInputChoice;
  label: string;
  detail: string;
  tone: string;
  active: boolean;
  disabled: boolean;
  onChoose: (choice: PipelineInputChoice) => void;
}) {
  return (
    <li>
      <button
        type="button"
        draggable={!disabled}
        onDragStart={(event) => {
          event.dataTransfer.setData(INPUT_DRAG_TYPE, encodeChoice(choice));
          event.dataTransfer.setData('text/plain', label);
          event.dataTransfer.effectAllowed = 'copy';
        }}
        // Clicking does what dropping does, for anyone not using a mouse.
        onClick={() => onChoose(choice)}
        disabled={disabled}
        title="Drag onto Input, or click to use"
        aria-pressed={active}
        className={`flex w-full cursor-grab items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition hover:brightness-125 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50 ${tone} ${
          active ? 'ring-2 ring-brand-400' : ''
        }`}
      >
        <GripVertical size={14} aria-hidden="true" className="shrink-0 opacity-50" />
        <span className="min-w-0">
          <span className="block truncate text-xs font-medium">{label}</span>
          <span className="block truncate text-[10px] opacity-70">{detail}</span>
        </span>
      </button>
    </li>
  );
}
