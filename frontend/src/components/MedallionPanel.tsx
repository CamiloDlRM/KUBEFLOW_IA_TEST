import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMedallion, previewLayer } from '../api/client';
import type { Layer, LayerSummary } from '../types';
import Spinner from './Spinner';
import GoldDefinition from './GoldDefinition';
import LayerDiff from './LayerDiff';

/**
 * The three layers of a project, side by side.
 *
 * The colour is doing real work here, not decoration. Bronze, silver and gold
 * are the same rows three times, and the only way to read this view quickly is
 * to be able to tell at a glance which one you are looking at — so each layer
 * keeps its metal from the card through the preview table to the selected
 * state, and nothing else in the app uses those three ramps.
 *
 * What is deliberately *not* here is a "clean" badge. Silver's claim is the
 * quality report, which lives on each extraction and says what changed and by
 * how much. A badge would assert the same thing without the evidence.
 */
export default function MedallionPanel({ projectId }: { projectId: number }) {
  const [selected, setSelected] = useState<Layer>('silver');

  const { data, isLoading } = useQuery({
    queryKey: ['medallion', projectId],
    queryFn: () => getMedallion(projectId),
  });

  if (isLoading) {
    return (
      <section className="rounded-lg border border-slate-700 bg-slate-900/40 p-6">
        <Spinner />
      </section>
    );
  }
  if (!data) return null;

  const layers: LayerSummary[] = [data.bronze, data.silver, data.gold];
  const nothingYet = layers.every((layer) => layer.rows === 0);

  return (
    <section className="rounded-lg border border-slate-700 bg-slate-900/40">
      <header className="border-b border-slate-800 px-5 py-4">
        <h3 className="text-base font-semibold text-slate-100">The data, in three layers</h3>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          Every extraction lands in <span className="text-amber-300">bronze</span> exactly as the
          source gave it, is cleaned into <span className="text-slate-200">silver</span>, and is
          combined with everything landed before it into{' '}
          <span className="text-yellow-300">gold</span> — the single table the pipeline trains on.
        </p>
      </header>

      {nothingYet ? (
        <p className="px-5 py-8 text-center text-sm text-slate-500">
          Nothing has been extracted yet. Connect a source and run an extraction, and the same rows
          will appear here three times.
        </p>
      ) : (
        <>
          <div className="grid gap-3 px-5 py-5 md:grid-cols-3">
            {layers.map((layer) => (
              <LayerCard
                key={layer.layer}
                summary={layer}
                selected={selected === layer.layer}
                onSelect={() => setSelected(layer.layer)}
              />
            ))}
          </div>

          <LayerDetail projectId={projectId} summary={layers.find((l) => l.layer === selected)!} />

          {/* Bronze and silver are two views of one transition, so either one
              selected shows the diff between them. Gold is not a cleaning of
              anything — it is a query — so it gets its definition instead. */}
          {selected === 'gold' ? (
            <GoldDefinition projectId={projectId} summary={data.gold} />
          ) : (
            <LayerDiff projectId={projectId} streams={data.silver.streams} />
          )}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  The metals                                                         */
/* ------------------------------------------------------------------ */

/**
 * One ramp per layer, used everywhere that layer appears.
 *
 * Silver is the awkward one: the app's whole surface is slate, so a literal
 * grey card would read as "not yet loaded" rather than as a layer. It is
 * pushed towards a cooler, brighter steel and given a visible border so it
 * looks chosen rather than absent.
 */
const METALS: Record<
  Layer,
  {
    label: string;
    promise: string;
    surface: string;
    ring: string;
    text: string;
    accent: string;
    chip: string;
  }
> = {
  bronze: {
    label: 'Bronze',
    promise: 'What the source said',
    surface: 'bg-gradient-to-br from-amber-900/50 via-amber-800/25 to-orange-950/30',
    ring: 'border-amber-700/60 hover:border-amber-500/80',
    text: 'text-amber-200',
    accent: 'text-amber-400',
    chip: 'bg-amber-950/60 text-amber-200 border border-amber-800/60',
  },
  silver: {
    label: 'Silver',
    promise: 'What the data means',
    surface: 'bg-gradient-to-br from-slate-300/20 via-slate-400/10 to-slate-600/15',
    ring: 'border-slate-400/50 hover:border-slate-300/80',
    text: 'text-slate-100',
    accent: 'text-slate-300',
    chip: 'bg-slate-700/60 text-slate-100 border border-slate-400/40',
  },
  gold: {
    label: 'Gold',
    promise: 'What the project answers',
    surface: 'bg-gradient-to-br from-yellow-700/45 via-amber-600/20 to-yellow-950/30',
    ring: 'border-yellow-600/60 hover:border-yellow-400/80',
    text: 'text-yellow-100',
    accent: 'text-yellow-300',
    chip: 'bg-yellow-950/60 text-yellow-200 border border-yellow-700/60',
  },
};

function LayerCard({
  summary,
  selected,
  onSelect,
}: {
  summary: LayerSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const metal = METALS[summary.layer];

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`rounded-lg border p-4 text-left transition ${metal.surface} ${metal.ring} ${
        selected ? 'ring-2 ring-offset-2 ring-offset-slate-900 ring-current' : ''
      } ${metal.text}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold uppercase tracking-wide">{metal.label}</span>
        {summary.layer === 'gold' && summary.version > 0 && (
          <span className={`rounded px-1.5 py-0.5 text-[11px] ${metal.chip}`}>
            v{summary.version}
          </span>
        )}
      </div>
      <p className={`mt-0.5 text-xs ${metal.accent}`}>{metal.promise}</p>

      <p className="mt-3 text-2xl font-semibold tabular-nums">
        {summary.rows.toLocaleString()}
        <span className={`ml-1.5 text-xs font-normal ${metal.accent}`}>rows</span>
      </p>
      <p className={`mt-1 text-xs ${metal.accent}`}>
        {summary.objects.toLocaleString()} {summary.objects === 1 ? 'file' : 'files'} ·{' '}
        {formatBytes(summary.size_bytes)} · bucket <code>{summary.bucket}</code>
      </p>
      {summary.build_error && (
        <p className="mt-2 text-xs text-red-300">{summary.build_error}</p>
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  What is inside the selected layer                                  */
/* ------------------------------------------------------------------ */

function LayerDetail({ projectId, summary }: { projectId: number; summary: LayerSummary }) {
  const metal = METALS[summary.layer];
  const [sourceId, setSourceId] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['layer-preview', projectId, summary.layer, sourceId],
    queryFn: () => previewLayer(projectId, summary.layer, { sourceId }),
    retry: false,
  });

  const streams = summary.streams.filter((stream) => stream.source_id !== null);

  return (
    <div className="border-t border-slate-800 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className={`text-sm font-semibold ${metal.text}`}>
          {metal.label} — {metal.promise.toLowerCase()}
        </h4>
        {summary.layer !== 'gold' && streams.length > 1 && (
          <label className="flex items-center gap-2 text-xs text-slate-400">
            Source
            <select
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
              value={sourceId ?? ''}
              onChange={(event) =>
                setSourceId(event.target.value ? Number(event.target.value) : null)
              }
            >
              <option value="">All</option>
              {streams.map((stream) => (
                <option key={stream.source_id} value={stream.source_id ?? ''}>
                  {stream.source_name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {summary.layer !== 'gold' && streams.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {streams.map((stream) => (
            <li key={stream.source_id} className={`rounded px-2 py-1 text-xs ${metal.chip}`}>
              {stream.source_name}: {stream.rows.toLocaleString()} rows in{' '}
              {stream.objects.toLocaleString()} {stream.objects === 1 ? 'file' : 'files'}
            </li>
          ))}
        </ul>
      )}

      {isLoading && (
        <div className="mt-4">
          <Spinner />
        </div>
      )}

      {error != null && !isLoading && (
        <p className="mt-4 text-sm text-slate-500">
          Nothing to show in {metal.label.toLowerCase()} yet.
        </p>
      )}

      {data && (
        <>
          <p className="mt-3 text-xs text-slate-500">
            Showing the first {data.rows.length} of {data.object_rows.toLocaleString()} rows in{' '}
            <code className="text-slate-400">{data.key}</code>
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr className={`border-b ${metal.ring.split(' ')[0]}`}>
                  {data.columns.map((column) => (
                    <th key={column.name} className="px-2 py-1.5 font-medium">
                      <span className={metal.text}>{column.name}</span>
                      {/* The stored Parquet type, not an inferred guess. In
                          bronze every column reads "string" — which is the
                          layer keeping its promise, not a failure to detect. */}
                      <span className="ml-1.5 font-mono text-[10px] text-slate-500">
                        {column.type}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, index) => (
                  <tr key={index} className="border-b border-slate-800/60">
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className="px-2 py-1.5 text-slate-300">
                        {cell === null || cell === undefined ? (
                          // A null and an empty string are different facts
                          // about the source, and bronze keeps them apart.
                          <span className="text-slate-600">null</span>
                        ) : (
                          String(cell)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
