import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCleaningSteps } from '../api/client';
import type { CleaningStep, LayerStream } from '../types';
import Spinner from './Spinner';

/**
 * The cleaning standard, a rule at a time, with the table after each one.
 *
 * The quality report says *how much* each rule changed. This says *what*, on
 * the rows themselves, which is the only form of the claim a reader can check
 * rather than take on trust — and it is the difference between being told the
 * data was cleaned and watching it happen.
 *
 * Rules that found nothing to do are kept, collapsed. A rule that ran and
 * changed nothing is a different statement from a rule that does not exist,
 * and a standard whose inapplicable parts vanish looks tailored to the data
 * rather than applied to it.
 */
export default function CleaningSteps({
  projectId,
  streams,
}: {
  projectId: number;
  streams: LayerStream[];
}) {
  const sources = streams.filter((stream) => stream.source_id !== null);
  const [sourceId, setSourceId] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['cleaning-steps', projectId, sourceId],
    queryFn: () => getCleaningSteps(projectId, { sourceId }),
    retry: false,
  });

  return (
    <section className="rounded-lg border border-slate-700 bg-slate-900/40">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 px-5 py-4">
        <div>
          <h3 className="text-base font-semibold text-slate-100">
            What the cleaning did, step by step
          </h3>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">
            The same standard runs on every source, in this order. Each step shows the table
            right after that rule, with the cells it changed marked.
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
      </header>

      <div className="px-5 py-4">
        {isLoading && <Spinner />}

        {error != null && !isLoading && (
          <p className="text-sm text-slate-500">
            Nothing has been through the layers yet. Run an extraction and every step will
            appear here.
          </p>
        )}

        {data && (
          <>
            <p className="mb-4 text-xs text-slate-500">
              {data.rows_in.toLocaleString()} rows in, {data.rows_out.toLocaleString()} out.
              {/* Said plainly: the rules decide over the whole extraction, and
                  only the tables below are a sample. Otherwise a reader could
                  reasonably think the type was inferred from eight rows. */}{' '}
              Each rule was decided over the whole extraction; the tables below show the
              first {data.sample}.
            </p>

            <ol className="space-y-3">
              {data.steps.map((step, index) => (
                <Step key={step.rule || 'arrived'} step={step} number={index} />
              ))}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}

const TIER_LABEL: Record<string, string> = {
  structural: 'structural',
  categorical: 'categorical',
  domain: 'health',
};

function Step({ step, number }: { step: CleaningStep; number: number }) {
  const isStart = step.rule === '';
  // Open the steps that did something. A reader scrolling this wants the
  // changes; the rules that found nothing are evidence the standard ran, which
  // is worth keeping and not worth unfolding.
  const [open, setOpen] = useState(isStart || step.changed);

  return (
    <li
      className={`rounded-lg border ${
        step.changed || isStart ? 'border-slate-700 bg-slate-900' : 'border-slate-800/70'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 text-left"
      >
        <span className="font-mono text-xs text-slate-600">{number}</span>
        {step.tier && (
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
            {TIER_LABEL[step.tier] ?? step.tier}
          </span>
        )}
        <span
          className={`text-sm font-medium ${
            step.changed || isStart ? 'text-slate-100' : 'text-slate-500'
          }`}
        >
          {step.title}
        </span>
        <Counts step={step} />
      </button>

      {open && (
        <div className="border-t border-slate-800 px-4 py-3">
          {step.note && <p className="mb-2 text-xs text-slate-500">{step.note}</p>}

          {step.removed_rows.length > 0 && (
            <div className="mb-3">
              <p className="mb-1 text-xs text-rose-300">
                Removed {step.removed_rows.length === 1 ? 'this row' : 'these rows'}:
              </p>
              <Table
                columns={step.preview_columns}
                rows={step.removed_rows}
                tone="removed"
              />
            </div>
          )}

          <Table
            columns={step.preview_columns}
            rows={step.preview_rows}
            changed={step.changed_cells}
          />
        </div>
      )}
    </li>
  );
}

function Counts({ step }: { step: CleaningStep }) {
  const parts: string[] = [];
  if (step.cells_changed) parts.push(`${step.cells_changed.toLocaleString()} values`);
  if (!step.cells_changed && step.columns.length)
    parts.push(`${step.columns.length} ${step.columns.length === 1 ? 'column' : 'columns'}`);
  if (step.rows_removed) parts.push(`${step.rows_removed.toLocaleString()} rows removed`);
  if (step.columns_removed) parts.push(`${step.columns_removed} columns dropped`);

  return (
    <span className="ml-auto flex items-center gap-2 text-xs">
      {parts.length > 0 && <span className="text-slate-400">{parts.join(' · ')}</span>}
      {step.flagged > 0 && (
        // Flagged, not fixed — and the wording says so, because the value is
        // still in the data and somebody has to look at it.
        <span className="text-amber-400">
          {step.flagged.toLocaleString()} flagged, left in place
        </span>
      )}
      {!step.changed && step.rule && <span className="text-slate-600">nothing to do</span>}
    </span>
  );
}

function Table({
  columns,
  rows,
  changed,
  tone,
}: {
  columns: string[];
  rows: unknown[][];
  changed?: boolean[][];
  tone?: 'removed';
}) {
  if (rows.length === 0) {
    return <p className="text-xs text-slate-600">No rows.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-xs">
        <thead>
          <tr className="border-b border-slate-800">
            {columns.map((column) => (
              <th key={column} className="px-2 py-1 font-medium text-slate-300">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className={`border-b border-slate-800/50 ${
                tone === 'removed' ? 'bg-rose-950/30 line-through' : ''
              }`}
            >
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={`px-2 py-1 ${
                    changed?.[rowIndex]?.[cellIndex]
                      ? 'bg-emerald-900/40 text-emerald-100'
                      : 'text-slate-400'
                  }`}
                >
                  <Cell value={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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
