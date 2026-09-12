import { useQuery } from '@tanstack/react-query';
import { previewSource } from '../api/client';
import type { DataSource, SourcePreview } from '../types';
import Spinner from './Spinner';

/**
 * Stage two: did each source actually load?
 *
 * Its own stage because it answers a question nothing else does — whether the
 * credentials work, the query is valid, and the columns are the ones expected —
 * *before* anything is stored and before any watermark moves. Discovering a
 * wrong table name from a failed extraction is a much worse way to learn it.
 *
 * Nothing here writes. Every preview is a fresh read of a handful of rows.
 */
export default function SourcePreviews({
  projectId,
  sources,
}: {
  projectId: number;
  sources: DataSource[];
}) {
  if (sources.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-700 py-12 text-center text-sm text-slate-500">
        No sources connected yet.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        A handful of rows from each source, read live. Nothing is stored and no watermark
        moves — this is the check before committing to an extraction.
      </p>
      {sources.map((source) => (
        <OneSource key={source.id} projectId={projectId} source={source} />
      ))}
    </div>
  );
}

function OneSource({ projectId, source }: { projectId: number; source: DataSource }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['source-preview', source.id],
    queryFn: () =>
      previewSource({
        project_id: projectId,
        kind: source.kind,
        host: source.host,
        port: source.port,
        database: source.database,
        username: source.username,
        password_env: source.password_env,
        extraction_sql: source.extraction_sql,
        limit: 8,
      }),
    retry: false,
  });

  return (
    <section className="rounded-lg border border-slate-700 bg-slate-900/40">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-800 px-5 py-3">
        <h3 className="text-sm font-semibold text-slate-100">{source.name}</h3>
        <p className="font-mono text-xs text-slate-500">
          {source.host}:{source.port}/{source.database}
        </p>
      </header>

      <div className="px-5 py-4">
        {isLoading && <Spinner />}

        {error != null && !isLoading && (
          // The reason is the whole value of this stage: a wrong table name, a
          // missing credential and an unreachable host must read differently.
          <p className="rounded border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-200">
            {(error as Error).message}
          </p>
        )}

        {data && <PreviewTable preview={data} />}
      </div>
    </section>
  );
}

function PreviewTable({ preview }: { preview: SourcePreview }) {
  if (preview.rows.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        The query ran and returned no rows. The connection works; the source has nothing
        matching it yet.
      </p>
    );
  }

  return (
    <>
      <p className="mb-2 text-xs text-slate-500">
        {preview.rows.length} row{preview.rows.length === 1 ? '' : 's'}
        {preview.truncated && ' (more follow)'} · nothing was stored
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-700">
              {preview.columns.map((column) => (
                <th key={column} className="px-2 py-1.5 font-medium text-slate-200">
                  {column}
                  {/* The inferred type is a read of these rows, not a promise —
                      the cleaning standard decides the real one later, and says
                      so where it can be checked. */}
                  <span className="ml-1.5 font-mono text-[10px] font-normal text-slate-500">
                    {preview.profile[column]?.inferred_type}
                  </span>
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
                      <span className="text-slate-600">—</span>
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
  );
}
