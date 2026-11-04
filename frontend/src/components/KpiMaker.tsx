import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  ChartColumn,
  ChevronRight,
  CircleCheck,
  CircleX,
  Database,
  ExternalLink,
  LayoutDashboard,
  Pencil,
  Search,
  SendHorizontal,
  Sparkles,
  TriangleAlert,
  User,
  Wrench,
} from 'lucide-react';
import { askForDashboard, getDashboardConversation } from '../api/client';
import type { DashboardToolCall, DashboardTurn } from '../types';
import Spinner from './Spinner';
import EmbeddedDashboard from './EmbeddedDashboard';
import Markdown from './Markdown';
import { describeStep, summarizeSteps, type StepKind } from './kpi/steps';

/**
 * Ask for a dashboard over gold, then keep asking until it is right.
 *
 * A conversation rather than a form, because a dashboard is not specified in
 * one sentence. The first prompt asks for something, the second moves a chart,
 * the third says the split is wrong — and each of those only means anything if
 * the model knows what it already built. The backend keeps the exchanges and
 * replays them, so "make that one a line chart" has a referent.
 *
 * It reads as a chat: what was asked on the right, what the agent answered on
 * the left with its formatting intact, and under each answer the steps it took
 * in Superset — said in words, each marked done or failed, the raw call one
 * click away. When a dashboard comes out wrong, those steps are the only
 * account of why that does not come from the model itself.
 */

const SUGGESTIONS = [
  'Encounters per month, split by class',
  'Average total claim cost by encounter class',
  'A table of the 10 most expensive encounter types',
];

export default function KpiMaker({ projectId }: { projectId: number }) {
  const [prompt, setPrompt] = useState('');
  const queryClient = useQueryClient();
  const composer = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', projectId],
    queryFn: () => getDashboardConversation(projectId),
  });

  const ask = useMutation({
    mutationFn: (text: string) => askForDashboard(projectId, text),
    onSuccess: (conversation) => queryClient.setQueryData(['dashboard', projectId], conversation),
  });

  const turns = data?.turns ?? [];
  const busy = ask.isPending;
  // Only exchanges that called Superset can have built anything to show.
  const latest = [...turns].reverse().find((turn) => turn.calls.length > 0);
  const first = turns.length === 0;

  // Keep the newest exchange in view, as a chat does.
  useEffect(() => {
    const box = transcript.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [turns.length, busy]);

  // The composer grows with what is typed, up to a few lines.
  useEffect(() => {
    const box = composer.current;
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = `${Math.min(box.scrollHeight, 160)}px`;
  }, [prompt]);

  function send() {
    const text = prompt.trim();
    if (!text || busy) return;
    // Cleared at once, as a chat does; put back if the request fails, so
    // nothing typed is lost to an error.
    setPrompt('');
    ask.mutate(text, { onError: () => setPrompt(text) });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter is a new line — what every chat does.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  }

  return (
    <div className="space-y-6">
      {/* The result first, and below it the conversation that changes it. */}
      {latest && <EmbeddedDashboard projectId={projectId} version={latest.id} />}

      <section className="flex flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900/40">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-yellow-500/15 text-yellow-300">
              <Sparkles size={16} aria-hidden="true" />
            </span>
            <div>
              <h3 className="text-base font-semibold text-slate-100">KPI maker</h3>
              <p className="mt-0.5 max-w-3xl text-sm text-slate-400">
                Describe what you want to see and the agent builds it in Superset, over this project's{' '}
                <span className="text-yellow-300">gold</span> table. Keep asking to change it — it edits the
                dashboard it already made rather than starting a new one.
              </p>
            </div>
          </div>
          {data?.superset_url && (
            <a
              href={data.superset_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-800"
            >
              Open Superset <ExternalLink size={12} aria-hidden="true" />
            </a>
          )}
        </header>

        <div ref={transcript} className="max-h-[36rem] min-h-[12rem] space-y-6 overflow-y-auto px-5 py-5">
          {isLoading && <Spinner />}

          {!isLoading && first && !busy && (
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <p className="text-sm text-slate-400">Nothing asked for yet. Start with one of these, or write your own.</p>
              <ul className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <li key={suggestion}>
                    <button
                      type="button"
                      onClick={() => {
                        setPrompt(suggestion);
                        composer.current?.focus();
                      }}
                      className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 transition hover:border-yellow-600/60 hover:text-slate-100"
                    >
                      {suggestion}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {turns.map((turn) => (
            <Exchange key={turn.id} turn={turn} />
          ))}

          {busy && (
            <>
              {/* What was just asked shows at once, not when the answer lands. */}
              <UserBubble text={ask.variables ?? ''} time={null} />
              <AgentBubble time={null}>
                <div className="flex items-center gap-3">
                  <TypingDots />
                  {/* Said out loud because it is true and the wait is long
                      enough that silence reads as a hang. */}
                  <p className="text-sm text-slate-400">
                    Working in Superset. This takes a while: the model looks at what is there, then builds one
                    piece at a time.
                  </p>
                </div>
              </AgentBubble>
            </>
          )}

          {ask.isError && (
            <p className="flex items-start gap-2 rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-300">
              <CircleX size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              {(ask.error as Error).message}
            </p>
          )}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
          className="border-t border-slate-800 bg-slate-950/40 px-5 py-4"
        >
          <label htmlFor="kpi-prompt" className="mb-1.5 block text-xs text-slate-400">
            {first ? 'What should the dashboard show?' : 'What should change?'}
          </label>
          <div className="flex items-end gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500">
            <textarea
              id="kpi-prompt"
              ref={composer}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={onKeyDown}
              disabled={busy}
              rows={1}
              className="max-h-40 min-h-[1.5rem] flex-1 resize-none bg-transparent py-1 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none disabled:opacity-50"
              placeholder={
                first
                  ? 'Encounters per month, split by class, and the average cost alongside'
                  : 'Make the second chart a line, and only the last two years'
              }
            />
            <button
              type="submit"
              disabled={busy || !prompt.trim()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-500 disabled:opacity-40"
            >
              {first ? 'Build it' : 'Send'}
              <SendHorizontal size={14} aria-hidden="true" />
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500">Enter to send · Shift+Enter for a new line</p>
        </form>
      </section>
    </div>
  );
}

function time(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function UserBubble({ text, time: at }: { text: string; time: string | null }) {
  return (
    <div className="flex justify-end gap-3">
      <div className="max-w-2xl">
        <p className="whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand-600 px-4 py-2.5 text-sm text-white shadow-sm">
          {text}
        </p>
        {at && <p className="mt-1 text-right text-[10px] text-slate-500">{at}</p>}
      </div>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-700 text-slate-200">
        <User size={14} aria-hidden="true" />
      </span>
    </div>
  );
}

function AgentBubble({ time: at, children }: { time: string | null; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-yellow-500/15 text-yellow-300">
        <Sparkles size={14} aria-hidden="true" />
      </span>
      <div className="min-w-0 max-w-3xl flex-1">
        <div className="rounded-2xl rounded-tl-md border border-slate-800 bg-slate-900 px-4 py-3">{children}</div>
        {at && <p className="mt-1 text-[10px] text-slate-500">Agent · {at}</p>}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <span aria-hidden="true" className="flex gap-1">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          style={{ animationDelay: `${delay}ms` }}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-yellow-300/80"
        />
      ))}
    </span>
  );
}

function Exchange({ turn }: { turn: DashboardTurn }) {
  const at = time(turn.created_at);
  return (
    <article className="space-y-3">
      <UserBubble text={turn.prompt} time={at} />
      <AgentBubble time={at}>
        <Markdown content={turn.summary} />

        {turn.exhausted && (
          // The dashboard is then half-built, and saying so is the difference
          // between a user who re-reads it and one who trusts it.
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
            <TriangleAlert size={14} className="mt-px shrink-0" aria-hidden="true" />
            The agent ran out of turns before it finished, so the dashboard may be incomplete. Ask it to carry on.
          </p>
        )}

        {turn.calls.length > 0 && <Steps calls={turn.calls} />}
      </AgentBubble>
    </article>
  );
}

const STEP_ICONS: Record<StepKind, typeof Search> = {
  lookup: Search,
  dataset: Database,
  chart: ChartColumn,
  edit: Pencil,
  dashboard: LayoutDashboard,
  schema: BookOpen,
  other: Wrench,
};

function Steps({ calls }: { calls: DashboardToolCall[] }) {
  const [open, setOpen] = useState(false);
  const failures = calls.filter((call) => describeStep(call).failed).length;
  const built = summarizeSteps(calls);

  return (
    <div className="mt-3 border-t border-slate-800 pt-2">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 text-left text-xs text-slate-400 transition hover:text-slate-200"
      >
        <ChevronRight size={14} aria-hidden="true" className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        {open ? 'Hide' : 'Show'} what it did — {calls.length} {calls.length === 1 ? 'call' : 'calls'} to Superset
        {built && <span className="text-slate-500">· made {built}</span>}
        {failures > 0 && <span className="text-red-400">· {failures} failed</span>}
      </button>

      {open && (
        <ol className="mt-2 space-y-1">
          {calls.map((call, index) => (
            <StepRow key={index} call={call} />
          ))}
        </ol>
      )}
    </div>
  );
}

function StepRow({ call }: { call: DashboardToolCall }) {
  const [open, setOpen] = useState(false);
  const step = describeStep(call);
  const Icon = STEP_ICONS[step.kind];

  return (
    <li className="rounded-lg border border-transparent hover:border-slate-800">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs"
      >
        <Icon size={14} aria-hidden="true" className="shrink-0 text-slate-400" />
        <span className="text-slate-200">{step.label}</span>
        {step.subject && <span className="truncate text-slate-400">“{step.subject}”</span>}
        <code className="ml-auto shrink-0 font-mono text-[10px] text-slate-500">{call.name}</code>
        {step.failed ? (
          <CircleX size={14} aria-label="failed" className="shrink-0 text-red-400" />
        ) : (
          <CircleCheck size={14} aria-label="done" className="shrink-0 text-emerald-400" />
        )}
      </button>
      {open && (
        <div className="space-y-1.5 px-8 pb-2 font-mono text-[11px]">
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-slate-950 px-2 py-1.5 text-slate-400">
            {JSON.stringify(call.arguments, null, 2)}
          </pre>
          {call.result && (
            <pre
              className={`max-h-48 overflow-auto whitespace-pre-wrap break-all rounded px-2 py-1.5 ${
                step.failed ? 'bg-red-950/40 text-red-300' : 'bg-slate-950 text-slate-500'
              }`}
            >
              {call.result.slice(0, 2000)}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}
