import { Link } from 'react-router-dom';
import { useDeployedModels, useModelTraffic } from '../hooks/useDeployedModels';
import { formatDate, modelMetric } from '../utils/format';
import Spinner from './Spinner';

/** How many models an admin sees: the busiest ones, not the whole platform. */
export const ADMIN_TOP = 5;

/**
 * The models that are serving right now.
 *
 * A member sees all of theirs: they are few, and each is their own work. An
 * admin sees every tenant's, which is too many to list on a dashboard, so the
 * section shows the ones taking the most prediction requests: those are the
 * ones whose failure would be felt.
 *
 * A list rather than a table, because it sits in a column beside the recent
 * pipelines. Each model's bar is its requests against the busiest one shown,
 * so which model carries the traffic reads without comparing numbers.
 */
export default function DeployedModels({ isAdmin }: { isAdmin: boolean }) {
  const { data: models, isLoading, error } = useDeployedModels();
  const { data: traffic } = useModelTraffic();

  // Unknown, not zero, when Prometheus could not be read.
  const requestsOf = (name: string): number | null =>
    traffic?.available ? (traffic.requests[name] ?? 0) : null;

  const rows = [...(models ?? [])].sort(
    (a, b) =>
      (requestsOf(b.model_name) ?? -1) - (requestsOf(a.model_name) ?? -1) ||
      a.model_name.localeCompare(b.model_name),
  );
  const shown = isAdmin ? rows.slice(0, ADMIN_TOP) : rows;
  const busiest = Math.max(0, ...shown.map((m) => requestsOf(m.model_name) ?? 0));
  const span = traffic?.window ?? '30d';

  return (
    <section>
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          {isAdmin ? 'Most requested models' : 'My deployed models'}
        </h3>
        <Link to="/models" className="text-xs text-brand-400 hover:underline">
          All models
        </Link>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Spinner />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-300">
          Failed to load models: {(error as Error).message}
        </div>
      )}

      {!isLoading && !error && shown.length === 0 && (
        <p className="rounded-lg border border-slate-700 bg-slate-800/40 px-4 py-6 text-center text-sm text-slate-400">
          {isAdmin
            ? 'No model is deployed on the platform yet.'
            : "You have no deployed models yet. A successful run that passes its project's bar deploys one."}
        </p>
      )}

      {shown.length > 0 && (
        <ul className="divide-y divide-slate-800 rounded-lg border border-slate-700 bg-slate-800/30">
          {shown.map((m) => {
            const metric = modelMetric(m);
            const requests = requestsOf(m.model_name);
            const share = requests && busiest ? requests / busiest : 0;
            return (
              <li key={m.model_name} data-testid="deployed-model" className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-display text-sm text-slate-100" title={m.model_name}>
                      {m.model_name}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      v{m.version}
                      {isAdmin && <> · <span className="text-slate-300">{m.owner_username ?? '--'}</span></>}
                      {' · '}
                      {formatDate(m.deployed_at)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm tabular-nums text-slate-100" data-testid="model-requests">
                      {requests === null ? '--' : requests.toLocaleString()}
                    </p>
                    <p className="text-[11px] uppercase tracking-wider text-slate-500">requests · {span}</p>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-700/60">
                    <div className="h-full rounded-full bg-brand-500" style={{ width: `${share * 100}%` }} />
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">
                    {metric.name} <span className="text-slate-200">{metric.value}</span>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
