import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createSource,
  deleteSource,
  getIngestionRuns,
  getSources,
  runIngestion,
  type CreateSourceRequest,
} from '../api/client';
import type { DataSource, IngestionRun, NormalizationSummary } from '../types';
import Spinner from './Spinner';

/**
 * Connecting an external system and extracting from it.
 *
 * This is the production path for getting data in: the platform reads from the
 * system that already holds the data, incrementally, instead of waiting for
 * somebody to export a file. The upload panel beside it stays as the quick way
 * to try something — the two are deliberately not presented as equals.
 *
 * The form asks for the *name* of an environment variable rather than a
 * password, which is unusual enough to be worth saying out loud in the UI: no
 * credential travels through the browser, and none is stored.
 */
export default function SourcesPanel({ repoId }: { repoId: number }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data: sources, isLoading } = useQuery({
    queryKey: ['sources'],
    queryFn: getSources,
  });

  const mine = (sources ?? []).filter((source) => source.repo_id === repoId);

  const ingest = useMutation({
    mutationFn: (sourceId: number) => runIngestion(sourceId),
    onSuccess: (_run, sourceId) => {
      queryClient.invalidateQueries({ queryKey: ['ingestion-runs', sourceId] });
      queryClient.invalidateQueries({ queryKey: ['datasets', repoId] });
    },
  });

  const remove = useMutation({
    mutationFn: (sourceId: number) => deleteSource(sourceId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sources'] }),
  });

  return (
    <section className="rounded-lg border border-slate-700 bg-slate-900/40">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 px-5 py-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-base font-semibold text-slate-100">
            <DatabaseIcon />
            Connect an external source
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Extract from a system that already holds the data — a hospital
            database, a warehouse. Each run brings only what was recorded since
            the last one, profiles it and fills in missing codes.
          </p>
        </div>
        <button
          onClick={() => setShowForm((open) => !open)}
          className="shrink-0 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-500"
        >
          {showForm ? 'Cancel' : 'Add source'}
        </button>
      </header>

      {showForm && (
        <SourceForm
          repoId={repoId}
          onDone={() => {
            setShowForm(false);
            queryClient.invalidateQueries({ queryKey: ['sources'] });
          }}
        />
      )}

      <div className="px-5 py-4">
        {isLoading && (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        )}

        {!isLoading && mine.length === 0 && !showForm && (
          <p className="py-4 text-center text-sm text-slate-500">
            No source connected. Data can still be uploaded by hand below.
          </p>
        )}

        <ul className="space-y-3">
          {mine.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              expanded={expanded === source.id}
              onToggle={() =>
                setExpanded((current) => (current === source.id ? null : source.id))
              }
              onIngest={() => ingest.mutate(source.id)}
              onDelete={() => remove.mutate(source.id)}
              busy={ingest.isPending && ingest.variables === source.id}
              error={
                ingest.isError && ingest.variables === source.id
                  ? (ingest.error as Error).message
                  : null
              }
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ---- One source ---- */

function SourceRow({
  source,
  expanded,
  onToggle,
  onIngest,
  onDelete,
  busy,
  error,
}: {
  source: DataSource;
  expanded: boolean;
  onToggle: () => void;
  onIngest: () => void;
  onDelete: () => void;
  busy: boolean;
  error: string | null;
}) {
  const normalises = Boolean(source.normalize_text_column && source.normalize_code_column);

  return (
    <li className="rounded-lg border border-slate-700 bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <button onClick={onToggle} className="min-w-0 flex-1 text-left">
          <p className="truncate font-medium text-slate-100">{source.name}</p>
          <p className="truncate font-mono text-xs text-slate-500">
            {source.host}:{source.port}/{source.database}
          </p>
        </button>

        <div className="flex shrink-0 items-center gap-3">
          <div className="text-right">
            <p className="text-xs text-slate-500">Watermark</p>
            <p className="font-mono text-xs text-slate-300">
              {source.watermark_value
                ? source.watermark_value.slice(0, 19).replace('T', ' ')
                : 'never run'}
            </p>
          </div>
          <button
            onClick={onIngest}
            disabled={busy}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-500 disabled:opacity-50"
          >
            {busy ? 'Starting…' : 'Run extraction'}
          </button>
          <button
            onClick={onDelete}
            aria-label={`Disconnect ${source.name}`}
            className="rounded-lg border border-slate-700 px-2 py-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-red-400"
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      {normalises && (
        <p className="border-t border-slate-800 px-4 py-2 text-xs text-slate-500">
          Codes missing from{' '}
          <span className="font-mono text-slate-400">{source.normalize_code_column}</span> are
          filled in from{' '}
          <span className="font-mono text-slate-400">{source.normalize_text_column}</span>,
          using a vocabulary learned from the rows that already carry one.
        </p>
      )}

      {error && (
        <p className="border-t border-red-900/50 bg-red-900/20 px-4 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      {expanded && <RunHistory sourceId={source.id} />}
    </li>
  );
}

/* ---- Extraction history ---- */

function RunHistory({ sourceId }: { sourceId: number }) {
  const { data: runs, isLoading } = useQuery({
    queryKey: ['ingestion-runs', sourceId],
    queryFn: () => getIngestionRuns(sourceId),
    // An extraction is a background job; poll while one is in flight.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((run: IngestionRun) =>
        ['queued', 'running'].includes(run.status),
      )
        ? 3000
        : false,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center border-t border-slate-800 py-6">
        <Spinner />
      </div>
    );
  }

  if (!runs || runs.length === 0) {
    return (
      <p className="border-t border-slate-800 px-4 py-4 text-center text-sm text-slate-500">
        Never extracted. The first run brings the full history.
      </p>
    );
  }

  return (
    <div className="border-t border-slate-800 px-4 py-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        Extractions
      </p>
      <ul className="space-y-2">
        {runs.map((run) => (
          <RunRow key={run.id} run={run} />
        ))}
      </ul>
    </div>
  );
}

function RunRow({ run }: { run: IngestionRun }) {
  const normalization = asSummary(run.normalization);

  return (
    <li className="rounded border border-slate-800 bg-slate-950/50 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <StatusDot status={run.status} />
          <span className="text-slate-300">
            {run.rows_extracted.toLocaleString()} rows
          </span>
          {run.rows_extracted === 0 && run.status === 'success' && (
            // Worth saying, because zero looks like a failure and is not: it
            // is the steady state of an incremental pipeline.
            <span className="text-xs text-slate-500">nothing new</span>
          )}
        </span>
        <span className="font-mono text-xs text-slate-500">
          {run.started_at ? run.started_at.slice(0, 19).replace('T', ' ') : '—'}
        </span>
      </div>

      {run.watermark_after && run.watermark_after !== run.watermark_before && (
        <p className="mt-1 font-mono text-xs text-slate-500">
          {run.watermark_before.slice(0, 10)} → {run.watermark_after.slice(0, 10)}
        </p>
      )}

      {normalization && <NormalizationBar summary={normalization} />}

      {run.error && <p className="mt-1 text-xs text-red-400">{run.error}</p>}
    </li>
  );
}

/**
 * How many codes the run filled in, and how.
 *
 * The unresolved slice is shown deliberately rather than rounded away: rows
 * the platform declined to code are the honest output of a coding step, and
 * hiding them would make a 98% fill rate look like 100%.
 */
/**
 * Narrow the run's normalisation field, which is an empty object when the
 * source does not ask for normalisation. A key check alone does not narrow the
 * union, so test for the shape.
 */
function asSummary(
  value: IngestionRun['normalization'],
): NormalizationSummary | null {
  const candidate = value as NormalizationSummary;
  return typeof candidate.rows === 'number' || candidate.error ? candidate : null;
}

function NormalizationBar({ summary }: { summary: NormalizationSummary }) {
  if (summary.error) {
    return (
      <p className="mt-1 text-xs text-amber-400">
        Stored without normalising: {summary.error}
      </p>
    );
  }

  const total = summary.rows || 1;
  const slices = [
    { label: 'already coded', value: summary.already_coded, colour: 'bg-slate-600' },
    { label: 'filled in', value: summary.filled, colour: 'bg-emerald-500' },
    { label: 'unresolved', value: summary.unresolved, colour: 'bg-amber-500' },
  ].filter((slice) => slice.value > 0);

  return (
    <div className="mt-2">
      <div className="flex h-1.5 overflow-hidden rounded-full">
        {slices.map((slice) => (
          <div
            key={slice.label}
            className={slice.colour}
            style={{ width: `${(slice.value / total) * 100}%` }}
            title={`${slice.label}: ${slice.value.toLocaleString()}`}
          />
        ))}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {summary.filled.toLocaleString()} codes filled ·{' '}
        {summary.unresolved.toLocaleString()} left unresolved · vocabulary of{' '}
        {summary.vocabulary_size.toLocaleString()} terms learned from the coded rows
      </p>
    </div>
  );
}

function StatusDot({ status }: { status: IngestionRun['status'] }) {
  const colour =
    status === 'success'
      ? 'bg-emerald-500'
      : status === 'failed'
        ? 'bg-red-500'
        : 'bg-amber-500 animate-pulse';
  return <span className={`h-2 w-2 shrink-0 rounded-full ${colour}`} aria-label={status} />;
}

/* ---- Registration form ---- */

const EXAMPLE_SQL = `SELECT id, procedure_text, procedure_code, recorded_at
FROM procedures
WHERE recorded_at > :watermark
ORDER BY recorded_at`;

function SourceForm({ repoId, onDone }: { repoId: number; onDone: () => void }) {
  const [form, setForm] = useState<CreateSourceRequest>({
    repo_id: repoId,
    name: '',
    kind: 'postgres',
    host: '',
    port: 5432,
    database: '',
    username: '',
    password_env: '',
    extraction_sql: EXAMPLE_SQL,
    watermark_column: 'recorded_at',
    normalize_text_column: '',
    normalize_code_column: '',
  });

  const create = useMutation({
    mutationFn: (body: CreateSourceRequest) => createSource(body),
    onSuccess: onDone,
  });

  const set = (field: keyof CreateSourceRequest) => (value: string | number) =>
    setForm((current) => ({ ...current, [field]: value }));

  const field =
    'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-brand-500 focus:outline-none';

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate(form);
      }}
      className="space-y-4 border-b border-slate-800 bg-slate-950/40 px-5 py-5"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">
          <span className="text-slate-400">Name</span>
          <input
            required
            value={form.name}
            onChange={(e) => set('name')(e.target.value)}
            placeholder="Hospital HIS"
            className={`mt-1 ${field}`}
          />
        </label>
        <label className="text-sm">
          <span className="text-slate-400">Host</span>
          <input
            required
            value={form.host}
            onChange={(e) => set('host')(e.target.value)}
            placeholder="hospital-db"
            className={`mt-1 ${field}`}
          />
        </label>
        <label className="text-sm">
          <span className="text-slate-400">Database</span>
          <input
            required
            value={form.database}
            onChange={(e) => set('database')(e.target.value)}
            placeholder="hospital"
            className={`mt-1 ${field}`}
          />
        </label>
        <label className="text-sm">
          <span className="text-slate-400">Username</span>
          <input
            required
            value={form.username}
            onChange={(e) => set('username')(e.target.value)}
            placeholder="hospital"
            className={`mt-1 ${field}`}
          />
        </label>
      </div>

      <label className="block text-sm">
        <span className="text-slate-400">Password environment variable</span>
        <input
          value={form.password_env}
          onChange={(e) => set('password_env')(e.target.value.toUpperCase())}
          placeholder="HOSPITAL_DB_PASSWORD"
          pattern="[A-Z0-9_]*"
          className={`mt-1 font-mono ${field}`}
        />
        <span className="mt-1 block text-xs text-slate-500">
          The name of a variable set on the worker — not the password itself. No
          credential is sent from this form or stored in the database.
        </span>
      </label>

      <label className="block text-sm">
        <span className="text-slate-400">Extraction query</span>
        <textarea
          required
          rows={5}
          value={form.extraction_sql}
          onChange={(e) => set('extraction_sql')(e.target.value)}
          className={`mt-1 font-mono text-xs ${field}`}
        />
        <span className="mt-1 block text-xs text-slate-500">
          Must reference <code className="text-slate-400">:watermark</code>, and must
          return the watermark column. Without it every run would re-read the whole
          source instead of only what is new.
        </span>
      </label>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="text-sm">
          <span className="text-slate-400">Watermark column</span>
          <input
            required
            value={form.watermark_column}
            onChange={(e) => set('watermark_column')(e.target.value)}
            className={`mt-1 font-mono ${field}`}
          />
          <span className="mt-1 block text-xs text-slate-500">
            When the row was <em>recorded</em>, not when the event happened.
          </span>
        </label>
        <label className="text-sm">
          <span className="text-slate-400">Text column (optional)</span>
          <input
            value={form.normalize_text_column}
            onChange={(e) => set('normalize_text_column')(e.target.value)}
            placeholder="procedure_text"
            className={`mt-1 font-mono ${field}`}
          />
        </label>
        <label className="text-sm">
          <span className="text-slate-400">Code column (optional)</span>
          <input
            value={form.normalize_code_column}
            onChange={(e) => set('normalize_code_column')(e.target.value)}
            placeholder="procedure_code"
            className={`mt-1 font-mono ${field}`}
          />
          <span className="mt-1 block text-xs text-slate-500">
            Set both to fill in missing codes.
          </span>
        </label>
      </div>

      {create.isError && (
        <p className="rounded-lg border border-red-800 bg-red-900/20 px-3 py-2 text-sm text-red-300">
          {(create.error as Error).message}
        </p>
      )}

      <button
        type="submit"
        disabled={create.isPending}
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-500 disabled:opacity-50"
      >
        {create.isPending ? 'Connecting…' : 'Connect source'}
      </button>
    </form>
  );
}

/* ---- Icons ---- */

function DatabaseIcon() {
  return (
    <svg className="h-5 w-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}
