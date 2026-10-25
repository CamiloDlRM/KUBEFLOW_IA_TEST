import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ModelDeployment } from '../types';
import { formatDate } from '../utils/format';
import { GrafanaFrame, OpenInGrafanaLink, buildGrafanaEmbedUrl } from './MetricsPanels';

/** Provisioned from grafana/dashboards/mlops-model.json. */
const MODEL_DASHBOARD_UID = 'mlops-model';
const MODEL_DASHBOARD_FROM = 'now-24h';

interface ModelDashboardProps {
  model: ModelDeployment;
  onBack: () => void;
}

/**
 * Detail view of one deployed model: what the deployment record already knows,
 * plus the per-model Grafana dashboard (usage, health, training quality and
 * version history), filtered to this model through the `model` variable.
 */
export default function ModelDashboard({ model, onBack }: ModelDashboardProps) {
  const vars = { model: model.model_name };
  const grafanaUrl = buildGrafanaEmbedUrl(MODEL_DASHBOARD_UID, vars, MODEL_DASHBOARD_FROM);

  return (
    <div className="space-y-6">
      <div>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-400 hover:text-brand-300"
        >
          ← All models
        </button>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-bold text-slate-100">{model.model_name}</h2>
          <span className="text-sm text-slate-400">v{model.version}</span>
          <ModelStatusBadge active={model.is_active} />
        </div>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          Usage, health, training quality and version history of this model.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <InfoCard label="Accuracy">
          <span className="font-mono">{(model.accuracy * 100).toFixed(1)}%</span>
        </InfoCard>
        <InfoCard label="Deployed">{formatDate(model.deployed_at)}</InfoCard>
        <InfoCard label="Produced by">
          {model.pipeline_id ? (
            <Link
              to={`/pipelines/${model.pipeline_id}`}
              className="font-mono text-brand-400 hover:underline"
            >
              {model.pipeline_id.slice(0, 8)}
            </Link>
          ) : (
            <span className="text-slate-500">--</span>
          )}
        </InfoCard>
        <InfoCard label="Endpoint">
          <code className="block truncate text-xs text-slate-400" title={model.endpoint_url}>
            {model.endpoint_url}
          </code>
        </InfoCard>
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
              Live metrics
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Requests, errors and latency per version, accuracy of every version and the
              pipelines that produced them. Refreshes itself every 30 seconds.
            </p>
          </div>
          <OpenInGrafanaLink url={grafanaUrl} />
        </div>
        <GrafanaFrame
          uid={MODEL_DASHBOARD_UID}
          vars={vars}
          from={MODEL_DASHBOARD_FROM}
          title={`Grafana dashboard: ${model.model_name}`}
        />
      </section>
    </div>
  );
}

/* ---- Sub-components ---- */

export function ModelStatusBadge({ active }: { active: boolean }) {
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

function InfoCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-700 bg-slate-800/60 p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <div className="mt-1 text-sm text-slate-200">{children}</div>
    </div>
  );
}
