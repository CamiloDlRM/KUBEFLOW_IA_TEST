import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import {
  getPipelineInput,
  getPipelineInputOptions,
  getPipelines,
  getProject,
  getProjectNotebook,
  setPipelineInput,
} from '../api/client';
import { usePipeline } from '../hooks/usePipelines';
import Spinner from '../components/Spinner';
import RunPipelineModal from '../components/RunPipelineModal';
import InputPalette from '../components/canvas/InputPalette';
import RunList, { BRANCH_CODE } from '../components/canvas/RunList';
import { Connector, InputNode, ModelNode, PhaseNode, cardStatusOfPhase } from '../components/canvas/Nodes';
import { InputDetail, ModelDetail, PhaseDetail } from '../components/canvas/NodeDetail';
import DataPeek from '../components/canvas/DataPeek';
import { latestPhases, mountedOf, phaseCards, sameChoice } from '../components/canvas/phases';
import type { PipelineInputChoice, Project, ProjectRepository } from '../types';
import { repoNameFromUrl } from '../utils/format';

/**
 * A project's pipeline as a row of nodes: the data going in, each phase of
 * the notebook, the model coming out.
 *
 * It answers the question the run log could not: which data went into which
 * code. The input is chosen by dragging a layer onto it, every phase opens to
 * the code it ran and what that code printed, and Run starts the next one
 * from the same place.
 */
export default function PipelineCanvas() {
  const { projectId } = useParams<{ projectId: string }>();
  const id = Number(projectId);
  const { data: project, isLoading, error } = useQuery({
    queryKey: ['project', id],
    queryFn: () => getProject(id),
    enabled: Number.isFinite(id),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="lg" />
      </div>
    );
  }
  if (error != null || !project) {
    return (
      <p className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-300">
        {(error as Error)?.message ?? 'Project not found.'}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          to={`/projects/${project.id}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-400 hover:text-brand-300"
        >
          ← {project.name}
        </Link>
        <h2 className="mt-2 text-2xl font-bold text-slate-100">Pipeline</h2>
      </div>
      {project.repository ? (
        <Canvas project={project} repo={project.repository} />
      ) : (
        <p className="rounded-lg border border-slate-700 bg-slate-900/40 px-5 py-4 text-sm text-slate-400">
          This project has no repository linked, so there is no notebook to run.{' '}
          <Link to={`/projects/${project.id}`} className="text-brand-400 hover:text-brand-300">
            Link one
          </Link>{' '}
          and its pipeline appears here.
        </p>
      )}
    </div>
  );
}

const ACTIVE = new Set(['queued', 'running']);

function Canvas({ project, repo }: { project: Project; repo: ProjectRepository }) {
  const queryClient = useQueryClient();
  const [selection, setSelection] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [peek, setPeek] = useState<{ choice: PipelineInputChoice; label: string } | null>(null);

  const runsQuery = useQuery({
    queryKey: ['project-runs', project.id],
    queryFn: () => getPipelines(1, 15, project.id),
    refetchInterval: (query) =>
      query.state.data?.items.some((run) => ACTIVE.has(run.status)) ? 5_000 : 15_000,
  });
  const runs = runsQuery.data?.items ?? [];
  const runId = selection ?? runs[0]?.id ?? (runsQuery.isLoading ? null : BRANCH_CODE);
  const onRun = runId !== null && runId !== BRANCH_CODE;

  const { data: run } = usePipeline(onRun ? runId : undefined);
  const shownRun = onRun ? run : undefined;
  const fromRun = Boolean(shownRun?.cells?.length);

  // The branch's notebook: what the next run executes, and the only code there
  // is to show before a first run or for a run older than code capture.
  const head = useQuery({
    queryKey: ['project-notebook', project.id, repo.branch],
    queryFn: () => getProjectNotebook(project.id),
    enabled: runId === BRANCH_CODE || (shownRun !== undefined && !fromRun),
    staleTime: 60_000,
  });

  const inputState = useQuery({
    queryKey: ['pipeline-input', project.id],
    queryFn: () => getPipelineInput(project.id),
  });
  const options = useQuery({
    queryKey: ['pipeline-input-options', project.id],
    queryFn: () => getPipelineInputOptions(project.id),
  });

  const choose = useMutation({
    mutationFn: (choice: PipelineInputChoice) => setPipelineInput(project.id, choice),
    onSuccess: (state) => queryClient.setQueryData(['pipeline-input', project.id], state),
  });

  const [runOpen, setRunOpen] = useState(false);
  const started = (pipelineId: string) => {
    setRunOpen(false);
    setSelection(pipelineId);
    queryClient.invalidateQueries({ queryKey: ['project-runs', project.id] });
  };

  // No cards until the code is known. With no cells, every required phase
  // would read as missing — a red row that is only a request still in flight.
  const cells = fromRun ? shownRun!.cells! : head.data?.cells;
  const cards = cells ? phaseCards(cells, fromRun ? shownRun : undefined) : [];
  const phases = shownRun ? latestPhases(shownRun.phases) : {};
  const finished = shownRun?.status === 'success' || shownRun?.status === 'failed';
  const inputStatus = cardStatusOfPhase(phases.dataset?.status, Boolean(shownRun), finished);
  const modelStatus = cardStatusOfPhase(
    (phases.deploy ?? phases.register)?.status,
    Boolean(shownRun),
    finished,
  );
  const mounted = mountedOf(shownRun);
  const busy = runs.some((item) => ACTIVE.has(item.status));
  const focused = cards.find((card) => card.id === focus);

  // A run that stopped before the notebook: every card would say "never ran"
  // and none would say why. The reason goes above the row instead.
  const stoppedEarly =
    shownRun?.status === 'failed' && !cards.some((card) => card.status === 'failed')
      ? phases.error?.logs
      : undefined;

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-700 bg-slate-900/40 px-5 py-4">
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-100">{repoNameFromUrl(repo.github_url)}</p>
          <p className="truncate font-mono text-xs text-slate-500">
            {repo.branch} · {repo.notebook_path || 'no notebook selected'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRunOpen(true)}
          disabled={busy || !repo.notebook_path}
          title={busy ? 'A run of this pipeline is already queued or running' : undefined}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play size={14} aria-hidden="true" />
          {busy ? 'Running…' : 'Run pipeline'}
        </button>
      </header>
      {runOpen && <RunPipelineModal project={project} onClose={() => setRunOpen(false)} onStarted={started} />}

      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="space-y-6">
          <section className="relative rounded-2xl border border-slate-700 bg-slate-900/40 p-4">
            <h3 className="text-sm font-semibold text-slate-100">Data</h3>
            <p className="mb-3 mt-0.5 text-xs text-slate-500">
              Click to preview, drag onto Input to use.
            </p>
            <InputPalette
              options={options.data}
              current={inputState.data?.choice ?? {}}
              previewing={peek?.choice ?? null}
              disabled={choose.isPending}
              onChoose={(choice) => choose.mutate(choice)}
              onPreview={(choice, label) =>
                setPeek(peek && sameChoice(peek.choice, choice) ? null : { choice, label })
              }
            />
            {options.isError && (
              <p className="mt-2 text-xs text-red-300">{(options.error as Error).message}</p>
            )}
            {peek && (
              <DataPeek
                projectId={project.id}
                choice={peek.choice}
                label={peek.label}
                onClose={() => setPeek(null)}
                onUse={() => {
                  choose.mutate(peek.choice);
                  setPeek(null);
                }}
              />
            )}
          </section>
          <section className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-100">Runs</h3>
            <RunList
              runs={runs}
              selected={runId ?? ''}
              branch={repo.branch}
              onSelect={(next) => setSelection(next)}
            />
          </section>
        </aside>

        <div className="min-w-0 space-y-4">
          {choose.isError && (
            <p className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-2 text-sm text-red-300">
              Could not use that input: {(choose.error as Error).message}
            </p>
          )}
          {stoppedEarly && (
            <p className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-2 text-sm text-red-300">
              This run stopped before the notebook: {stoppedEarly}
            </p>
          )}
          {shownRun && !fromRun && (
            <p className="text-xs text-slate-500">
              This run predates code capture, so the cards show the code on {repo.branch} now.
            </p>
          )}

          <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-[radial-gradient(circle,_rgba(148,163,184,0.12)_1px,_transparent_1px)] bg-[length:18px_18px] p-6">
            <ol aria-label="Pipeline" className="flex min-w-max items-stretch">
              <li className="flex">
                <InputNode
                  state={inputState.data}
                  mounted={mounted}
                  status={inputStatus}
                  selected={focus === 'input'}
                  busy={choose.isPending}
                  onSelect={() => setFocus(focus === 'input' ? null : 'input')}
                  onChoose={(choice) => choose.mutate(choice)}
                />
              </li>
              {cards.map((card, index) => (
                <li key={card.id} className="flex">
                  <Connector />
                  <PhaseNode
                    card={card}
                    step={index + 1}
                    selected={focus === card.id}
                    onSelect={() => setFocus(focus === card.id ? null : card.id)}
                  />
                </li>
              ))}
              <li className="flex">
                <Connector />
                <ModelNode
                  status={modelStatus}
                  accuracy={typeof shownRun?.metrics.accuracy === 'number' ? shownRun.metrics.accuracy : undefined}
                  deployed={Boolean(shownRun?.metrics.deployed)}
                  selected={focus === 'model'}
                  onSelect={() => setFocus(focus === 'model' ? null : 'model')}
                />
              </li>
            </ol>
            {!cells && !head.isError && (
              <p className="mt-4 flex items-center gap-2 text-xs text-slate-500">
                <Spinner size="sm" /> Loading the notebook…
              </p>
            )}
            {head.isError && !fromRun && (
              <p className="mt-4 text-xs text-red-300">{(head.error as Error).message}</p>
            )}
          </div>

          {focus === 'input' && <InputDetail state={inputState.data} run={shownRun} />}
          {focus === 'model' && <ModelDetail run={shownRun} />}
          {focused && (
            <PhaseDetail
              card={focused}
              fromRun={fromRun}
              notebookPath={head.data?.notebook_path || repo.notebook_path}
              branch={(fromRun && shownRun?.branch) || repo.branch}
            />
          )}
          {!focus && (
            <p className="text-center text-xs text-slate-500">
              Click a card to see its code and what it printed.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
