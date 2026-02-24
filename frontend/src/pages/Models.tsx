import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getModels, predict, rollbackModel, deleteModel } from '../api/client';
import type { ModelDeployment } from '../types';
import Spinner from '../components/Spinner';
import { formatDate } from '../utils/format';

export default function Models() {
  const queryClient = useQueryClient();
  const { data: models, isLoading, error } = useQuery({
    queryKey: ['models'],
    queryFn: getModels,
    refetchInterval: 15_000,
  });

  const [testModal, setTestModal] = useState<ModelDeployment | null>(null);
  const [copiedName, setCopiedName] = useState<string | null>(null);

  const rollbackMut = useMutation({
    mutationFn: rollbackModel,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['models'] }),
  });

  const deleteMut = useMutation({
    mutationFn: deleteModel,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['models'] }),
  });

  function handleRollback(modelName: string) {
    if (window.confirm(`Rollback "${modelName}" to the previous version?`)) {
      rollbackMut.mutate(modelName);
    }
  }

  function handleDelete(modelName: string) {
    if (window.confirm(`Delete model "${modelName}"? This will unload it from the model server.`)) {
      deleteMut.mutate(modelName);
    }
  }

  function handleCopyUrl(url: string, modelName: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopiedName(modelName);
      setTimeout(() => setCopiedName(null), 2000);
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-xl py-12">
        <div className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-300">
          Failed to load models: {(error as Error).message}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-100">Models</h2>
        <p className="mt-1 text-sm text-slate-400">
          Active model deployments and inference endpoints.
        </p>
      </div>

      {models && models.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-700 py-16 text-center">
          <p className="text-slate-400">
            No models deployed yet. Successfully completed pipelines will deploy models here automatically.
          </p>
        </div>
      )}

      {models && models.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800/80 text-left text-xs uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3">Model</th>
                <th className="px-4 py-3">Version</th>
                <th className="px-4 py-3">Accuracy</th>
                <th className="px-4 py-3">Deployed</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Endpoint</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.model_name} className="border-b border-slate-800 hover:bg-slate-800/40 transition">
                  <td className="px-4 py-3 font-medium text-slate-100">{m.model_name}</td>
                  <td className="px-4 py-3 text-slate-300">v{m.version}</td>
                  <td className="px-4 py-3 font-mono text-slate-300">
                    {(m.accuracy * 100).toFixed(1)}%
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">{formatDate(m.deployed_at)}</td>
                  <td className="px-4 py-3">
                    <ModelStatusBadge active={m.is_active} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <code className="max-w-[200px] truncate text-xs text-slate-400">
                        {m.endpoint_url}
                      </code>
                      <button
                        onClick={() => handleCopyUrl(m.endpoint_url, m.model_name)}
                        className="shrink-0 rounded p-1 text-slate-500 hover:text-slate-300"
                        title="Copy URL"
                      >
                        {copiedName === m.model_name ? (
                          <svg className="h-3.5 w-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setTestModal(m)}
                        className="rounded bg-brand-600/20 px-2.5 py-1 text-xs font-medium text-brand-400 hover:bg-brand-600/30"
                      >
                        Test
                      </button>
                      <button
                        onClick={() => handleRollback(m.model_name)}
                        disabled={rollbackMut.isPending}
                        className="rounded bg-yellow-600/20 px-2.5 py-1 text-xs font-medium text-yellow-400 hover:bg-yellow-600/30 disabled:opacity-50"
                      >
                        Rollback
                      </button>
                      <button
                        onClick={() => handleDelete(m.model_name)}
                        disabled={deleteMut.isPending}
                        className="rounded bg-red-600/20 px-2.5 py-1 text-xs font-medium text-red-400 hover:bg-red-600/30 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Test modal */}
      {testModal && (
        <TestModelModal
          model={testModal}
          onClose={() => setTestModal(null)}
        />
      )}
    </div>
  );
}

/* ---- Sub-components ---- */

function ModelStatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        active
          ? 'bg-emerald-900/50 text-emerald-300'
          : 'bg-slate-700 text-slate-400'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-400' : 'bg-slate-500'}`} />
      {active ? 'active' : 'inactive'}
    </span>
  );
}

interface TestModelModalProps {
  model: ModelDeployment;
  onClose: () => void;
}

function TestModelModal({ model, onClose }: TestModelModalProps) {
  const [payload, setPayload] = useState('{\n  "data": [[5.1, 3.5, 1.4, 0.2]]\n}');
  const [jsonError, setJsonError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (data: unknown) => predict(model.model_name, data),
  });

  function handleSend() {
    setJsonError(null);
    try {
      const parsed = JSON.parse(payload);
      mutation.mutate(parsed);
    } catch {
      setJsonError('Invalid JSON payload.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-lg border border-slate-700 bg-slate-800 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-700 px-5 py-3">
          <h3 className="text-sm font-semibold text-slate-100">
            Test: {model.model_name}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              JSON Payload
            </label>
            <textarea
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              rows={5}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-200 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {jsonError && (
            <p className="text-xs text-red-400">{jsonError}</p>
          )}

          {mutation.isError && (
            <div className="rounded border border-red-800 bg-red-900/20 px-3 py-2 text-xs text-red-300">
              {(mutation.error as Error).message}
            </div>
          )}

          {mutation.isSuccess && (
            <div>
              <p className="mb-1 text-xs font-medium text-slate-400">Response:</p>
              <pre className="overflow-x-auto rounded bg-slate-900 p-3 font-mono text-xs text-emerald-300">
                {JSON.stringify(mutation.data, null, 2)}
              </pre>
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700"
            >
              Close
            </button>
            <button
              onClick={handleSend}
              disabled={mutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
            >
              {mutation.isPending && <Spinner size="sm" />}
              Send Request
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
