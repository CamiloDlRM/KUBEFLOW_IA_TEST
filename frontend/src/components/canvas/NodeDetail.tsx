import { useState, type ReactNode } from 'react';
import { Archive, Check, Copy, Rocket } from 'lucide-react';
import type { MountedInput, Pipeline } from '../../types';
import CodeEditor from './CodeEditor';
import { STATUS_STYLES } from './Nodes';
import { latestPhases, type PhaseCard } from './phases';

/**
 * What opens under the row when a node is clicked: the code of that phase and
 * what it printed, or what the input resolved to, or what became of the model.
 *
 * The code is the run's own copy when there is a run, so it is what executed
 * rather than what the branch says today.
 */

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section
      aria-label={`${title} detail`}
      className="rounded-2xl border border-slate-700 bg-slate-900/60"
    >
      <header className="border-b border-slate-800 px-5 py-3">
        <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </header>
      <div className="space-y-4 px-5 py-4">{children}</div>
    </section>
  );
}

export function PhaseDetail({
  card,
  fromRun,
  notebookPath,
  branch,
  fill,
  hideOutput,
}: {
  card: PhaseCard;
  fromRun: boolean;
  notebookPath: string;
  branch: string;
  /** Passed to the editor: see CodeEditor. */
  fill?: boolean;
  hideOutput?: boolean;
}) {
  if (card.status === 'missing') {
    return (
      <Panel title={card.label}>
        <p className="text-sm text-red-300">
          No cell is tagged <code className="font-mono">mlops:{card.id}</code>. The run will stop
          at validation until one is: in Jupyter, View → Cell Toolbar → Tags.
        </p>
      </Panel>
    );
  }

  return (
    <CodeEditor
      title={card.label}
      notebookPath={notebookPath}
      branch={branch}
      cells={card.cells}
      fromRun={fromRun}
      fill={fill}
      hideOutput={hideOutput}
      status={
        fromRun
          ? `${STATUS_STYLES[card.status].label} · the code this run executed`
          : 'the code on the branch now'
      }
    />
  );
}

export function Keys({ input }: { input: MountedInput }) {
  return (
    <ul className="space-y-0.5 font-mono text-[11px] text-slate-500">
      {input.keys.slice(0, 8).map((key) => (
        <li key={key} className="truncate">
          s3://{input.bucket}/{key}
        </li>
      ))}
      {input.keys.length > 8 && <li>… and {input.keys.length - 8} more</li>}
    </ul>
  );
}

type StepState = 'done' | 'running' | 'failed' | 'skipped' | 'pending';

const STEP_STYLE: Record<StepState, { label: string; pill: string; dot: string }> = {
  done: { label: 'Done', pill: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30', dot: 'bg-emerald-400' },
  running: { label: 'In progress', pill: 'bg-blue-500/10 text-blue-300 ring-blue-500/30', dot: 'bg-blue-400 animate-pulse' },
  failed: { label: 'Failed', pill: 'bg-red-500/10 text-red-300 ring-red-500/30', dot: 'bg-red-400' },
  skipped: { label: 'Not deployed', pill: 'bg-slate-500/10 text-slate-300 ring-slate-500/30', dot: 'bg-slate-500' },
  pending: { label: 'Not yet', pill: 'bg-slate-500/10 text-slate-400 ring-slate-600/30', dot: 'bg-slate-600' },
};

function stepState(status: string | undefined, runFinished: boolean): StepState {
  if (status === 'success') return 'done';
  if (status === 'failed') return 'failed';
  if (status === 'running') return 'running';
  return runFinished ? 'skipped' : 'pending';
}

/** Runs from before the API named it kept the MLflow run only in the register log. */
function mlflowRunOf(run: Pipeline, registerLog: string | undefined): string | undefined {
  return run.mlflow_run_id || registerLog?.match(/MLflow run (\w+)/)?.[1];
}

function endpointOf(deployLog: string | undefined): string | undefined {
  return deployLog?.match(/Endpoint: (\S+)/)?.[1];
}

function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg bg-slate-950/70 px-3 py-2 ring-1 ring-slate-800">
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-slate-200" title={value}>
        {value}
      </code>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        onClick={() =>
          navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          })
        }
        className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
      >
        {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      </button>
    </div>
  );
}

function StepCard({
  icon,
  title,
  state,
  stateLabel,
  children,
}: {
  icon: ReactNode;
  title: string;
  state: StepState;
  stateLabel?: string;
  children: ReactNode;
}) {
  const style = STEP_STYLE[state];
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-xl border border-slate-700 bg-slate-950/40 p-4">
      <header className="flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          {icon}
          {title}
        </h4>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${style.pill}`}>
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
          {stateLabel ?? style.label}
        </span>
      </header>
      {children}
    </section>
  );
}

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="min-w-0 space-y-1">
    <p className="text-[11px] uppercase tracking-wider text-slate-500">{label}</p>
    {children}
  </div>
);

/** What became of a run's model: its registration in MLflow, its deployment and its metrics. */
export function ModelSummary({ run }: { run: Pipeline }) {
  const phases = latestPhases(run.phases);
  const finished = run.status === 'success' || run.status === 'failed';
  const register = stepState(phases.register?.status, finished);
  const deploy = stepState(phases.deploy?.status, finished);
  const mlflowRun = mlflowRunOf(run, phases.register?.logs);
  const endpoint = endpointOf(phases.deploy?.logs);
  const reason = typeof run.metrics.deploy_reason === 'string' ? run.metrics.deploy_reason : undefined;
  const accuracy = typeof run.metrics.accuracy === 'number' ? run.metrics.accuracy : undefined;
  const metrics = Object.entries(run.metrics).filter(
    ([name, value]) => typeof value === 'number' && name !== 'accuracy',
  ) as [string, number][];

  return (
    <div className="space-y-4">
      {run.model_name && (
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-display text-lg font-semibold text-slate-100">{run.model_name}</span>
          {run.model_version && (
            <span className="rounded-md bg-brand-600/20 px-1.5 py-0.5 font-mono text-xs text-brand-300">
              v{run.model_version}
            </span>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <StepCard icon={<Archive size={15} className="text-amber-400" aria-hidden="true" />} title="Registered in MLflow" state={register}>
          {accuracy !== undefined && (
            <Field label="Accuracy">
              <p className="font-display text-2xl font-semibold tabular-nums text-slate-100">
                {(accuracy * 100).toFixed(2)}%
              </p>
            </Field>
          )}
          {mlflowRun ? (
            <Field label="MLflow run">
              <CopyValue value={mlflowRun} label="MLflow run id" />
            </Field>
          ) : (
            <p className="text-xs text-slate-400">
              {register === 'failed' ? phases.register?.logs : 'The model is logged to MLflow after the notebook runs.'}
            </p>
          )}
        </StepCard>

        <StepCard
          icon={<Rocket size={15} className="text-emerald-400" aria-hidden="true" />}
          title="Deployment"
          state={deploy}
          stateLabel={deploy === 'done' ? 'Live' : undefined}
        >
          {endpoint ? (
            <Field label="Endpoint">
              <CopyValue value={endpoint} label="endpoint" />
            </Field>
          ) : deploy === 'failed' ? (
            <p className="text-xs text-red-300">{phases.deploy?.logs}</p>
          ) : (
            <p className="text-xs text-slate-400">
              {reason ?? (finished ? 'This run was not deployed.' : 'Deployed when its metrics clear the bar.')}
            </p>
          )}
        </StepCard>
      </div>

      {metrics.length > 0 && (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {metrics.map(([name, value]) => (
            <div key={name} className="rounded-lg bg-slate-950/60 px-3 py-2 ring-1 ring-slate-800">
              <dt className="truncate text-[11px] text-slate-500">{name}</dt>
              <dd className="font-mono text-sm tabular-nums text-slate-100">{value.toFixed(4)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
