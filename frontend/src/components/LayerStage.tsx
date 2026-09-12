import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { previewLayer } from '../api/client';
import type { LayerSummary } from '../types';
import Spinner from './Spinner';

/**
 * One layer, on its own stage: what it holds and what is in it.
 *
 * The metal is doing work rather than decoration. These are the same rows three
 * times, and the only way to read the stage quickly is to know at a glance
 * which one you are looking at — so each layer keeps its ramp, and nothing else
 * in the app uses those three.
 *
 * The column type shown is the one *stored in the Parquet file*, not a label.
 * In bronze every column reads "string", which is the layer keeping its promise
 * rather than a failure to detect anything — and it is what makes silver's
 * int64 and timestamp mean something.
 */
const METALS = {
  bronze: {
    title: 'Bronze — what the source said',
    blurb:
      'Exactly what came out, every column as text, nulls preserved, nothing corrected. It is kept precisely because it is not clean: silver can be rebuilt from it when the cleaning improves, without going back to a source whose watermark has moved on.',
    accent: 'text-amber-200',
    border: 'border-amber-700/60',
    surface: 'bg-gradient-to-br from-amber-900/30 to-orange-950/20',
  },
  silver: {
    title: 'Silver — what the data means',
    blurb:
      'Bronze through one cleaning standard: whitespace and placeholder nulls resolved, types applied, categories folded to one spelling, free text coded. It accumulates — each extraction adds its slice beside the ones before.',
    accent: 'text-slate-100',
    border: 'border-slate-400/50',
    surface: 'bg-gradient-to-br from-slate-300/15 to-slate-600/10',
  },
  gold: {
    title: 'Gold — what the project answers',
    blurb:
      'One query across silver, rebuilt in full every time. This is the table the pipeline trains on.',
    accent: 'text-yellow-100',
    border: 'border-yellow-600/60',
    surface: 'bg-gradient-to-br from-yellow-700/30 to-yellow-950/20',
  },
} as const;

export default function LayerStage({
  projectId,
  summary,
}: {
  projectId: number;
  summary: LayerSummary;
}) {
  const metal = METALS[summary.layer];
  const streams = summary.streams.filter((stream) => stream.source_id !== null);
  const [sourceId, setSourceId] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['layer-preview', projectId, summary.layer, sourceId],
    queryFn: () => previewLayer(projectId, summary.layer, { sourceId }),
    retry: false,
  });

  return (
    <section className={`rounded-lg border ${metal.border} ${metal.surface}`}>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/5 px-5 py-4">
        <div className="min-w-0">
          <h3 className={`text-base font-semibold ${metal.accent}`}>{metal.title}</h3>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">{metal.blurb}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className={`text-2xl font-semibold tabular-nums ${metal.accent}`}>
            {summary.rows.toLocaleString()}
          </p>
          <p className="text-xs text-slate-500">
            rows · {summary.objects} {summary.objects === 1 ? 'file' : 'files'} · bucket{' '}
            <code>{summary.bucket}</code>
          </p>
        </div>
      </header>

      {summary.build_error && (
        <p className="border-b border-red-900/50 bg-red-950/30 px-5 py-2 text-xs text-red-200">
          {summary.build_error}
        </p>
      )}

      <div className="px-5 py-4">
        {streams.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {streams.map((stream) => (
              <button
                key={stream.source_id}
                onClick={() =>
                  setSourceId((current) =>
                    current === stream.source_id ? null : stream.source_id,
                  )
                }
                className={`rounded px-2 py-1 text-xs transition ${
                  sourceId === stream.source_id
                    ? 'bg-white/15 text-slate-100'
                    : 'bg-black/20 text-slate-400 hover:text-slate-200'
                }`}
              >
                {stream.source_name}: {stream.rows.toLocaleString()} rows
              </button>
            ))}
          </div>
        )}

        {isLoading && <Spinner />}

        {error != null && !isLoading && (
          <p className="text-sm text-slate-500">
            Nothing in {summary.layer} yet.
          </p>
        )}

        {data && (
          <>
            <p className="text-xs text-slate-500">
              First {data.rows.length} of {data.object_rows.toLocaleString()} rows in{' '}
              <code className="text-slate-400">{data.key}</code>
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/10">
                    {data.columns.map((column) => (
                      <th key={column.name} className="px-2 py-1.5 font-medium">
                        <span className={metal.accent}>{column.name}</span>
                        <span className="ml-1.5 font-mono text-[10px] font-normal text-slate-500">
                          {column.type}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, index) => (
                    <tr key={index} className="border-b border-white/5">
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex} className="px-2 py-1.5 text-slate-300">
                          {cell === null || cell === undefined ? (
                            // A null and an empty string are different facts
                            // about the source, and bronze keeps them apart.
                            <span className="italic text-slate-600">null</span>
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
    </section>
  );
}
