import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Pipeline } from '../types';
import { useDeployedModels, useModelTraffic } from '../hooks/useDeployedModels';
import { usePipelineStats } from '../hooks/useDashboard';
import { formatDate, truncate } from '../utils/format';
import { runLink } from '../utils/links';

/**
 * Four numbers read at a glance before anything else on the dashboard: what
 * is serving, how often runs succeed, how much the models are called, and
 * what ran last.
 *
 * Each says "--" rather than 0 when its source could not answer: a dashboard
 * that reads 0 requests while Prometheus is down is wrong, not quiet.
 */
export default function DashboardKpis({
  isAdmin,
  lastRun,
}: {
  isAdmin: boolean;
  lastRun: Pipeline | undefined;
}) {
  const { data: models } = useDeployedModels();
  const { data: traffic } = useModelTraffic();
  const { data: stats } = usePipelineStats();

  const owners = new Set((models ?? []).map((m) => m.owner_username).filter(Boolean)).size;
  const deployedNote = !models
    ? ''
    : models.length === 0
      ? 'none serving yet'
      : isAdmin
        ? `across ${owners} ${owners === 1 ? 'user' : 'users'}`
        : 'serving now';

  const rate = stats?.success_rate ?? null;
  const before = stats?.previous_success_rate ?? null;
  const delta = rate !== null && before !== null ? Math.round((rate - before) * 100) : null;
  const rateNote =
    !stats ? '' : rate === null ? 'no finished runs' : delta === null ? `${stats.finished} finished runs` : `${delta >= 0 ? '+' : ''}${delta} pts vs previous ${stats.window_days}d`;

  const totalRequests = traffic?.available
    ? Object.values(traffic.requests).reduce((sum, n) => sum + n, 0)
    : null;
  const modelCount = traffic ? Object.keys(traffic.requests).length : 0;

  return (
    <section aria-label="Key figures" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Tile label="Deployed models" value={models ? String(models.length) : '--'} note={deployedNote} />
      <Tile
        label="Pipeline success · 30d"
        value={rate === null ? '--' : `${Math.round(rate * 100)}%`}
        note={rateNote}
        tone={delta === null ? 'muted' : delta >= 0 ? 'good' : 'bad'}
      />
      <Tile
        label="Prediction requests · 30d"
        value={totalRequests === null ? '--' : totalRequests.toLocaleString()}
        note={
          !traffic
            ? ''
            : !traffic.available
              ? 'Prometheus unreachable'
              : `across ${modelCount} ${modelCount === 1 ? 'model' : 'models'}`
        }
      />
      <Tile
        label="Last run"
        value={
          lastRun ? (
            <Link to={runLink(lastRun.id, lastRun.project_id)} className="hover:text-brand-400 hover:underline">
              {truncate(lastRun.id, 8)}
            </Link>
          ) : (
            '--'
          )
        }
        note={lastRun ? `${lastRun.status} · ${formatDate(lastRun.started_at)}` : 'no runs yet'}
        tone={lastRun?.status === 'failed' ? 'bad' : lastRun?.status === 'running' ? 'accent' : 'muted'}
      />
    </section>
  );
}

const TONES = {
  muted: 'text-slate-400',
  good: 'text-emerald-300',
  bad: 'text-rose-300',
  accent: 'text-brand-300',
} as const;

function Tile({
  label,
  value,
  note,
  tone = 'muted',
}: {
  label: string;
  value: ReactNode;
  note: string;
  tone?: keyof typeof TONES;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-700 bg-slate-800/40 px-5 py-4">
      <span className="text-xs font-medium text-slate-400">{label}</span>
      <span className="font-display text-3xl font-semibold leading-none text-slate-100">{value}</span>
      <span className={`min-h-[1rem] text-xs ${TONES[tone]}`}>{note}</span>
    </div>
  );
}
