import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { getModelVersions, serveModelVersion } from '../../api/client';
import type { ModelVersion } from '../../types';
import Spinner from '../Spinner';
import { formatDate, truncate } from '../../utils/format';

/**
 * Every version of a model, and the choice of which one serves.
 *
 * "Rollback" used to mean "the previous version", with no way to see what
 * that was — and it sent no version at all, so it never worked. Here each
 * version is a row: what it scored, what it trained on, which code, whether
 * it ever served. Any of them can be put in service, including one that
 * registered but missed the auto-deploy bar; serving it is a decision made
 * with its numbers in view, which is the point.
 *
 * Switching is two clicks — choose, then confirm on the same row — because
 * it changes what every caller of the model gets.
 */
export default function VersionsDialog({ modelName, onClose }: { modelName: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<string | null>(null);

  const { data: versions, isLoading, error } = useQuery({
    queryKey: ['model-versions', modelName],
    queryFn: () => getModelVersions(modelName),
  });

  const serve = useMutation({
    mutationFn: (pipelineId: string) => serveModelVersion(modelName, pipelineId),
    onSuccess: () => {
      setConfirming(null);
      queryClient.invalidateQueries({ queryKey: ['model-versions', modelName] });
      queryClient.invalidateQueries({ queryKey: ['models'] });
    },
  });

  const serving = versions?.find((version) => version.is_active);
  // Columns for the metrics every version has, accuracy first.
  const metricNames = Array.from(new Set((versions ?? []).flatMap((v) => Object.keys(v.metrics))))
    .filter((name) => name !== 'deployed')
    .sort((a, b) => (a === 'accuracy' ? -1 : b === 'accuracy' ? 1 : a.localeCompare(b)))
    .slice(0, 3);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`Versions of ${modelName}`}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Versions of {modelName}</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {serving ? `Serving v${serving.version}. ` : 'No version is serving. '}
              Every run that registered a model is here, deployed or not.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200">
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto">
          {isLoading && (
            <div className="flex h-40 items-center justify-center">
              <Spinner />
            </div>
          )}
          {error != null && <p className="px-5 py-6 text-sm text-red-300">{(error as Error).message}</p>}
          {versions && versions.length === 0 && (
            <p className="px-5 py-6 text-sm text-slate-400">No registered versions yet.</p>
          )}
          {versions && versions.length > 0 && (
            <table className="min-w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-900 text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">Version</th>
                  <th scope="col" className="px-4 py-2 font-medium">Trained</th>
                  {metricNames.map((name) => (
                    <th key={name} scope="col" className="px-4 py-2 text-right font-medium">{name}</th>
                  ))}
                  <th scope="col" className="px-4 py-2 font-medium">Trained on</th>
                  <th scope="col" className="px-4 py-2 font-medium">Code</th>
                  <th scope="col" className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {versions.map((version) => (
                  <VersionRow
                    key={version.pipeline_id ?? `v${version.version}`}
                    version={version}
                    metricNames={metricNames}
                    best={metricNames[0] ? Math.max(...versions.map((v) => v.metrics[metricNames[0]] ?? -Infinity)) : null}
                    older={
                      serving !== undefined &&
                      Number(version.version) < Number(serving.version)
                    }
                    confirming={confirming === version.pipeline_id}
                    busy={serve.isPending}
                    onChoose={() => setConfirming(version.pipeline_id)}
                    onCancel={() => setConfirming(null)}
                    onConfirm={() => version.pipeline_id && serve.mutate(version.pipeline_id)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {serve.isError && (
          <p className="border-t border-red-900/60 bg-red-950/30 px-5 py-2 text-xs text-red-300">
            {(serve.error as Error).message}
          </p>
        )}
        {serve.isSuccess && (
          <p className="border-t border-emerald-900/60 bg-emerald-950/30 px-5 py-2 text-xs text-emerald-300">
            {serve.data.message}
          </p>
        )}
      </div>
    </div>
  );
}

function VersionRow({
  version,
  metricNames,
  best,
  older,
  confirming,
  busy,
  onChoose,
  onCancel,
  onConfirm,
}: {
  version: ModelVersion;
  metricNames: string[];
  best: number | null;
  /** Older than the version serving now: choosing it is a rollback. */
  older: boolean;
  confirming: boolean;
  busy: boolean;
  onChoose: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <tr className={`border-t border-slate-800 ${version.is_active ? 'bg-emerald-950/20' : ''}`}>
      <td className="px-4 py-2.5">
        <span className="font-mono text-sm text-slate-100">v{version.version}</span>
        {version.is_active ? (
          <span className="ml-2 rounded-full bg-emerald-900/60 px-2 py-0.5 text-[10px] font-medium text-emerald-300">serving</span>
        ) : version.deployed_at ? (
          <span className="ml-2 text-[10px] text-slate-500">served {formatDate(version.deployed_at)}</span>
        ) : (
          <span className="ml-2 text-[10px] text-slate-500">never served</span>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-slate-400">{formatDate(version.trained_at)}</td>
      {metricNames.map((name, index) => {
        const value = version.metrics[name];
        return (
          <td
            key={name}
            className={`px-4 py-2.5 text-right font-mono tabular-nums ${
              index === 0 && value !== undefined && value === best ? 'text-slate-100' : 'text-slate-400'
            }`}
          >
            {value === undefined ? '—' : value.toFixed(4)}
          </td>
        );
      })}
      <td className="px-4 py-2.5 text-slate-400">{version.input_label || '—'}</td>
      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11px] text-slate-500">
        {version.branch || '—'}
        {version.commit_sha && ` @ ${truncate(version.commit_sha, 7)}`}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-right">
        {version.is_active ? null : !version.deployable || !version.pipeline_id ? (
          <span className="text-[11px] text-slate-600" title="Its artifact cannot be located">
            unavailable
          </span>
        ) : confirming ? (
          <span className="inline-flex items-center gap-2">
            <button
              onClick={onConfirm}
              disabled={busy}
              className="rounded bg-yellow-600 px-2.5 py-1 text-xs font-semibold text-slate-950 hover:bg-yellow-500 disabled:opacity-50"
            >
              {busy ? 'Switching…' : `Serve v${version.version}`}
            </button>
            <button onClick={onCancel} disabled={busy} className="text-xs text-slate-400 hover:text-slate-200">
              Cancel
            </button>
          </span>
        ) : (
          <button
            onClick={onChoose}
            disabled={busy}
            className="rounded bg-yellow-600/20 px-2.5 py-1 text-xs font-medium text-yellow-400 hover:bg-yellow-600/30 disabled:opacity-50"
          >
            {older ? 'Roll back to this' : version.deployed_at ? 'Serve this' : 'Deploy this'}
          </button>
        )}
      </td>
    </tr>
  );
}
