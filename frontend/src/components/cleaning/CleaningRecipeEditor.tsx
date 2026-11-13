import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, RotateCcw, TriangleAlert, X } from 'lucide-react';
import { getCleaningRecipe, previewCleaning, previewLayer, saveCleaningRecipe } from '../../api/client';
import type { CleaningRecipe, CleaningRule, LayerStream, MeasureRange } from '../../types';
import Spinner from '../Spinner';
import { StepsView } from '../CleaningSteps';
import ChipsInput from './ChipsInput';
import { lossyWarnings, patternLabel, sameRecipe, sendable } from './recipe';

/**
 * How a source is cleaned, chosen by the person who owns it.
 *
 * The standard is the starting point and stays the default: every rule is
 * listed, on, with its settings, and a source only departs from it where
 * someone decides to. A change is tried on the source's latest extraction —
 * the same step-by-step view, with the draft instead of what ran — before it
 * is saved, because a cleaning rule is the kind of thing whose consequence is
 * only obvious on real rows.
 *
 * The two options that can lose data say so in amber while they are being
 * set, and again on every report made with them.
 */

const TIER_LABEL: Record<string, string> = {
  structural: 'Structural',
  categorical: 'Categorical',
  domain: 'Health',
};

/** Rules with settings beyond on and off. */
const WITH_OPTIONS = new Set([
  'sentinel_nulls',
  'cast_types',
  'deduplicate_rows',
  'fold_categories',
  'standardise_sex',
  'flag_implausible_measurements',
]);

const FIELD =
  'rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 focus:border-brand-500 focus:outline-none';

export default function CleaningRecipeEditor({
  projectId,
  streams,
}: {
  projectId: number;
  streams: LayerStream[];
}) {
  const sources = streams.filter((stream): stream is LayerStream & { source_id: number } => stream.source_id !== null);
  const [sourceId, setSourceId] = useState<number | null>(sources[0]?.source_id ?? null);
  useEffect(() => {
    if (sourceId === null && sources[0]) setSourceId(sources[0].source_id);
  }, [sourceId, sources]);

  if (sources.length === 0 || sourceId === null) return null;

  return (
    <section aria-label="Cleaning recipe" className="rounded-lg border border-slate-700 bg-slate-900/40">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 px-5 py-4">
        <div>
          <h3 className="text-base font-semibold text-slate-100">How this source is cleaned</h3>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">
            The platform standard, unless you change it. Turn rules off, set their options, try the
            result on the latest extraction, then save. It applies to what lands from now on.
          </p>
        </div>
        {sources.length > 1 && (
          <label className="flex items-center gap-2 text-xs text-slate-400">
            Source
            <select
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
              value={sourceId}
              onChange={(event) => setSourceId(Number(event.target.value))}
            >
              {sources.map((stream) => (
                <option key={stream.source_id} value={stream.source_id}>
                  {stream.source_name}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>
      {/* Keyed by source, so switching sources starts from that source's recipe. */}
      <SourceRecipe key={sourceId} projectId={projectId} sourceId={sourceId} />
    </section>
  );
}

function SourceRecipe({ projectId, sourceId }: { projectId: number; sourceId: number }) {
  const queryClient = useQueryClient();
  const { data: state, isLoading, error } = useQuery({
    queryKey: ['cleaning-recipe', sourceId],
    queryFn: () => getCleaningRecipe(sourceId),
  });
  // The source's columns, as silver names them, to pick from.
  const { data: silver } = useQuery({
    queryKey: ['layer-peek', projectId, 'silver', sourceId, null],
    queryFn: () => previewLayer(projectId, 'silver', { sourceId, limit: 1 }),
    retry: false,
    staleTime: 60_000,
  });
  const columns = (silver?.columns ?? []).map((column) => column.name);

  const [draft, setDraft] = useState<CleaningRecipe | null>(null);
  useEffect(() => {
    if (state) setDraft(state.recipe);
  }, [state]);

  const preview = useMutation({ mutationFn: (recipe: CleaningRecipe) => previewCleaning(projectId, sourceId, recipe) });
  const save = useMutation({
    mutationFn: (body: { recipe: CleaningRecipe } | { reset: true }) => saveCleaningRecipe(sourceId, body),
    onSuccess: (saved) => {
      queryClient.setQueryData(['cleaning-recipe', sourceId], saved);
      setDraft(saved.recipe);
      preview.reset();
    },
  });

  if (isLoading || !draft || !state) {
    return (
      <div className="px-5 py-6">
        {error ? <p className="text-sm text-red-300">{(error as Error).message}</p> : <Spinner />}
      </div>
    );
  }

  const changed = !sameRecipe(draft, state.recipe);
  const warnings = lossyWarnings(draft);
  const update = (patch: Partial<CleaningRecipe>) => {
    setDraft({ ...draft, ...patch });
    preview.reset();
  };
  const toggle = (rule: string, on: boolean) =>
    update({ disabled: on ? draft.disabled.filter((name) => name !== rule) : [...draft.disabled, rule] });

  const tiers = ['structural', 'categorical', 'domain'] as const;

  return (
    <div className="space-y-5 px-5 py-4">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {state.mode === 'standard' && !changed ? (
          <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-slate-300">Platform standard</span>
        ) : (
          <span className="rounded-full bg-brand-600/25 px-2.5 py-0.5 text-brand-200">
            {state.mode === 'custom' ? 'Custom recipe' : 'Standard, with unsaved changes'}
          </span>
        )}
        {state.mode === 'custom' && (
          <button
            type="button"
            onClick={() => save.mutate({ reset: true })}
            disabled={save.isPending}
            className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-200 disabled:opacity-40"
          >
            <RotateCcw size={12} aria-hidden="true" /> Back to the standard
          </button>
        )}
      </div>

      {tiers.map((tier) => (
        <div key={tier}>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{TIER_LABEL[tier]}</h4>
          <ul className="space-y-2">
            {state.rules
              .filter((rule) => rule.tier === tier)
              .map((rule) => (
                <RuleRow
                  key={rule.name}
                  rule={rule}
                  on={!draft.disabled.includes(rule.name)}
                  onToggle={(on) => toggle(rule.name, on)}
                >
                  <RuleOptions rule={rule.name} draft={draft} update={update} columns={columns} types={state.forceable_types} />
                </RuleRow>
              ))}
          </ul>
        </div>
      ))}

      {warnings.length > 0 && (
        <ul
          aria-label="Lossy options"
          className="space-y-1 rounded-lg border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200"
        >
          {warnings.map((warning) => (
            <li key={warning} className="flex gap-1.5">
              <TriangleAlert size={13} className="mt-px shrink-0" aria-hidden="true" />
              {warning}
            </li>
          ))}
        </ul>
      )}

      {(save.isError || preview.isError) && (
        <p className="text-xs text-red-300">{((save.error ?? preview.error) as Error).message}</p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-800 pt-4">
        {changed && (
          <button
            type="button"
            onClick={() => {
              setDraft(state.recipe);
              preview.reset();
            }}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
          >
            Discard changes
          </button>
        )}
        <button
          type="button"
          onClick={() => preview.mutate(sendable(draft))}
          disabled={preview.isPending}
          className="flex items-center gap-2 rounded-lg border border-brand-500/60 px-3 py-1.5 text-sm text-brand-200 hover:bg-brand-600/15 disabled:opacity-50"
        >
          {preview.isPending && <Spinner size="sm" />}
          Try it on the latest extraction
        </button>
        <button
          type="button"
          onClick={() => save.mutate({ recipe: sendable(draft) })}
          disabled={!changed || save.isPending}
          className="flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-40"
        >
          {save.isPending && <Spinner size="sm" />}
          Save recipe
        </button>
      </div>

      {save.isSuccess && !changed && (
        <p className="text-xs text-emerald-300">
          Saved. It applies to what lands from now on; what is already in silver keeps the recipe it was cleaned with.
        </p>
      )}

      {preview.data && (
        <section aria-label="Preview" className="rounded-lg border border-brand-500/40 bg-slate-950/40 p-4">
          <h4 className="mb-3 text-sm font-semibold text-slate-100">
            Preview — what this recipe would do to the latest extraction. Nothing is saved.
          </h4>
          <StepsView data={preview.data} />
        </section>
      )}
    </div>
  );
}

function RuleRow({
  rule,
  on,
  onToggle,
  children,
}: {
  rule: CleaningRule;
  on: boolean;
  onToggle: (on: boolean) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const hasOptions = WITH_OPTIONS.has(rule.name);
  return (
    <li className={`rounded-lg border ${on ? 'border-slate-700 bg-slate-900' : 'border-slate-800/70 bg-slate-950/40'}`}>
      <div className="flex items-start gap-3 px-3 py-2.5">
        <input
          type="checkbox"
          checked={on}
          onChange={(event) => onToggle(event.target.checked)}
          aria-label={`Run "${rule.title}"`}
          className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-900 text-brand-500 focus:ring-brand-500"
        />
        <div className="min-w-0 flex-1">
          <p className={`text-sm ${on ? 'text-slate-100' : 'text-slate-500 line-through decoration-slate-600'}`}>{rule.title}</p>
          <p className="text-xs text-slate-500">{rule.summary}</p>
        </div>
        {hasOptions && on && (
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            className="inline-flex shrink-0 items-center gap-1 text-xs text-slate-400 hover:text-slate-200"
          >
            Options <ChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
          </button>
        )}
      </div>
      {hasOptions && on && open && <div className="space-y-3 border-t border-slate-800 px-3 py-3">{children}</div>}
    </li>
  );
}

function RuleOptions({
  rule,
  draft,
  update,
  columns,
  types,
}: {
  rule: string;
  draft: CleaningRecipe;
  update: (patch: Partial<CleaningRecipe>) => void;
  columns: string[];
  types: string[];
}) {
  switch (rule) {
    case 'sentinel_nulls':
      return (
        <ChipsInput
          label="Strings that mean “no value” (compared trimmed and lowercased)"
          values={draft.null_tokens}
          onChange={(null_tokens) => update({ null_tokens: null_tokens.map((token) => token.toLowerCase()) })}
          placeholder="n/a, -, null…"
        />
      );
    case 'cast_types':
      return (
        <>
          <ChipsInput
            label="Columns always kept as text (identifiers, codes)"
            values={draft.keep_as_text}
            onChange={(keep_as_text) => update({ keep_as_text })}
            suggestions={columns}
            placeholder="column name"
          />
          <ForcedTypes draft={draft} update={update} columns={columns} types={types} />
        </>
      );
    case 'deduplicate_rows':
      return <DedupeOptions draft={draft} update={update} columns={columns} />;
    case 'fold_categories':
      return (
        <>
          <label className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            A column counts as categorical with at most
            <input
              type="number"
              min={2}
              max={100000}
              value={draft.categorical_max_distinct}
              onChange={(event) => update({ categorical_max_distinct: Number(event.target.value) || 2 })}
              aria-label="Most distinct values for a categorical column"
              className={`${FIELD} w-24`}
            />
            distinct values
          </label>
          <ChipsInput
            label="Columns never unified"
            values={draft.fold_skip}
            onChange={(fold_skip) => update({ fold_skip })}
            suggestions={columns}
            placeholder="column name"
          />
        </>
      );
    case 'standardise_sex':
      return (
        <fieldset className="space-y-2 text-xs text-slate-300">
          <legend className="sr-only">Which columns hold sex</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={draft.sex_columns === null}
              onChange={() => update({ sex_columns: null })}
            />
            Recognise them by name (sex, sexo, gender, género)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={draft.sex_columns !== null}
              onChange={() => update({ sex_columns: draft.sex_columns ?? [] })}
            />
            Only these columns
          </label>
          {draft.sex_columns !== null && (
            <ChipsInput
              label="Sex columns"
              values={draft.sex_columns}
              onChange={(sex_columns) => update({ sex_columns })}
              suggestions={columns}
              placeholder="column name"
            />
          )}
        </fieldset>
      );
    case 'flag_implausible_measurements':
      return <RangesEditor draft={draft} update={update} columns={columns} />;
    default:
      return null;
  }
}

function ForcedTypes({
  draft,
  update,
  columns,
  types,
}: {
  draft: CleaningRecipe;
  update: (patch: Partial<CleaningRecipe>) => void;
  columns: string[];
  types: string[];
}) {
  const [adding, setAdding] = useState({ column: '', kind: 'integer' });
  const entries = Object.entries(draft.force_types);
  const set = (next: Record<string, string>) => update({ force_types: next });
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-400">
        Force a type on a column. <span className="text-amber-300">Values that do not fit become null.</span>
      </p>
      {entries.map(([column, kind]) => (
        <div key={column} className="flex items-center gap-2 text-xs">
          <span className="w-40 truncate font-display text-slate-200">{column}</span>
          <select
            aria-label={`Type forced on ${column}`}
            value={kind}
            onChange={(event) => set({ ...draft.force_types, [column]: event.target.value })}
            className={FIELD}
          >
            {types.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label={`Stop forcing ${column}`}
            onClick={() => set(Object.fromEntries(entries.filter(([name]) => name !== column)))}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            <X size={14} />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <input
          aria-label="Column to force"
          list="force-type-columns"
          value={adding.column}
          onChange={(event) => setAdding({ ...adding, column: event.target.value })}
          placeholder="column name"
          className={`${FIELD} w-40`}
        />
        <datalist id="force-type-columns">
          {columns.filter((column) => !(column in draft.force_types)).map((column) => (
            <option key={column} value={column} />
          ))}
        </datalist>
        <select
          aria-label="Type to force"
          value={adding.kind}
          onChange={(event) => setAdding({ ...adding, kind: event.target.value })}
          className={FIELD}
        >
          {types.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!adding.column.trim()}
          onClick={() => {
            set({ ...draft.force_types, [adding.column.trim()]: adding.kind });
            setAdding({ column: '', kind: adding.kind });
          }}
          className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
        >
          Force type
        </button>
      </div>
    </div>
  );
}

function DedupeOptions({
  draft,
  update,
  columns,
}: {
  draft: CleaningRecipe;
  update: (patch: Partial<CleaningRecipe>) => void;
  columns: string[];
}) {
  const [byKey, setByKey] = useState(draft.dedupe_on.length > 0);
  return (
    <fieldset className="space-y-2 text-xs text-slate-300">
      <legend className="sr-only">What counts as a duplicate</legend>
      <label className="flex items-center gap-2">
        <input
          type="radio"
          checked={!byKey}
          onChange={() => {
            setByKey(false);
            update({ dedupe_on: [] });
          }}
        />
        Only rows identical in every column (the standard)
      </label>
      <label className="flex items-center gap-2">
        <input type="radio" checked={byKey} onChange={() => setByKey(true)} />
        Rows that match on these key columns{' '}
        <span className="text-amber-300">— keeps the first, even where other columns differ</span>
      </label>
      {byKey && (
        <ChipsInput
          label="Key columns"
          values={draft.dedupe_on}
          onChange={(dedupe_on) => update({ dedupe_on })}
          suggestions={columns}
          placeholder="patient_id"
        />
      )}
    </fieldset>
  );
}

function RangesEditor({
  draft,
  update,
  columns,
}: {
  draft: CleaningRecipe;
  update: (patch: Partial<CleaningRecipe>) => void;
  columns: string[];
}) {
  const set = (index: number, patch: Partial<MeasureRange>) =>
    update({ ranges: draft.ranges.map((range, i) => (i === index ? { ...range, ...patch } : range)) });
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-400">
        A value outside its range is counted, never changed. A range for an exact column wins over one matched by
        name.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1 pr-2 font-normal">Applies to</th>
              <th className="py-1 pr-2 font-normal">Unit</th>
              <th className="py-1 pr-2 font-normal">Low</th>
              <th className="py-1 pr-2 font-normal">High</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {draft.ranges.map((range, index) => (
              <tr key={index}>
                <td className="py-1 pr-2">
                  {!range.pattern ? (
                    <input
                      aria-label={`Range ${index + 1} column`}
                      list="range-columns"
                      value={range.column}
                      onChange={(event) => set(index, { column: event.target.value })}
                      className={`${FIELD} w-44`}
                    />
                  ) : (
                    <span
                      className="block max-w-[16rem] truncate text-slate-400"
                      title={`Any column named like this (pattern ${range.pattern})`}
                    >
                      <span className="text-slate-600">named </span>
                      {patternLabel(range.pattern)}
                    </span>
                  )}
                </td>
                <td className="py-1 pr-2">
                  <input
                    aria-label={`Range ${index + 1} unit`}
                    value={range.unit}
                    onChange={(event) => set(index, { unit: event.target.value })}
                    className={`${FIELD} w-20`}
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    aria-label={`Range ${index + 1} low`}
                    type="number"
                    step="any"
                    value={range.low}
                    onChange={(event) => set(index, { low: Number(event.target.value) })}
                    className={`${FIELD} w-20`}
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    aria-label={`Range ${index + 1} high`}
                    type="number"
                    step="any"
                    value={range.high}
                    onChange={(event) => set(index, { high: Number(event.target.value) })}
                    className={`${FIELD} w-20`}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    aria-label={`Remove range ${index + 1}`}
                    onClick={() => update({ ranges: draft.ranges.filter((_, i) => i !== index) })}
                    className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  >
                    <X size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="range-columns">
          {columns.map((column) => (
            <option key={column} value={column} />
          ))}
        </datalist>
      </div>
      <button
        type="button"
        onClick={() => update({ ranges: [{ column: '', unit: '', low: 0, high: 1 }, ...draft.ranges] })}
        className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
      >
        + Range for a column
      </button>
    </div>
  );
}
