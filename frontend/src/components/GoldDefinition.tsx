import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getGoldRelations,
  previewGold,
  setGoldDefinition,
  suggestGold,
} from '../api/client';
import type { GoldPreview, LayerSummary } from '../types';
import Spinner from './Spinner';

/**
 * Writing the query that defines gold, with the model's help.
 *
 * The order of this panel is the argument it makes. The schema comes first,
 * because that is what a query can be written against. Then the description,
 * then the SQL the model wrote — which is editable, because it is a draft and
 * not an answer. Then the result of actually running it, with its row count
 * beside the row counts of its inputs. Saving is last and is the only step
 * that changes anything.
 *
 * The model never sees the data and never returns rows. It returns a query,
 * the platform runs it, and the user reads the result before deciding. That
 * ordering is what makes this checkable rather than something to be trusted.
 */
export default function GoldDefinition({
  repoId,
  summary,
}: {
  repoId: number;
  summary: LayerSummary;
}) {
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState('');
  const [sql, setSql] = useState(summary.sql);
  const [explanation, setExplanation] = useState('');
  const [preview, setPreview] = useState<GoldPreview | null>(null);
  const [saved, setSaved] = useState(false);

  const { data: relations } = useQuery({
    queryKey: ['gold-relations', repoId],
    queryFn: () => getGoldRelations(repoId),
  });

  const suggest = useMutation({
    mutationFn: () => suggestGold(repoId, question),
    onSuccess: (result) => {
      setExplanation(result.explanation || result.error);
      if (result.sql) {
        setSql(result.sql);
        setPreview(null);
        setSaved(false);
      }
    },
  });

  const tryIt = useMutation({
    mutationFn: () => previewGold(repoId, sql),
    onSuccess: (result) => {
      setPreview(result);
      setSaved(false);
    },
  });

  const save = useMutation({
    mutationFn: () => setGoldDefinition(repoId, sql),
    onSuccess: () => {
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ['medallion', repoId] });
    },
  });

  const relationNames = Object.keys(relations?.relations ?? {});

  return (
    <div className="border-t border-yellow-900/40 bg-yellow-950/10 px-5 py-5">
      <h4 className="text-sm font-semibold text-yellow-100">How gold is built</h4>
      <p className="mt-1 max-w-3xl text-xs text-yellow-200/70">
        {summary.is_default_definition
          ? 'This project has no definition of its own yet, so gold is everything its sources have landed, stacked together. Describe the table you want and it will be written as a query.'
          : 'Gold is built by this query on every extraction. Change it and the next run uses the new one.'}
      </p>

      {/* 1. What can be queried */}
      {relationNames.length > 0 && (
        <details className="mt-4 rounded border border-yellow-900/40 bg-slate-900/40 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-yellow-200">
            What you can query ({relationNames.length}{' '}
            {relationNames.length === 1 ? 'table' : 'tables'} in silver)
          </summary>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            {relationNames.map((name) => (
              <div key={name}>
                <p className="font-mono text-xs text-yellow-100">
                  {name}{' '}
                  <span className="text-slate-500">
                    ({relations!.relations[name].rows.toLocaleString()} rows)
                  </span>
                </p>
                <ul className="mt-1 space-y-0.5">
                  {relations!.relations[name].columns.map((column) => (
                    <li key={column.name} className="font-mono text-[11px] text-slate-400">
                      {column.name}{' '}
                      <span className="text-slate-600">{column.type.toLowerCase()}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* 2. Describe it */}
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="min-w-[18rem] flex-1 text-xs text-slate-400">
          Describe the table you want
          <input
            type="text"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="one row per patient, with their number of procedures and total cost"
            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-600"
          />
        </label>
        <button
          type="button"
          onClick={() => suggest.mutate()}
          disabled={question.trim().length < 3 || suggest.isPending}
          className="rounded bg-yellow-700/80 px-3 py-1.5 text-sm font-medium text-yellow-50 hover:bg-yellow-600/80 disabled:opacity-40"
        >
          {suggest.isPending ? 'Writing the query…' : 'Write the query'}
        </button>
      </div>

      {explanation && <p className="mt-2 text-xs text-yellow-200/80">{explanation}</p>}

      {/* 3. The query itself — a draft, not an answer */}
      <label className="mt-4 block text-xs text-slate-400">
        The query that builds gold
        <textarea
          value={sql}
          onChange={(event) => {
            setSql(event.target.value);
            setPreview(null);
            setSaved(false);
          }}
          rows={6}
          spellCheck={false}
          placeholder={relations?.default_sql ?? 'SELECT …'}
          className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-600"
        />
      </label>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => tryIt.mutate()}
          disabled={!sql.trim() || tryIt.isPending}
          className="rounded border border-yellow-700/60 px-3 py-1.5 text-sm text-yellow-100 hover:bg-yellow-900/30 disabled:opacity-40"
        >
          {tryIt.isPending ? 'Running…' : 'Run it'}
        </button>
        <button
          type="button"
          onClick={() => save.mutate()}
          /* Deliberately gated on having run it. A definition that has never
             been executed is the one that silently returns nothing, and this
             one becomes the table every model trains on. */
          disabled={!preview || save.isPending}
          className="rounded bg-yellow-600 px-3 py-1.5 text-sm font-medium text-yellow-950 hover:bg-yellow-500 disabled:opacity-40"
          title={preview ? '' : 'Run the query first, so you can see what it returns'}
        >
          {save.isPending ? 'Saving…' : 'Use this definition'}
        </button>
        {sql.trim() !== '' && (
          <button
            type="button"
            onClick={() => {
              setSql('');
              setPreview(null);
              save.mutate();
            }}
            className="text-xs text-slate-400 underline hover:text-slate-200"
          >
            Back to the default
          </button>
        )}
        {saved && (
          <span className="text-xs text-yellow-200">
            Saved. It builds on the next extraction.
          </span>
        )}
      </div>

      {tryIt.isError && (
        <p className="mt-2 rounded border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-200">
          {errorMessage(tryIt.error)}
        </p>
      )}

      {/* 4. What it actually returns */}
      {preview && (
        <div className="mt-4 rounded border border-yellow-900/40 bg-slate-950/60 p-3">
          <p className="text-xs text-yellow-100">
            {preview.total_rows.toLocaleString()} rows, {preview.columns.length} columns
            {preview.total_rows === 0 && (
              /* The most common way an AI-written query goes wrong: it parses,
                 it runs, and it returns nothing. Saying what the inputs held
                 separates "the query is wrong" from "there was no data". */
              <span className="ml-2 text-amber-300">
                — nothing came back, and the inputs were not empty (
                {Object.entries(preview.relations)
                  .map(([name, rows]) => `${name}: ${rows.toLocaleString()}`)
                  .join(', ')}
                ). The query is probably filtering or joining too hard.
              </span>
            )}
          </p>
          {preview.rows.length > 0 && (
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-yellow-900/50">
                    {preview.columns.map((column) => (
                      <th key={column} className="px-2 py-1.5 font-medium text-yellow-100">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, index) => (
                    <tr key={index} className="border-b border-slate-800/60">
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex} className="px-2 py-1.5 text-slate-300">
                          {cell === null || cell === undefined ? (
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
          )}
        </div>
      )}

      {suggest.isPending && (
        <div className="mt-3">
          <Spinner />
        </div>
      )}
    </div>
  );
}

function errorMessage(error: unknown): string {
  const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  if (detail) return detail;
  return error instanceof Error ? error.message : 'The query could not be run.';
}
