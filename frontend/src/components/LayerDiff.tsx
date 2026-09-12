import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getLayerDiff } from '../api/client';
import type { DiffColumn, DiffRow, LayerStream } from '../types';
import Spinner from './Spinner';

/**
 * Bronze and silver on the same rows, as a diff.
 *
 * The quality report says how much changed. This says *what*, on the actual
 * data — which is the only form of the claim a reader can check rather than
 * take on trust. It borrows the shape everyone already knows from a code
 * review: a removed line, an added line, and only the parts that differ
 * highlighted.
 *
 * Two departures from a code diff, both forced by what the data does.
 *
 * A cast gets its own colour. `"44"` and `44` are the same three glyphs, so
 * rendering them as a normal change would show two identical lines — and
 * calling them unchanged would hide the most common thing the cleaning does.
 * The type is on the column header and the cell is tinted, without pretending
 * the text moved.
 *
 * A row the cleaning removed shows with no counterpart at all, the way a
 * deleted line does. It is the only case where silver has fewer rows than
 * bronze, and it should look like a deletion because that is what it is.
 */
export default function LayerDiff({
  projectId,
  streams,
}: {
  projectId: number;
  streams: LayerStream[];
}) {
  const sources = streams.filter((stream) => stream.source_id !== null);
  const [sourceId, setSourceId] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['layer-diff', projectId, sourceId],
    queryFn: () => getLayerDiff(projectId, { sourceId }),
    retry: false,
  });

  return (
    <div className="border-t border-slate-800 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-100">
            What the cleaning did, row by row
          </h4>
          <p className="mt-0.5 text-xs text-slate-500">
            The same rows in <span className="text-amber-300">bronze</span> and in{' '}
            <span className="text-slate-200">silver</span>. Only the cells that changed are
            marked.
          </p>
        </div>
        {sources.length > 1 && (
          <label className="flex items-center gap-2 text-xs text-slate-400">
            Source
            <select
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
              value={sourceId ?? ''}
              onChange={(event) =>
                setSourceId(event.target.value ? Number(event.target.value) : null)
              }
            >
              <option value="">Most recent</option>
              {sources.map((stream) => (
                <option key={stream.source_id} value={stream.source_id ?? ''}>
                  {stream.source_name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {isLoading && (
        <div className="mt-4">
          <Spinner />
        </div>
      )}

      {error != null && !isLoading && (
        <p className="mt-4 text-sm text-slate-500">
          Nothing has been through the layers yet. Run an extraction and the before and after
          will appear here.
        </p>
      )}

      {data && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
            <Legend tone="value" label="value corrected" />
            <Legend tone="type" label="type applied" />
            <Legend tone="null" label="emptied to null" />
            <Legend tone="removed" label="row removed" />
          </div>

          <p className="mt-2 text-xs text-slate-500">
            {data.bronze_rows.toLocaleString()} rows in bronze,{' '}
            {data.silver_rows.toLocaleString()} in silver
            {data.approximate && (
              // Said out loud rather than left for a reader to discover: past
              // the removals the report tracks, the pairing is by position.
              <span className="ml-2 text-amber-400">
                — more rows were removed than this view can line up exactly, so pairs below
                that point are matched by position
              </span>
            )}
          </p>

          <div className="mt-2 overflow-x-auto rounded border border-slate-800">
            <table className="min-w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-900/60">
                  <th className="px-2 py-1.5 font-normal text-slate-600">#</th>
                  {data.columns.map((column, index) => (
                    <ColumnHeader key={index} column={column} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <DiffRows key={row.row} row={row} columns={data.columns} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function ColumnHeader({ column }: { column: DiffColumn }) {
  if (column.change === 'dropped') {
    return (
      <th className="px-2 py-1.5 font-medium">
        <span className="text-slate-500 line-through">{column.bronze}</span>
        <span className="ml-1.5 block font-mono text-[10px] font-normal text-rose-400/70">
          dropped — empty
        </span>
      </th>
    );
  }
  if (column.change === 'added') {
    return (
      <th className="px-2 py-1.5 font-medium">
        <span className="text-emerald-300">{column.silver}</span>
        <span className="ml-1.5 block font-mono text-[10px] font-normal text-emerald-400/70">
          added — {column.silver_type}
        </span>
      </th>
    );
  }
  return (
    <th className="px-2 py-1.5 font-medium">
      {column.change === 'renamed' ? (
        <span>
          <span className="text-slate-500 line-through">{column.bronze}</span>
          <span className="mx-1 text-slate-600">→</span>
          <span className="text-slate-200">{column.silver}</span>
        </span>
      ) : (
        <span className="text-slate-200">{column.silver}</span>
      )}
      <span className="block font-mono text-[10px] font-normal text-slate-600">
        {column.bronze_type === column.silver_type ? (
          column.silver_type
        ) : (
          <>
            <span className="text-amber-500/70">{column.bronze_type}</span>
            <span className="mx-1">→</span>
            <span className="text-sky-400/80">{column.silver_type}</span>
          </>
        )}
      </span>
    </th>
  );
}

/**
 * One source row as up to two table rows: what bronze held, and what silver
 * holds. A row where nothing changed collapses to a single line, the way a
 * diff shows unchanged context once.
 */
function DiffRows({ row, columns }: { row: DiffRow; columns: DiffColumn[] }) {
  if (row.removed) {
    return (
      <tr className="border-b border-slate-800/60 bg-rose-950/30">
        <td className="px-2 py-1 font-mono text-[10px] text-rose-400">−{row.row}</td>
        {columns.map((_, index) => (
          <td key={index} className="px-2 py-1 text-rose-200/60 line-through">
            <Cell value={row.bronze[index]} />
          </td>
        ))}
      </tr>
    );
  }

  const untouched = row.cells.every((cell) => cell === 'same' || cell === 'absent');
  if (untouched) {
    return (
      <tr className="border-b border-slate-800/60">
        <td className="px-2 py-1 font-mono text-[10px] text-slate-700">{row.row}</td>
        {columns.map((column, index) => (
          <td key={index} className="px-2 py-1 text-slate-400">
            {column.change === 'dropped' ? (
              <span className="text-slate-700">—</span>
            ) : (
              <Cell value={row.silver[index]} />
            )}
          </td>
        ))}
      </tr>
    );
  }

  return (
    <>
      <tr className="bg-amber-950/20">
        <td className="px-2 py-1 font-mono text-[10px] text-amber-500/80">−{row.row}</td>
        {columns.map((column, index) => (
          <td
            key={index}
            className={`px-2 py-1 ${
              row.cells[index] === 'value' || row.cells[index] === 'null'
                ? 'bg-rose-900/30 text-rose-100'
                : 'text-amber-200/50'
            }`}
          >
            {column.bronze === null ? (
              <span className="text-slate-700">—</span>
            ) : (
              <Cell value={row.bronze[index]} />
            )}
          </td>
        ))}
      </tr>
      <tr className="border-b border-slate-800/60 bg-slate-700/15">
        <td className="px-2 py-1 font-mono text-[10px] text-slate-400">+{row.row}</td>
        {columns.map((column, index) => (
          <td
            key={index}
            className={`px-2 py-1 ${cellTone(row.cells[index])}`}
            title={cellTitle(row.cells[index], column)}
          >
            {column.silver === null ? (
              <span className="text-slate-700">—</span>
            ) : (
              <Cell value={row.silver[index]} />
            )}
          </td>
        ))}
      </tr>
    </>
  );
}

function cellTone(cell: DiffRow['cells'][number]): string {
  switch (cell) {
    case 'value':
      return 'bg-emerald-900/30 text-emerald-100';
    case 'null':
      return 'bg-emerald-900/20 text-slate-500';
    // A cast is tinted, not shouted about: the text did not move, the type did,
    // and the header already says which.
    case 'type':
      return 'bg-sky-900/25 text-sky-100';
    default:
      return 'text-slate-300';
  }
}

function cellTitle(cell: DiffRow['cells'][number], column: DiffColumn): string {
  if (cell === 'type') return `${column.bronze_type} → ${column.silver_type}`;
  if (cell === 'null') return 'a placeholder that meant "no value"';
  return '';
}

/**
 * One value, quoted and with its whitespace intact.
 *
 * Unquoted, the change this view most often shows — two spaces becoming one —
 * is invisible, because HTML collapses runs of whitespace.
 */
function Cell({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="italic text-slate-600">null</span>;
  }
  if (typeof value !== 'string') {
    return <span className="font-mono">{String(value)}</span>;
  }
  return (
    <span className="whitespace-pre font-mono">
      <span className="text-slate-600">"</span>
      <span>{value}</span>
      <span className="text-slate-600">"</span>
    </span>
  );
}

function Legend({ tone, label }: { tone: 'value' | 'type' | 'null' | 'removed'; label: string }) {
  const swatch = {
    value: 'bg-emerald-900/60 border-emerald-700',
    type: 'bg-sky-900/60 border-sky-700',
    null: 'bg-emerald-900/30 border-emerald-800',
    removed: 'bg-rose-950/60 border-rose-800',
  }[tone];
  return (
    <span className="flex items-center gap-1.5 text-slate-500">
      <span className={`inline-block h-2.5 w-4 rounded-sm border ${swatch}`} />
      {label}
    </span>
  );
}
