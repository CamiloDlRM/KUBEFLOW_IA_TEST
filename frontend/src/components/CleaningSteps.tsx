import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCleaningSteps } from '../api/client';
import type { CleaningColumn, CleaningRow, CleaningStep, LayerStream } from '../types';
import Spinner from './Spinner';

/**
 * The cleaning standard, a rule at a time, each one shown as a diff.
 *
 * This used to sit above a second section that put bronze and silver side by
 * side for the whole extraction. Two views of one transition is one too many,
 * and the steps were the weaker of the pair: they showed the table *after*
 * each rule with the changed cells tinted, which tells you where something
 * happened but never what it was. A tinted `"Hospice care"` is not evidence of
 * anything until you can see the `"  Hospice  care "` it replaced.
 *
 * So the diff moved in here, and now each rule gets the shape everyone already
 * knows from a code review: a removed line, an added line, and only the parts
 * that differ highlighted. The difference from the old section is the unit —
 * one rule rather than the whole cleaning — which is what makes the highlight
 * mean something specific instead of "this cell changed at some point".
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
            The same standard runs on every source, in this order. Each step shows the rows
            it touched before and after, so the first is{' '}
            <span className="text-amber-300">bronze</span> and the last is{' '}
            <span className="text-slate-200">silver</span>.
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
            <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
              <Legend tone="value" label="value corrected" />
              <Legend tone="type" label="type applied" />
              <Legend tone="null" label="emptied to null" />
              <Legend tone="removed" label="row removed" />
            </div>

            <p className="mb-4 text-xs text-slate-500">
              {data.rows_in.toLocaleString()} rows in, {data.rows_out.toLocaleString()} out.
              {/* Said plainly: the rules decide over the whole extraction, and
                  only the tables below are a sample. Otherwise a reader could
                  reasonably think the type was inferred from eight rows. The
                  numbers in the first column are where each row arrived, which
                  is also why they are not 1 to 8. */}{' '}
              Each rule was decided over the whole extraction. The {data.sample} rows below
              are the ones the rules acted on, numbered by where they arrived.
            </p>

            <ol className="space-y-3">
              {data.steps.map((step, index) => (
                <Step
                  key={step.rule || 'arrived'}
                  step={step}
                  number={index}
                  last={index === data.steps.length - 1}
                />
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

/**
 * What kind of change a rule makes, which decides how its cells are tinted.
 *
 * A cast gets its own colour because `"44"` and `44` are the same two glyphs:
 * tinting them like a corrected value would claim the text moved when only the
 * type did. Emptying a placeholder to null gets a quieter one, because nothing
 * was corrected — a value that never meant anything was admitted to be absent.
 */
const TONE_BY_RULE: Record<string, Tone> = {
  cast_types: 'type',
  sentinel_nulls: 'null',
};

type Tone = 'value' | 'type' | 'null';

function Step({ step, number, last }: { step: CleaningStep; number: number; last: boolean }) {
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
        {/* The two ends of the standard are the two layers, said once each so
            the reader knows which table they are looking at. */}
        {isStart && (
          <span className="rounded bg-amber-950/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
            bronze
          </span>
        )}
        {last && !isStart && (
          <span className="rounded bg-slate-700/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-200">
            silver
          </span>
        )}
        <Counts step={step} />
      </button>

      {open && (
        <div className="border-t border-slate-800 px-4 py-3">
          {step.note && <p className="mb-2 text-xs text-slate-500">{step.note}</p>}
          {/* The preview is chosen to include the rows each rule acted on, but
              a rule late in the standard can find every slot taken. Saying so
              is better than a count above a table where nothing happened,
              which reads as a bug and was one. */}
          {step.cells_changed > 0 &&
            !step.preview_rows.some((row) => row.cells.includes('changed')) && (
              <p className="mb-2 text-xs text-amber-400/80">
                The {step.cells_changed.toLocaleString()} values this rule changed are
                outside the rows shown.
              </p>
            )}
          <StepTable step={step} />
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

function StepTable({ step }: { step: CleaningStep }) {
  if (step.preview_rows.length === 0) {
    return <p className="text-xs text-slate-600">No rows.</p>;
  }

  const tone = TONE_BY_RULE[step.rule] ?? 'value';

  return (
    <div className="overflow-x-auto rounded border border-slate-800">
      <table className="min-w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-slate-700 bg-slate-900/60">
            <th className="px-2 py-1.5 font-normal text-slate-600">#</th>
            {step.preview_columns.map((column, index) => (
              <ColumnHeader key={index} column={column} />
            ))}
          </tr>
        </thead>
        <tbody>
          {step.preview_rows.map((row) => (
            <Rows key={row.row} row={row} columns={step.preview_columns} tone={tone} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ColumnHeader({ column }: { column: CleaningColumn }) {
  if (column.change === 'dropped') {
    return (
      <th className="px-2 py-1.5 font-medium">
        <span className="text-slate-500 line-through">{column.before}</span>
        <span className="ml-1.5 block font-mono text-[10px] font-normal text-rose-400/70">
          dropped
        </span>
      </th>
    );
  }
  if (column.change === 'renamed') {
    return (
      <th className="px-2 py-1.5 font-medium">
        <span className="text-slate-500 line-through">{column.before}</span>
        <span className="mx-1 text-slate-600">→</span>
        <span className="text-emerald-300">{column.after}</span>
      </th>
    );
  }
  return (
    <th className="px-2 py-1.5 font-medium text-slate-200">{column.after ?? column.before}</th>
  );
}

/**
 * One source row as up to two table rows: what the rule found, and what it
 * left. A row it did not touch collapses to a single line, the way a diff
 * shows unchanged context once.
 */
function Rows({
  row,
  columns,
  tone,
}: {
  row: CleaningRow;
  columns: CleaningColumn[];
  tone: Tone;
}) {
  if (row.removed) {
    return (
      <tr className="border-b border-slate-800/60 bg-rose-950/30">
        <td className="px-2 py-1 font-mono text-[10px] text-rose-400">−{row.row}</td>
        {columns.map((_, index) => (
          <td key={index} className="px-2 py-1 text-rose-200/60 line-through">
            <Cell value={row.before[index]} />
          </td>
        ))}
      </tr>
    );
  }

  // A dropped column is stated once, in the header. Repeating it on every row
  // would turn a rule that removed one empty column into a table where every
  // row appears rewritten.
  const touched = row.cells.some((cell) => cell === 'changed');
  if (!touched) {
    return (
      <tr className="border-b border-slate-800/60">
        <td className="px-2 py-1 font-mono text-[10px] text-slate-700">{row.row}</td>
        {columns.map((column, index) => (
          <td key={index} className="px-2 py-1 text-slate-400">
            {column.change === 'dropped' ? (
              <span className="text-slate-700">—</span>
            ) : (
              <Cell value={row.after[index]} />
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
        {columns.map((_, index) => (
          <td
            key={index}
            className={`px-2 py-1 ${
              row.cells[index] === 'changed'
                ? 'bg-rose-900/30 text-rose-100'
                : 'text-amber-200/50'
            }`}
          >
            <Cell value={row.before[index]} />
          </td>
        ))}
      </tr>
      <tr className="border-b border-slate-800/60 bg-slate-700/15">
        <td className="px-2 py-1 font-mono text-[10px] text-slate-400">+{row.row}</td>
        {columns.map((column, index) => (
          <td
            key={index}
            className={`px-2 py-1 ${
              row.cells[index] === 'changed' ? CHANGED[tone] : 'text-slate-300'
            }`}
          >
            {column.change === 'dropped' ? (
              <span className="text-slate-700">—</span>
            ) : (
              <Cell value={row.after[index]} />
            )}
          </td>
        ))}
      </tr>
    </>
  );
}

const CHANGED: Record<Tone, string> = {
  value: 'bg-emerald-900/30 text-emerald-100',
  type: 'bg-sky-900/25 text-sky-100',
  null: 'bg-emerald-900/20 text-slate-500',
};

/**
 * One value, quoted and with its whitespace intact.
 *
 * Unquoted, the change this view most often shows — two spaces becoming one —
 * is invisible, because HTML collapses runs of whitespace. Quoting is also
 * what makes a cast legible: `"44"` and `44` differ only by the marks.
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

function Legend({ tone, label }: { tone: Tone | 'removed'; label: string }) {
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
