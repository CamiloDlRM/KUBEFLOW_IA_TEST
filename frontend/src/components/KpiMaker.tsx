import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { askForDashboard, getDashboardConversation } from '../api/client';
import type { DashboardTurn } from '../types';
import Spinner from './Spinner';

/**
 * Ask for a dashboard over gold, then keep asking until it is right.
 *
 * A conversation rather than a form, because a dashboard is not specified in
 * one sentence. The first prompt asks for something, the second moves a chart,
 * the third says the split is wrong — and each of those only means anything if
 * the model knows what it already built. The backend keeps the exchanges and
 * replays them, so "make that one a line chart" has a referent.
 *
 * Every tool call the agent made is kept, collapsed, under its answer. That is
 * the difference between being told a dashboard was built and being able to
 * see what was done to build it — and when it comes out wrong, the sequence of
 * calls is the only account of why that does not come from the model itself.
 */
export default function KpiMaker({ projectId }: { projectId: number }) {
  const [prompt, setPrompt] = useState('');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', projectId],
    queryFn: () => getDashboardConversation(projectId),
  });

  const ask = useMutation({
    mutationFn: (text: string) => askForDashboard(projectId, text),
    onSuccess: (conversation) => {
      queryClient.setQueryData(['dashboard', projectId], conversation);
      setPrompt('');
    },
  });

  const turns = data?.turns ?? [];
  const busy = ask.isPending;

  return (
    <section className="rounded-lg border border-slate-700 bg-slate-900/40">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 px-5 py-4">
        <div>
          <h3 className="text-base font-semibold text-slate-100">KPI maker</h3>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">
            Describe what you want to see and the agent builds it in Superset, over
            this project's <span className="text-yellow-300">gold</span> table. Keep
            asking to change it — it edits the dashboard it already made rather than
            starting a new one.
          </p>
        </div>
        {data?.superset_url && (
          <a
            href={data.superset_url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-800"
          >
            Open Superset ↗
          </a>
        )}
      </header>

      <div className="space-y-4 px-5 py-4">
        {isLoading && <Spinner />}

        {!isLoading && turns.length === 0 && (
          <p className="text-sm text-slate-500">
            Nothing asked for yet. Try{' '}
            <span className="text-slate-300">
              “encounters per month, split by class”
            </span>
            .
          </p>
        )}

        {turns.map((turn) => (
          <Exchange key={turn.id} turn={turn} />
        ))}

        {busy && (
          <div className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900 px-4 py-3">
            <Spinner />
            {/* Said out loud because it is true and the wait is long enough
                that silence reads as a hang. */}
            <p className="text-sm text-slate-400">
              Working in Superset. This takes a while: the model looks at what is
              there, then builds one piece at a time.
            </p>
          </div>
        )}

        {ask.isError && (
          <p className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-300">
            {(ask.error as Error).message}
          </p>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (prompt.trim() && !busy) ask.mutate(prompt.trim());
          }}
          className="space-y-2"
        >
          <label htmlFor="kpi-prompt" className="block text-xs text-slate-400">
            {turns.length === 0 ? 'What should the dashboard show?' : 'What should change?'}
          </label>
          <textarea
            id="kpi-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            disabled={busy}
            rows={3}
            className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 disabled:opacity-50"
            placeholder={
              turns.length === 0
                ? 'Encounters per month, split by class, and the average cost alongside'
                : 'Make the second chart a line, and only the last two years'
            }
          />
          <button
            type="submit"
            disabled={busy || !prompt.trim()}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-500 disabled:opacity-40"
          >
            {turns.length === 0 ? 'Build it' : 'Send'}
          </button>
        </form>
      </div>
    </section>
  );
}

function Exchange({ turn }: { turn: DashboardTurn }) {
  const [open, setOpen] = useState(false);

  return (
    <article className="space-y-2">
      <p className="ml-auto max-w-2xl rounded-lg rounded-br-sm bg-brand-600/20 px-3 py-2 text-sm text-brand-100">
        {turn.prompt}
      </p>

      <div className="max-w-3xl rounded-lg rounded-bl-sm border border-slate-800 bg-slate-900 px-3 py-2">
        <p className="whitespace-pre-wrap text-sm text-slate-200">{turn.summary}</p>

        {turn.exhausted && (
          // The dashboard is then half-built, and saying so is the difference
          // between a user who re-reads it and one who trusts it.
          <p className="mt-2 text-xs text-amber-400">
            The agent ran out of turns before it finished, so the dashboard may be
            incomplete. Ask it to carry on.
          </p>
        )}

        {turn.calls.length > 0 && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setOpen((current) => !current)}
              aria-expanded={open}
              className="text-xs text-slate-500 transition hover:text-slate-300"
            >
              {open ? 'Hide' : 'Show'} what it did — {turn.calls.length}{' '}
              {turn.calls.length === 1 ? 'call' : 'calls'} to Superset
            </button>

            {open && (
              <ol className="mt-2 space-y-1.5 border-l border-slate-800 pl-3">
                {turn.calls.map((call, index) => (
                  <li key={index} className="text-xs">
                    <code className="font-mono text-brand-300">{call.name}</code>
                    <span className="ml-1.5 break-all text-slate-600">
                      {JSON.stringify(call.arguments)}
                    </span>
                    {call.result && (
                      <p className="mt-0.5 whitespace-pre-wrap break-all text-slate-500">
                        {call.result.slice(0, 400)}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
