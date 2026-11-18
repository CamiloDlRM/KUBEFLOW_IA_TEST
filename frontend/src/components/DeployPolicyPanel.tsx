import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { getRunSettings, setDeployPolicy } from '../api/client';
import type { DeployPolicy } from '../types';
import { SelectMenu, SuggestInput } from './SelectMenu';
import Spinner from './Spinner';

/** "Deploys when recall ≥ 0.9 and it beats the version serving." */
export function describePolicy(policy: DeployPolicy): string {
  if (!policy.auto_deploy) return 'Never deploys on its own — deploy a version from the model’s Versions.';
  const sign = policy.direction === 'higher' ? '≥' : '≤';
  return `Deploys when ${policy.metric} ${sign} ${policy.threshold}${
    policy.must_beat_serving ? ' and it beats the version serving now' : ''
  }.`;
}

/**
 * When this project's model goes to production — decided by the person, not
 * by one platform-wide accuracy bar.
 *
 * The metric is any the notebook logs (the list offers the ones its runs have
 * logged, and another can be typed); the direction says whether higher or
 * lower is better, because a fraud model's recall and a regressor's error
 * point opposite ways. A version that misses the bar is not lost: it can be
 * deployed by hand from the model's Versions.
 */
export default function DeployPolicyPanel({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['run-settings', projectId],
    queryFn: () => getRunSettings(projectId),
  });
  const [draft, setDraft] = useState<DeployPolicy | null>(null);
  useEffect(() => {
    if (data) setDraft(data.policy);
  }, [data]);

  const save = useMutation({
    mutationFn: (changes: Partial<DeployPolicy> & { reset?: boolean }) => setDeployPolicy(projectId, changes),
    onSuccess: (settings) => {
      queryClient.setQueryData(['run-settings', projectId], settings);
      setDraft(settings.policy);
    },
  });

  if (isLoading || !draft) {
    return (
      <section className="rounded-lg border border-slate-700 bg-slate-900/40 px-5 py-4">
        {error ? <p className="text-sm text-red-300">{(error as Error).message}</p> : <Spinner />}
      </section>
    );
  }

  const changed = JSON.stringify(draft) !== JSON.stringify(data?.policy);
  const metrics = Array.from(new Set([...(data?.metrics_available ?? []), 'accuracy']));
  // Said, not refused: a metric the notebook starts logging on its next run is a fair thing to type.
  const neverLogged =
    draft.auto_deploy &&
    Boolean(draft.metric.trim()) &&
    (data?.metrics_available.length ?? 0) > 0 &&
    !data!.metrics_available.includes(draft.metric.trim());
  const field =
    'rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-40';

  function submit(event: FormEvent) {
    event.preventDefault();
    if (draft) save.mutate(draft);
  }

  return (
    <section aria-label="Deployment rules" className="rounded-lg border border-slate-700 bg-slate-900/40">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 px-5 py-4">
        <div>
          <h3 className="text-base font-semibold text-slate-100">Deployment rules</h3>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">{describePolicy(data!.policy)}</p>
        </div>
        {data?.is_default ? (
          <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs text-slate-400">platform default</span>
        ) : (
          <button
            type="button"
            onClick={() => save.mutate({ reset: true })}
            disabled={save.isPending}
            className="text-xs text-slate-400 hover:text-slate-200 disabled:opacity-40"
          >
            Back to platform default
          </button>
        )}
      </header>

      <form onSubmit={submit} className="space-y-4 px-5 py-4">
        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={draft.auto_deploy}
            onChange={(event) => setDraft({ ...draft, auto_deploy: event.target.checked })}
            className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-brand-500 focus:ring-brand-500"
          />
          Deploy automatically when a run meets the bar
        </label>

        <fieldset disabled={!draft.auto_deploy} className="flex flex-wrap items-end gap-3 disabled:opacity-50">
          {/* Not wrapped in their labels: the open list would be read as part of the name. */}
          <div className="flex flex-col gap-1 text-xs text-slate-400">
            <label htmlFor={`metric-${projectId}`}>Metric</label>
            <SuggestInput
              id={`metric-${projectId}`}
              value={draft.metric}
              suggestions={metrics}
              onChange={(metric) => setDraft({ ...draft, metric })}
              className={`${field} w-44 font-display`}
            />
          </div>
          <div className="flex flex-col gap-1 text-xs text-slate-400">
            <span aria-hidden="true">Better is</span>
            <SelectMenu
              label="Better is"
              value={draft.direction}
              options={[
                { value: 'higher', label: 'higher (≥)' },
                { value: 'lower', label: 'lower (≤)' },
              ]}
              onChange={(direction) => setDraft({ ...draft, direction })}
            />
          </div>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Bar
            <input
              type="number"
              step="any"
              value={draft.threshold}
              onChange={(event) => setDraft({ ...draft, threshold: Number(event.target.value) })}
              className={`${field} w-28 font-display`}
            />
          </label>
          <label className="flex items-center gap-2 pb-1.5 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={draft.must_beat_serving}
              onChange={(event) => setDraft({ ...draft, must_beat_serving: event.target.checked })}
              className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-brand-500 focus:ring-brand-500"
            />
            …and beat the version serving now
          </label>
        </fieldset>

        {/* The worker refuses rather than deploy on a comparison it cannot make; said here, before a run is spent finding out. */}
        {draft.auto_deploy && draft.must_beat_serving && (
          <p className="flex items-start gap-2 rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-xs text-slate-400">
            <Info size={14} className="mt-0.5 shrink-0 text-sky-300" aria-hidden="true" />
            <span>
              <span className="font-semibold text-sky-200">A run can only beat a version it can be compared with.</span>{' '}
              If the version serving now never logged <span className="font-display text-slate-300">{draft.metric}</span> —
              it deployed before this metric was chosen — a new run will not deploy on its own. Deploy one from the
              model’s Versions, and later runs are compared again.
            </span>
          </p>
        )}

        {neverLogged && (
          <p className="text-xs text-amber-300">
            No run of this project has logged <span className="font-display">{draft.metric.trim()}</span> yet. Check
            the spelling: a run that does not log it will not deploy.
          </p>
        )}

        {data && data.metrics_available.length > 0 && (
          <p className="text-xs text-slate-500">
            This project’s runs have logged: <span className="font-display">{data.metrics_available.join(', ')}</span>.
            Any metric the notebook logs with <code className="font-display">mlflow.log_metric</code> can decide.
          </p>
        )}

        {save.isError && <p className="text-xs text-red-300">{(save.error as Error).message}</p>}

        <div className="flex justify-end gap-3">
          {changed && (
            <button
              type="button"
              onClick={() => setDraft(data!.policy)}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
            >
              Discard
            </button>
          )}
          <button
            type="submit"
            disabled={!changed || save.isPending || !draft.metric.trim() || !Number.isFinite(draft.threshold)}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-40"
          >
            {save.isPending && <Spinner size="sm" />}
            Save rules
          </button>
        </div>
      </form>
    </section>
  );
}
