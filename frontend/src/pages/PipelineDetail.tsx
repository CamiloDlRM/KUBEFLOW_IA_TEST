import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { usePipeline, useRepos } from '../hooks/usePipelines';
import { useWebSocket } from '../hooks/useWebSocket';
import { getWsUrl } from '../api/client';
import PipelineStatusBadge from '../components/PipelineStatus';
import LogViewer from '../components/LogViewer';
import MetricsChart from '../components/MetricsChart';
import Spinner from '../components/Spinner';
import { formatDate, formatDuration, truncate, repoNameFromUrl } from '../utils/format';
import type { PhaseStatus } from '../types';
import { getPipelines } from '../api/client';

const PHASE_ORDER = ['download', 'validate', 'execute', 'register', 'deploy'];

const phaseStatusStyles: Record<PhaseStatus, { bg: string; ring: string; icon: string }> = {
  pending: { bg: 'bg-slate-700', ring: 'ring-slate-600', icon: 'text-slate-500' },
  running: { bg: 'bg-blue-600 animate-pulse', ring: 'ring-blue-500', icon: 'text-blue-300' },
  success: { bg: 'bg-emerald-500', ring: 'ring-emerald-400', icon: 'text-emerald-300' },
  failed: { bg: 'bg-red-500', ring: 'ring-red-400', icon: 'text-red-300' },
};

export default function PipelineDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: pipeline, isLoading, error } = usePipeline(id);
  const { data: repos } = useRepos();

  // WebSocket for live logs - only connect when pipeline is running/queued
  const shouldStream = pipeline?.status === 'running' || pipeline?.status === 'queued';
  const wsUrl = id && shouldStream ? getWsUrl(id) : null;
  const { messages, status: wsStatus } = useWebSocket(wsUrl);

  // Fetch historical pipelines for the same repo for MetricsChart
  const { data: historyPage } = useQuery({
    queryKey: ['pipelines', 'history', pipeline?.repo_id],
    queryFn: () => getPipelines(1, 10),
    enabled: Boolean(pipeline?.repo_id),
  });

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
          Failed to load pipeline: {(error as Error).message}
        </div>
        <Link to="/" className="mt-4 inline-block text-sm text-brand-400 hover:underline">
          Back to Dashboard
        </Link>
      </div>
    );
  }

  if (!pipeline) {
    return (
      <div className="py-12 text-center text-sm text-slate-500">
        Pipeline not found.
      </div>
    );
  }

  const repo = repos?.find((r) => r.id === pipeline.repo_id);
  const repoName = repo ? repoNameFromUrl(repo.github_url) : `repo #${pipeline.repo_id}`;

  // Build metrics chart data from history
  const metricsData = (historyPage?.items ?? [])
    .filter((p) => p.repo_id === pipeline.repo_id && p.metrics && Object.keys(p.metrics).length > 0)
    .map((p) => ({
      label: truncate(p.id, 6),
      metrics: p.metrics,
    }));

  // Model endpoint info
  const isDeployed = pipeline.status === 'success' && pipeline.metrics.deployed;

  return (
    <div className="space-y-8">
      {/* Back link */}
      <Link to="/" className="text-sm text-brand-400 hover:underline">
        &larr; Back to Dashboard
      </Link>

      {/* Header */}
      <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-100">
              Pipeline <span className="font-mono text-base text-slate-400">{truncate(pipeline.id, 12)}</span>
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-slate-400">
              <span>Repo: <span className="text-slate-200">{repoName}</span></span>
              <span>Branch: <span className="text-slate-200">{repo?.branch ?? '--'}</span></span>
              <span>Commit: <code className="text-slate-200">{truncate(pipeline.commit_sha)}</code></span>
            </div>
          </div>
          <div className="text-right">
            <PipelineStatusBadge status={pipeline.status} className="text-sm" />
            <p className="mt-2 text-xs text-slate-500">
              {formatDate(pipeline.started_at)} &middot; {formatDuration(pipeline.started_at, pipeline.finished_at)}
            </p>
          </div>
        </div>
      </div>

      {/* Phase timeline */}
      <section>
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Pipeline Phases
        </h3>
        <div className="flex items-center gap-0">
          {PHASE_ORDER.map((phaseName, idx) => {
            const phase = pipeline.phases.find((p) => p.name === phaseName);
            const status: PhaseStatus = phase?.status ?? 'pending';
            const styles = phaseStatusStyles[status];

            return (
              <div key={phaseName} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-full ring-2 ${styles.bg} ${styles.ring}`}
                  >
                    <PhaseIcon status={status} className={styles.icon} />
                  </div>
                  <span className="mt-2 text-xs text-slate-400">{phaseName}</span>
                  {phase?.timestamp && (
                    <span className="text-[10px] text-slate-600">
                      {new Date(phase.timestamp).toLocaleTimeString()}
                    </span>
                  )}
                </div>
                {idx < PHASE_ORDER.length - 1 && (
                  <div
                    className={`mx-1 h-0.5 w-8 sm:w-12 ${
                      status === 'success' ? 'bg-emerald-600' : 'bg-slate-700'
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Log viewer */}
      <section>
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Logs
        </h3>
        <LogViewer messages={messages} status={wsStatus} />
        {!shouldStream && messages.length === 0 && (
          <p className="mt-2 text-xs text-slate-500">
            Live log streaming is available while the pipeline is running. The pipeline is currently {pipeline.status}.
          </p>
        )}
      </section>

      {/* Metrics */}
      <section>
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Metrics
        </h3>
        <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-4">
          <MetricsChart dataPoints={metricsData} />
        </div>
      </section>

      {/* Deployed model card */}
      {isDeployed && (
        <section>
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">
            Deployed Model
          </h3>
          <div className="rounded-lg border border-emerald-800 bg-emerald-900/20 p-5">
            <p className="text-sm text-emerald-300">
              This pipeline produced a model that was automatically deployed.
            </p>
            <div className="mt-3">
              <p className="text-xs text-slate-400">Example prediction request:</p>
              <pre className="mt-2 overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-300">
{`curl -X POST http://localhost:8000/models/<model_name>/predict \\
  -H "Content-Type: application/json" \\
  -d '{"data": [[5.1, 3.5, 1.4, 0.2]]}'`}
              </pre>
            </div>
            <Link
              to="/models"
              className="mt-3 inline-block text-sm text-brand-400 hover:underline"
            >
              View all models
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}

/* ---- Phase icon ---- */

function PhaseIcon({ status, className }: { status: PhaseStatus; className: string }) {
  if (status === 'success') {
    return (
      <svg className={`h-4 w-4 ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  if (status === 'failed') {
    return (
      <svg className={`h-4 w-4 ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    );
  }
  if (status === 'running') {
    return (
      <svg className={`h-4 w-4 ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    );
  }
  // pending
  return (
    <svg className={`h-4 w-4 ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
