import type { ReadyResponse } from '../../types';

interface DashboardHeaderProps {
  repoCount: number;
  pipelineCount: number;
  modelCount: number;
  avgAccuracy: number | null;
  health?: ReadyResponse;
  isMockData?: boolean;
}

export default function DashboardHeader({
  repoCount,
  pipelineCount,
  modelCount,
  avgAccuracy,
  health,
  isMockData,
}: DashboardHeaderProps) {
  return (
    <div className="space-y-3">
      {/* Mock data banner */}
      {isMockData && (
        <div className="rounded-lg border border-yellow-800 bg-yellow-900/20 px-4 py-3 text-sm text-yellow-300">
          Backend unavailable — showing mock data for preview.
        </div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        {/* Title + Metrics */}
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-6">
          <h2 className="text-2xl font-bold text-white">Dashboard</h2>
          <p className="flex flex-wrap items-center gap-1 text-sm">
            <span className="font-semibold text-white">{repoCount}</span>
            <span className="text-[#52525b]">repos</span>
            <span className="text-[#27272a]">&middot;</span>
            <span className="font-semibold text-white">{pipelineCount}</span>
            <span className="text-[#52525b]">pipelines</span>
            <span className="text-[#27272a]">&middot;</span>
            <span className="font-semibold text-white">{modelCount}</span>
            <span className="text-[#52525b]">modelos</span>
            <span className="text-[#27272a]">&middot;</span>
            <span className="font-semibold text-white">
              {avgAccuracy !== null ? `${avgAccuracy.toFixed(1)}%` : '--'}
            </span>
            <span className="text-[#52525b]">accuracy</span>
          </p>
        </div>

        {/* Health indicators */}
        {health && (
          <div className="flex flex-wrap gap-3">
            <HealthBadge label="Backend" status={health.status === 'ok'} />
            <HealthBadge label="MLflow" status={health.mlflow} />
            <HealthBadge label="Model Server" status={health.model_server} />
          </div>
        )}
      </div>
    </div>
  );
}

function HealthBadge({ label, status }: { label: string; status: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 ${
        status
          ? 'border-[#27272a] bg-[#18181b]'
          : 'border-amber-900/50 bg-amber-900/20'
      }`}
    >
      <div
        className={`h-2 w-2 rounded-full ${
          status ? 'bg-emerald-500' : 'bg-amber-500'
        }`}
      />
      <span
        className={`text-xs font-medium ${
          status ? 'text-white' : 'text-amber-200'
        }`}
      >
        {label}
      </span>
    </div>
  );
}
