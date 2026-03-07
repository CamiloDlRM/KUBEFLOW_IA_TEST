import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { ArrowLeft, ExternalLink, Copy, Check, Play, RotateCcw, Trash2 } from 'lucide-react';
import { getModels, predict, rollbackModel, deleteModel } from '../api/client';
import type { ModelDeployment } from '../types';
import { formatDate } from '../utils/format';
import Spinner from '../components/Spinner';

/* ---- Mock data ---- */
const MOCK_MODELS: ModelDeployment[] = [
  {
    model_name: 'iris-classifier',
    version: '3',
    accuracy: 0.95,
    endpoint_url: 'http://localhost:8001/v1/models/iris-classifier:predict',
    deployed_at: '2025-12-20T08:15:00Z',
    is_active: true,
    pipeline_id: 'a1b2c3d4-success',
  },
  {
    model_name: 'sentiment-model',
    version: '2',
    accuracy: 0.82,
    endpoint_url: 'http://localhost:8001/v1/models/sentiment-model:predict',
    deployed_at: '2025-12-18T12:00:00Z',
    is_active: true,
    pipeline_id: 'x9y8z7w6-done',
  },
];

const MOCK_VERSION_HISTORY: Record<string, VersionEntry[]> = {
  'iris-classifier': [
    { version: 'v1', accuracy: 0.88, deployedAt: '2025-11-10T10:00:00Z', pipelineId: 'pl-001' },
    { version: 'v2', accuracy: 0.91, deployedAt: '2025-12-01T14:00:00Z', pipelineId: 'pl-012' },
    { version: 'v3', accuracy: 0.95, deployedAt: '2025-12-20T08:15:00Z', pipelineId: 'a1b2c3d4-success' },
  ],
  'sentiment-model': [
    { version: 'v1', accuracy: 0.76, deployedAt: '2025-11-20T09:00:00Z', pipelineId: 'pl-005' },
    { version: 'v2', accuracy: 0.82, deployedAt: '2025-12-18T12:00:00Z', pipelineId: 'x9y8z7w6-done' },
  ],
};

interface VersionEntry {
  version: string;
  accuracy: number;
  deployedAt: string;
  pipelineId: string;
}

export default function ModelDetail() {
  const { name } = useParams<{ name: string }>();
  const queryClient = useQueryClient();

  const { data: modelsData, isLoading, error } = useQuery({
    queryKey: ['models'],
    queryFn: getModels,
    refetchInterval: 15_000,
  });

  const models = modelsData ?? (error ? MOCK_MODELS : undefined);
  const model = models?.find((m) => m.model_name === name);
  const isMock = Boolean(error);

  // Version history — real endpoint doesn't exist yet, use mock
  const versionHistory = MOCK_VERSION_HISTORY[name ?? ''] ?? generateMockHistory(model);

  const rollbackMut = useMutation({
    mutationFn: rollbackModel,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['models'] }),
  });

  const deleteMut = useMutation({
    mutationFn: deleteModel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] });
      window.history.back();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!model) {
    return (
      <div className="space-y-4 py-12 text-center">
        <p className="text-[#a1a1aa]">Modelo "{name}" no encontrado.</p>
        <Link to="/models" className="text-sm text-white underline">
          Volver a Models
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {isMock && (
        <div className="rounded-lg border border-yellow-800 bg-yellow-900/20 px-4 py-3 text-sm text-yellow-300">
          Backend unavailable — showing mock data for preview.
        </div>
      )}

      {/* Back + Title */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Link
            to="/models"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#27272a] text-[#a1a1aa] transition-colors hover:bg-[#27272a] hover:text-white"
          >
            <ArrowLeft size={16} />
          </Link>
          <div>
            <h2 className="text-2xl font-bold text-white">{model.model_name}</h2>
            <p className="mt-0.5 text-sm text-[#52525b]">
              Version {model.version} &middot; Desplegado {formatDate(model.deployed_at)}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => {
              if (window.confirm(`Rollback "${model.model_name}"?`)) {
                rollbackMut.mutate(model.model_name);
              }
            }}
            disabled={rollbackMut.isPending}
            className="flex items-center gap-1.5 rounded-lg border border-[#27272a] px-3 py-2 text-sm text-[#a1a1aa] transition-colors hover:bg-[#27272a] hover:text-white disabled:opacity-50"
          >
            <RotateCcw size={14} />
            Rollback
          </button>
          <button
            onClick={() => {
              if (window.confirm(`Eliminar "${model.model_name}"?`)) {
                deleteMut.mutate(model.model_name);
              }
            }}
            disabled={deleteMut.isPending}
            className="flex items-center gap-1.5 rounded-lg border border-red-900/50 px-3 py-2 text-sm text-red-400 transition-colors hover:bg-red-900/20 disabled:opacity-50"
          >
            <Trash2 size={14} />
            Eliminar
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Accuracy" value={`${(model.accuracy * 100).toFixed(1)}%`} />
        <StatCard
          label="Estado"
          value={model.is_active ? 'Activo' : 'Inactivo'}
          dotColor={model.is_active ? 'bg-emerald-500' : 'bg-red-500'}
        />
        <StatCard label="Version" value={`v${model.version}`} />
      </div>

      {/* Endpoint */}
      <EndpointSection model={model} />

      {/* Accuracy chart */}
      <AccuracyChart history={versionHistory} />

      {/* Version history table */}
      <VersionHistory history={versionHistory} />

      {/* Test section */}
      <TestSection model={model} />
    </div>
  );
}

/* ---- Sub-components ---- */

function StatCard({ label, value, dotColor }: { label: string; value: string; dotColor?: string }) {
  return (
    <div className="rounded-xl border border-[#27272a] bg-[#18181b]/60 px-5 py-4">
      <p className="text-xs text-[#52525b]">{label}</p>
      <p className="mt-1 flex items-center gap-2 text-xl font-semibold text-white">
        {dotColor && <span className={`h-2 w-2 rounded-full ${dotColor}`} />}
        {value}
      </p>
    </div>
  );
}

function EndpointSection({ model }: { model: ModelDeployment }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(model.endpoint_url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-[#a1a1aa]">Endpoint</h3>
      <div className="flex items-center gap-2 rounded-lg border border-[#27272a] bg-[#18181b]/60 px-4 py-3">
        <code className="flex-1 truncate font-mono text-sm text-[#a1a1aa]">
          {model.endpoint_url}
        </code>
        <button
          onClick={handleCopy}
          className="shrink-0 rounded-md border border-[#27272a] p-2 text-[#52525b] transition-colors hover:text-white"
        >
          {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
        </button>
        <a
          href={model.endpoint_url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-md border border-[#27272a] p-2 text-[#52525b] transition-colors hover:text-white"
        >
          <ExternalLink size={14} />
        </a>
      </div>
    </section>
  );
}

function AccuracyChart({ history }: { history: VersionEntry[] }) {
  const data = history.map((h) => ({
    version: h.version,
    accuracy: +(h.accuracy * 100).toFixed(1),
  }));

  return (
    <section>
      <h3 className="mb-4 text-lg font-semibold text-white">Accuracy por Version</h3>
      <div className="h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="accGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity={0.15} />
                <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#27272a" vertical={false} />
            <XAxis
              dataKey="version"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#52525b', fontSize: 12 }}
            />
            <YAxis
              domain={['dataMin - 5', 'dataMax + 2']}
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#52525b', fontSize: 11 }}
              tickFormatter={(v: number) => `${v}%`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#18181b',
                border: '1px solid #27272a',
                borderRadius: '8px',
                fontSize: '12px',
                color: '#fafafa',
              }}
              formatter={(value: number) => [`${value}%`, 'Accuracy']}
            />
            <Area
              type="monotone"
              dataKey="accuracy"
              stroke="#22c55e"
              strokeWidth={2}
              fill="url(#accGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function VersionHistory({ history }: { history: VersionEntry[] }) {
  return (
    <section>
      <h3 className="mb-4 text-lg font-semibold text-white">Historial de Versiones</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[#27272a] text-xs uppercase tracking-wider text-[#52525b]">
              <th className="px-4 pb-3 font-medium">Version</th>
              <th className="px-4 pb-3 font-medium">Accuracy</th>
              <th className="px-4 pb-3 font-medium">Fecha Deploy</th>
              <th className="px-4 pb-3 font-medium">Pipeline</th>
            </tr>
          </thead>
          <tbody>
            {[...history].reverse().map((h) => (
              <tr
                key={h.version}
                className="border-b border-[#27272a]/50 transition-colors hover:bg-[#18181b]/30"
              >
                <td className="px-4 py-3 font-semibold text-white">{h.version}</td>
                <td className="px-4 py-3 font-mono text-white">
                  {(h.accuracy * 100).toFixed(1)}%
                </td>
                <td className="px-4 py-3 text-[#a1a1aa]">{formatDate(h.deployedAt)}</td>
                <td className="px-4 py-3">
                  <Link
                    to={`/pipelines/${h.pipelineId}`}
                    className="font-mono text-xs text-[#a1a1aa] hover:text-white hover:underline"
                  >
                    {h.pipelineId.slice(0, 12)}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TestSection({ model }: { model: ModelDeployment }) {
  const [payload, setPayload] = useState('{\n  "data": [[5.1, 3.5, 1.4, 0.2]]\n}');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const mutation = useMutation({
    mutationFn: (data: unknown) => predict(model.model_name, data),
  });

  function handleSend() {
    setJsonError(null);
    try {
      const parsed = JSON.parse(payload);
      mutation.mutate(parsed);
    } catch {
      setJsonError('JSON invalido.');
    }
  }

  return (
    <section>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-lg font-semibold text-white"
      >
        <Play size={16} className={expanded ? 'text-emerald-400' : ''} />
        Probar Modelo
      </button>

      {expanded && (
        <div className="mt-4 space-y-4 rounded-xl border border-[#27272a] bg-[#18181b]/60 p-5">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#a1a1aa]">
              JSON Payload
            </label>
            <textarea
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-[#27272a] bg-[#09090b] px-3 py-2 font-mono text-xs text-white placeholder-[#52525b] outline-none transition-colors focus:border-[#a1a1aa]"
            />
          </div>

          {jsonError && <p className="text-xs text-red-400">{jsonError}</p>}

          {mutation.isError && (
            <div className="rounded-lg border border-red-900/50 bg-red-900/20 px-3 py-2 text-xs text-red-300">
              {(mutation.error as Error).message}
            </div>
          )}

          {mutation.isSuccess && (
            <div>
              <p className="mb-1 text-xs font-medium text-[#a1a1aa]">Respuesta:</p>
              <pre className="overflow-x-auto rounded-lg bg-[#09090b] p-3 font-mono text-xs text-emerald-300">
                {JSON.stringify(mutation.data, null, 2)}
              </pre>
            </div>
          )}

          <button
            onClick={handleSend}
            disabled={mutation.isPending}
            className="flex items-center gap-2 rounded-lg border border-[#27272a] bg-[#27272a]/30 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#27272a]/70 disabled:opacity-50"
          >
            {mutation.isPending && <Spinner size="sm" />}
            Enviar Request
          </button>
        </div>
      )}
    </section>
  );
}

/* ---- Helpers ---- */

function generateMockHistory(model?: ModelDeployment): VersionEntry[] {
  if (!model) return [];
  const v = parseInt(model.version) || 1;
  const entries: VersionEntry[] = [];
  for (let i = 1; i <= v; i++) {
    entries.push({
      version: `v${i}`,
      accuracy: Math.min(0.99, model.accuracy - (v - i) * 0.04 + Math.random() * 0.02),
      deployedAt: new Date(Date.now() - (v - i) * 7 * 86400000).toISOString(),
      pipelineId: `pl-mock-${i}`,
    });
  }
  return entries;
}
