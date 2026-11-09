import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPipelines, getProjectNotebook } from '../../api/client';
import { usePipeline } from '../../hooks/usePipelines';
import type { Pipeline, PipelinePhase, Project } from '../../types';
import { BRANCH_CODE } from '../canvas/RunList';
import { cardStatusOfPhase } from '../canvas/Nodes';
import { latestPhases, mountedOf, phaseCards, type CardStatus } from '../canvas/phases';
import { errorNodeOf } from './nodeLogs';

/** Run statuses that mean a run is still in flight. */
export const ACTIVE = new Set(['queued', 'running']);

/** The backend's steps, in run order. `dataset` happens inside `execute`, before the notebook. */
const STAGES = ['download', 'validate', 'dataset', 'execute', 'register', 'deploy'];

/**
 * Where a failed run broke: the last step that failed, or that started and
 * never finished (the error was raised before it could record its outcome).
 */
function failedStage(run: Pipeline, phases: Record<string, PipelinePhase>): string | undefined {
  if (run.status !== 'failed') return undefined;
  const broken = (status: string) => status === 'failed' || status === 'running';
  return [...STAGES].reverse().find((name) => phases[name] && broken(phases[name].status));
}

/**
 * A phase's status in a run that saved no code (it broke before downloading the
 * notebook, or predates code capture). Without cells there is no telling which
 * phase failed, but there is whether the notebook ran at all.
 */
function statusWithoutCells(run: Pipeline, phases: Record<string, PipelinePhase>): CardStatus {
  const execute = phases.execute?.status;
  if (execute === 'success') return 'completed';
  if (execute === 'running' && run.status === 'running') return 'running';
  if (run.status === 'success' || run.status === 'failed') return 'skipped';
  return 'waiting';
}

/**
 * Everything the canvas shows about a project's pipeline, as the old pipeline
 * view worked it out: which run is on screen, the code it ran (or the code on
 * the branch when there is no run), and how far each phase got.
 *
 * `selection` is the run picked by hand: a run id, BRANCH_CODE, or null to
 * follow the newest run.
 */
export function usePipelineView(project: Project | undefined, selection: string | null) {
  const repo = project?.repository ?? null;

  // Same key as the old view, so a run started in either shows in both.
  // Polls faster while a run is in flight, so statuses move on their own.
  const runsQuery = useQuery({
    queryKey: ['project-runs', project?.id],
    queryFn: () => getPipelines(1, 15, project!.id),
    enabled: project !== undefined,
    refetchInterval: (query) =>
      query.state.data?.items.some((run) => ACTIVE.has(run.status)) ? 5_000 : 15_000,
  });
  const runs = runsQuery.data?.items ?? [];
  // Null while the list loads: not knowing yet is not the same as "no runs".
  const runId = selection ?? runs[0]?.id ?? (runsQuery.isLoading ? null : BRANCH_CODE);
  const onRun = runId !== null && runId !== BRANCH_CODE;

  const { data: run } = usePipeline(onRun ? runId : undefined);
  const shownRun = onRun ? run : undefined;
  // Runs older than code capture carry no cells; the branch's code stands in.
  const fromRun = Boolean(shownRun?.cells?.length);

  const head = useQuery({
    queryKey: ['project-notebook', project?.id, repo?.branch],
    queryFn: () => getProjectNotebook(project!.id),
    enabled: repo !== null && (runId === BRANCH_CODE || (shownRun !== undefined && !fromRun)),
    staleTime: 60_000,
  });

  // Undefined until the code is known, so no phase reads as "missing" while it loads.
  const cells = fromRun ? shownRun!.cells! : head.data?.cells;
  // Memoised so the canvas only rebuilds its nodes when the code or the run changes.
  const cards = useMemo(() => {
    if (!cells) return undefined;
    if (fromRun || !shownRun) return phaseCards(cells, fromRun ? shownRun : undefined);
    // A run with no code of its own: the branch's code stands in for the layout,
    // but the statuses come from the run, which did happen. "Not run" would be wrong.
    const status = statusWithoutCells(shownRun, latestPhases(shownRun.phases));
    return phaseCards(cells).map((card) => (card.status === 'missing' ? card : { ...card, status }));
  }, [cells, fromRun, shownRun]);

  const phases = shownRun ? latestPhases(shownRun.phases) : {};
  const finished = shownRun?.status === 'success' || shownRun?.status === 'failed';
  const inputStatus = cardStatusOfPhase(phases.dataset?.status, Boolean(shownRun), finished);
  const modelStatus = cardStatusOfPhase((phases.deploy ?? phases.register)?.status, Boolean(shownRun), finished);

  // Where a failed run broke, said in words whenever no node can show it: a
  // failed cell marks its phase, a failed mount marks Input, a failed register
  // or deploy marks Model. Download, validation and crashes have no node.
  const stage = shownRun ? failedStage(shownRun, phases) : undefined;
  const shownOnNode =
    inputStatus === 'failed' || modelStatus === 'failed' || cards?.some((card) => card.status === 'failed');
  const failure =
    shownRun?.status === 'failed' && !shownOnNode
      ? {
          stage: stage ?? 'an unknown step',
          message: phases.error?.logs || (stage && phases[stage]?.logs) || 'No reason was recorded.',
        }
      : undefined;

  // Why the phases show the branch's code instead of the run's.
  const noCodeReason = !shownRun || fromRun
    ? undefined
    : phases.download?.status === 'success'
      ? 'predates-capture'
      : 'never-downloaded';

  const accuracy = shownRun?.metrics.accuracy;

  return {
    repo,
    runs,
    runsLoading: runsQuery.isLoading,
    runId,
    shownRun,
    fromRun,
    head,
    cards,
    inputStatus,
    modelStatus,
    mounted: mountedOf(shownRun),
    accuracy: typeof accuracy === 'number' ? accuracy : undefined,
    deployed: Boolean(shownRun?.metrics.deployed),
    busy: runs.some((item) => ACTIVE.has(item.status)),
    failure,
    /** The node whose panel shows the run's final error. */
    errorNode: errorNodeOf({ cards, modelStatus, stage }),
    noCodeReason,
    notebookPath: head.data?.notebook_path || repo?.notebook_path || '',
    branch: (fromRun && shownRun?.branch) || repo?.branch || '',
  };
}

export type PipelineView = ReturnType<typeof usePipelineView>;
