import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { applyInsight, generateInsight, getInsights } from '../api/client';
import Markdown from './Markdown';
import Spinner from './Spinner';
import { formatDate } from '../utils/format';
import type { PipelineStatus } from '../types';

interface Props {
  pipelineId: string;
  pipelineStatus: PipelineStatus;
}

/**
 * AI advisor panel for a pipeline run. Shows the latest AI-generated
 * feedback report, polls while one is being generated, lets the user
 * request a new analysis, and can push the suggested code changes to the
 * `testing-ia-agent` branch of the repository.
 */
export default function AIInsights({ pipelineId, pipelineStatus }: Props) {
  const queryClient = useQueryClient();

  const { data: insights, isLoading } = useQuery({
    queryKey: ['insights', pipelineId],
    queryFn: () => getInsights(pipelineId),
    // Poll while an analysis or an apply/push is in flight
    refetchInterval: (query) => {
      const items = query.state.data;
      const busy = items?.some(
        (i) =>
          i.status === 'pending' ||
          i.status === 'generating' ||
          i.apply_status === 'queued' ||
          i.apply_status === 'applying',
      );
      return busy ? 5_000 : false;
    },
  });

  const generateMutation = useMutation({
    mutationFn: () => generateInsight(pipelineId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['insights', pipelineId] }),
  });

  const applyMutation = useMutation({
    mutationFn: (insightId: number) => applyInsight(pipelineId, insightId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['insights', pipelineId] }),
  });

  const latest = insights?.[0];
  const busy = latest?.status === 'pending' || latest?.status === 'generating';
  const applying = latest?.apply_status === 'queued' || latest?.apply_status === 'applying';
  const pipelineFinished = pipelineStatus === 'success' || pipelineStatus === 'failed';

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-400">
          <SparklesIcon />
          AI Training Advisor
        </h3>
        {pipelineFinished && (
          <button
            onClick={() => generateMutation.mutate()}
            disabled={busy || generateMutation.isPending}
            className="flex items-center gap-2 rounded-lg border border-fuchsia-500/40 bg-fuchsia-500/10 px-3 py-1.5 text-xs font-medium text-fuchsia-300 transition hover:bg-fuchsia-500/20 disabled:opacity-50"
          >
            {(busy || generateMutation.isPending) && <Spinner size="sm" />}
            {latest ? 'Regenerate analysis' : 'Analyze this run'}
          </button>
        )}
      </div>

      <div className="rounded-lg border border-fuchsia-500/20 bg-slate-800/60 p-5">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Spinner size="lg" />
          </div>
        )}

        {!isLoading && !latest && (
          <p className="py-4 text-center text-sm text-slate-500">
            {pipelineFinished
              ? 'No AI analysis yet. Click "Analyze this run" to have the advisor review the training code, metrics, and history.'
              : 'The AI advisor will analyze this run automatically once the pipeline finishes.'}
          </p>
        )}

        {generateMutation.isError && (
          <div className="mb-4 rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-300">
            {(generateMutation.error as Error).message}
          </div>
        )}

        {latest && busy && (
          <div className="flex items-center gap-3 py-6 text-sm text-slate-400">
            <Spinner size="sm" />
            The advisor is reviewing the notebook code and metrics... this usually takes under a minute.
          </div>
        )}

        {latest?.status === 'failed' && (
          <div className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-300">
            Analysis failed: {latest.error || 'unknown error'}
          </div>
        )}

        {latest?.status === 'ready' && (
          <div>
            <Markdown content={latest.content} />

            {/* Apply suggestions & push */}
            <div className="mt-5 rounded-lg border border-slate-700 bg-slate-900/50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-200">
                    Apply suggestions to the code
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    The advisor rewrites the notebook with its recommendations and pushes
                    it to the <code className="text-amber-300">testing-ia-agent</code> branch.
                  </p>
                </div>
                <button
                  onClick={() => applyMutation.mutate(latest.id)}
                  disabled={applying || applyMutation.isPending}
                  className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-fuchsia-600 to-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-fuchsia-600/20 transition hover:opacity-90 disabled:opacity-50"
                >
                  {(applying || applyMutation.isPending) && <Spinner size="sm" />}
                  {latest.apply_status === 'pushed'
                    ? 'Push again'
                    : applying
                      ? 'Applying...'
                      : 'Apply & push'}
                </button>
              </div>

              {applyMutation.isError && (
                <p className="mt-3 text-xs text-red-400">
                  {(applyMutation.error as Error).message}
                </p>
              )}

              {applying && (
                <p className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                  <Spinner size="sm" />
                  Rewriting the notebook and pushing to GitHub... you can leave this page.
                </p>
              )}

              {latest.apply_status === 'failed' && (
                <p className="mt-3 rounded border border-red-800 bg-red-900/20 px-3 py-2 text-xs text-red-300">
                  Push failed: {latest.apply_error || 'unknown error'}
                </p>
              )}

              {latest.apply_status === 'pushed' && (
                <div className="mt-3 rounded border border-emerald-700 bg-emerald-900/20 px-3 py-2 text-xs text-emerald-300">
                  Pushed to branch <code className="font-semibold">{latest.apply_branch}</code>{' '}
                  (commit <code>{latest.apply_commit_sha.slice(0, 8)}</code>). Review the diff
                  on GitHub, then use <span className="font-semibold">Run pipeline</span> on the
                  Dashboard selecting that branch to train with the improved code.
                </div>
              )}
            </div>

            <p className="mt-5 border-t border-slate-700/60 pt-3 text-xs text-slate-500">
              Generated by <span className="text-slate-400">{latest.model}</span> ·{' '}
              {formatDate(latest.finished_at)}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function SparklesIcon() {
  return (
    <svg className="h-4 w-4 text-fuchsia-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.29 6.86L21 12l-5.71 2.14L13 21l-2.29-6.86L5 12l5.71-2.14L13 3z" />
    </svg>
  );
}
