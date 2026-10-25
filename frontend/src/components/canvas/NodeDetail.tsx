import type { ReactNode } from 'react';
import type { MountedInput, Pipeline, PipelineInputState } from '../../types';
import CodeEditor from './CodeEditor';
import { STATUS_STYLES } from './Nodes';
import { latestPhases, mountedOf, type PhaseCard } from './phases';

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
}: {
  card: PhaseCard;
  fromRun: boolean;
  notebookPath: string;
  branch: string;
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
      status={
        fromRun
          ? `${STATUS_STYLES[card.status].label} · the code this run executed`
          : 'the code on the branch now'
      }
    />
  );
}

function Keys({ input }: { input: MountedInput }) {
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

export function InputDetail({ state, run }: { state: PipelineInputState | undefined; run?: Pipeline }) {
  const mounted = mountedOf(run);
  const phase = run ? latestPhases(run.phases).dataset : undefined;
  return (
    <Panel title="Input" subtitle="Mounted into the notebook as DATASET_PATH">
      <div>
        <h4 className="text-xs font-semibold text-slate-300">Next run</h4>
        {state?.error ? (
          <p className="mt-1 text-sm text-red-300">{state.error}</p>
        ) : state?.resolved ? (
          <>
            <p className="mt-1 text-sm text-slate-100">{state.resolved.label}</p>
            <Keys input={state.resolved} />
          </>
        ) : (
          <p className="mt-1 text-sm text-slate-400">
            The project's active dataset — whatever was last uploaded or built. Drag a layer
            onto Input to choose instead.
          </p>
        )}
      </div>
      {run && (
        <div>
          <h4 className="text-xs font-semibold text-slate-300">This run</h4>
          {mounted ? (
            <>
              <p className="mt-1 text-sm text-slate-100">{mounted.label}</p>
              <Keys input={mounted} />
            </>
          ) : (
            <p className="mt-1 text-sm text-slate-400">
              {phase?.logs || 'This run did not record what it mounted.'}
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}

export function ModelDetail({ run }: { run?: Pipeline }) {
  if (!run) {
    return (
      <Panel title="Register & deploy">
        <p className="text-sm text-slate-400">
          After the notebook runs, its model is logged to MLflow, and deployed when its accuracy
          clears the threshold. Nothing has run yet.
        </p>
      </Panel>
    );
  }
  const phases = latestPhases(run.phases);
  const metrics = Object.entries(run.metrics).filter(([, value]) => typeof value === 'number');
  return (
    <Panel title="Register & deploy">
      {(['register', 'deploy'] as const).map((name) => (
        <p key={name} className="text-sm text-slate-300">
          <span className="font-semibold text-slate-100">{name}:</span>{' '}
          {phases[name]?.logs || (run.status === 'success' || run.status === 'failed' ? 'did not happen' : 'not yet')}
        </p>
      ))}
      {phases.error && <p className="text-sm text-red-300">{phases.error.logs}</p>}
      {metrics.length > 0 && (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {metrics.map(([name, value]) => (
            <div key={name} className="rounded-lg bg-slate-950/60 px-3 py-2">
              <dt className="text-[11px] text-slate-500">{name}</dt>
              <dd className="font-mono text-sm tabular-nums text-slate-100">{(value as number).toFixed(4)}</dd>
            </div>
          ))}
        </dl>
      )}
    </Panel>
  );
}
