import type { ReactNode } from 'react';
import { GripVertical, RotateCcw } from 'lucide-react';
import type { InputStream, PipelineInputChoice, PipelineInputOptions } from '../../types';
import { formatBytes } from '../../utils/format';
import { LAYER_THEME, layerStyle, type LayerName } from '../flow/layerTheme';
import { INPUT_DRAG_TYPE, encodeChoice, sameChoice } from './phases';

/**
 * What the pipeline can train on, ready to be dragged onto the input.
 *
 * Gold comes first because it is what a project is built to train on; bronze
 * last because training on it is a deliberate experiment — whether the
 * cleaning helps — not the default. "Newest gold" is its own entry, separate
 * from the versions, because following new builds and pinning one are
 * different decisions and both have to be visible as choices.
 *
 * A click opens a preview of the data and does not choose it: what a model
 * trains on should not change because someone wanted a look. Dragging onto
 * Input chooses, and so does the preview's own "Use as input" button.
 */
export default function InputPalette({
  options,
  current,
  previewing,
  disabled,
  onChoose,
  onPreview,
}: {
  options: PipelineInputOptions | undefined;
  current: PipelineInputChoice;
  /** The entry whose preview is open, if one is. */
  previewing: PipelineInputChoice | null;
  disabled: boolean;
  onChoose: (choice: PipelineInputChoice) => void;
  onPreview: (choice: PipelineInputChoice, label: string) => void;
}) {
  if (!options) {
    return <p className="text-xs text-slate-500">Loading layers…</p>;
  }

  const empty = !options.gold.length && !options.silver.length && !options.bronze.length;

  const chip = (choice: PipelineInputChoice, label: string, detail: string, layer: LayerName) => (
    <Chip
      key={label}
      choice={choice}
      label={label}
      detail={detail}
      layer={layer}
      active={sameChoice(choice, current)}
      open={previewing !== null && sameChoice(choice, previewing)}
      disabled={disabled}
      onPreview={onPreview}
    />
  );

  const streams = (layer: 'silver' | 'bronze', items: InputStream[]) =>
    items.map((stream) =>
      chip(
        { layer, source_id: stream.source_id },
        `${layer} · ${stream.source_name}`,
        `${stream.objects} object${stream.objects === 1 ? '' : 's'} · ${formatBytes(stream.size_bytes)}`,
        layer,
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
        <Group title="Gold" layer="gold">
          {chip({ layer: 'gold' }, 'gold · newest', 'follows every new build', 'gold')}
          {options.gold.map((build) =>
            chip(
              { layer: 'gold', version: build.version },
              `gold v${build.version}`,
              `${build.latest ? 'newest · ' : ''}${formatBytes(build.size_bytes)}`,
              'gold',
            ),
          )}
        </Group>
      )}

      {options.silver.length > 0 && (
        <Group title="Silver" layer="silver">
          {streams('silver', options.silver)}
        </Group>
      )}

      {options.bronze.length > 0 && (
        <Group title="Bronze · uncleaned" layer="bronze">
          {streams('bronze', options.bronze)}
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

function Group({ title, layer, children }: { title: string; layer: LayerName; children: ReactNode }) {
  return (
    <section>
      <h4 className="mb-1 font-display text-[11px] font-semibold uppercase tracking-wider" style={{ color: LAYER_THEME[layer].accent }}>
        {title}
      </h4>
      {/* One row per layer; many builds or sources scroll sideways instead of growing the panel.
          The padding is room for the selected card's ring, which the scroll box would otherwise clip. */}
      <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2 pt-1">{children}</ul>
    </section>
  );
}

function Chip({
  choice,
  label,
  detail,
  layer,
  active,
  open,
  disabled,
  onPreview,
}: {
  choice: PipelineInputChoice;
  label: string;
  detail: string;
  layer: LayerName;
  /** In use: the input the next run mounts. */
  active: boolean;
  open: boolean;
  disabled: boolean;
  onPreview: (choice: PipelineInputChoice, label: string) => void;
}) {
  return (
    <li className="w-56 shrink-0">
      <button
        type="button"
        draggable={!disabled}
        onDragStart={(event) => {
          event.dataTransfer.setData(INPUT_DRAG_TYPE, encodeChoice(choice));
          event.dataTransfer.setData('text/plain', label);
          event.dataTransfer.effectAllowed = 'copy';
        }}
        onClick={() => onPreview(choice, label)}
        disabled={disabled}
        title="Click to preview · drag onto Input to use"
        aria-haspopup="dialog"
        aria-expanded={open}
        style={layerStyle(layer)}
        className={`flex w-full cursor-grab items-center gap-2 rounded-lg border px-2.5 py-2 text-left font-body shadow-sm shadow-black/30 transition hover:brightness-125 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50 ${
          active ? 'ring-2 ring-brand-400' : open ? 'ring-1 ring-slate-300/60' : ''
        }`}
      >
        <GripVertical size={14} aria-hidden="true" className="shrink-0 opacity-50" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{label}</span>
          <span className="block truncate text-[10px] opacity-70">{detail}</span>
        </span>
        {active && (
          <span className="shrink-0 rounded bg-brand-500/25 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-brand-200">
            in use
          </span>
        )}
      </button>
    </li>
  );
}
