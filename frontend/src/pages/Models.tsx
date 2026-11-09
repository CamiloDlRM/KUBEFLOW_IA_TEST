import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getModels, deleteModel } from '../api/client';
import type { ModelDeployment } from '../types';
import Spinner from '../components/Spinner';
import ModelDashboard, { ModelStatusBadge } from '../components/ModelDashboard';
import TestModelModal from '../components/models/TestModelModal';
import VersionsDialog from '../components/models/VersionsDialog';
import ShareLinkCell from '../components/models/ShareLinkCell';
import { formatDate } from '../utils/format';
import { useAuth } from '../context/AuthContext';
import MaiaEmptyState from '../components/MaiaEmptyState';

export default function Models() {
  const queryClient = useQueryClient();
  // Members only ever see their own models, so the column would say nothing.
  const { isAdmin } = useAuth();
  const { data: models, isLoading, error } = useQuery({
    queryKey: ['models'],
    queryFn: getModels,
    refetchInterval: 15_000,
  });

  const [testModal, setTestModal] = useState<ModelDeployment | null>(null);
  const [selected, setSelected] = useState<ModelDeployment | null>(null);

  const [versionsOf, setVersionsOf] = useState<string | null>(null);

  const deleteMut = useMutation({
    mutationFn: deleteModel,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['models'] }),
  });

  function handleDelete(modelName: string) {
    if (window.confirm(`Delete model "${modelName}"? This will unload it from the model server.`)) {
      deleteMut.mutate(modelName);
    }
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

  if (selected) {
    // From the latest list, not the copy taken on click: sharing it on the
    // dashboard refetches the list, and the dashboard should show that at once.
    const current = models?.find((m) => m.model_name === selected.model_name) ?? selected;
    return <ModelDashboard model={current} onBack={() => setSelected(null)} />;
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
        <MaiaEmptyState action={{ to: '/pipelines', label: 'See the pipelines' }}>
          No models deployed yet. When a pipeline finishes and its model clears the project's deployment rules,
          it shows up here, ready to use.
        </MaiaEmptyState>
      )}

      {models && models.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800/80 text-left text-xs uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3">Model</th>
                {isAdmin && <th className="px-4 py-3">User</th>}
                <th className="px-4 py-3">Version</th>
                <th className="px-4 py-3">Accuracy</th>
                <th className="px-4 py-3">Deployed</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Public link</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.model_name} className="border-b border-slate-800 hover:bg-slate-800/40 transition">
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setSelected(m)}
                      className="text-left font-medium text-slate-100 transition hover:text-brand-400"
                      title="Open model dashboard"
                    >
                      {m.model_name}
                    </button>
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-slate-300">{m.owner_username ?? '--'}</td>
                  )}
                  <td className="px-4 py-3 text-slate-300">v{m.version}</td>
                  <td className="px-4 py-3 font-display text-slate-300">
                    {(m.accuracy * 100).toFixed(1)}%
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">{formatDate(m.deployed_at)}</td>
                  <td className="px-4 py-3">
                    <ModelStatusBadge active={m.is_active} />
                  </td>
                  <td className="px-4 py-3">
                    <ShareLinkCell model={m} />
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
                        onClick={() => setVersionsOf(m.model_name)}
                        className="rounded bg-yellow-600/20 px-2.5 py-1 text-xs font-medium text-yellow-400 hover:bg-yellow-600/30"
                      >
                        Versions
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

      {versionsOf && <VersionsDialog modelName={versionsOf} onClose={() => setVersionsOf(null)} />}

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
