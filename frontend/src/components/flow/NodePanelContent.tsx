import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, type UseMutationResult } from '@tanstack/react-query';
import { Database } from 'lucide-react';
import { getPipelineInput, getPipelineInputOptions, getWsUrl } from '../../api/client';
import { usePipelineLogs } from '../../hooks/usePipelines';
import { useWebSocket } from '../../hooks/useWebSocket';
import type { PipelineInputChoice, PipelineInputState } from '../../types';
import { truncate } from '../../utils/format';
import InputPalette from '../canvas/InputPalette';
import DataPeek from '../canvas/DataPeek';
import { Keys, ModelSummary, PhaseDetail } from '../canvas/NodeDetail';
import { NOTEBOOK_PHASES, latestPhases, sameChoice } from '../canvas/phases';
import LogViewer from '../LogViewer';
import MetricsChart from '../MetricsChart';
import Spinner from '../Spinner';
import { cellLogs, logsForNode } from './nodeLogs';
import { ACTIVE, type PipelineView } from './usePipelineView';

/** Saves which data the next run trains on. Lives in the page so a drop on the Input node can use it too. */
export type ChooseInput = UseMutationResult<PipelineInputState, Error, PipelineInputChoice>;

/** What every panel body may need from the page. */
export interface NodePanelContext {
    projectId: number | undefined;
    chooseInput: ChooseInput;
    view: PipelineView;
}

/** The preview sits inside the panel instead of floating beside the palette. */
const INLINE_PEEK =
    'mb-4 flex max-h-[50vh] flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-950 focus:outline-none';

/** Data sources for the pipeline: what it uses now, and the layers it can switch to. */
export function InputPanel({ projectId, chooseInput, view }: NodePanelContext) {
    const [peek, setPeek] = useState<{ choice: PipelineInputChoice; label: string } | null>(null);

    // Keyed by project, like the pipeline view, so both share the same cache.
    const inputState = useQuery({
        queryKey: ['pipeline-input', projectId],
        queryFn: () => getPipelineInput(projectId!),
        enabled: projectId !== undefined,
    });
    const options = useQuery({
        queryKey: ['pipeline-input-options', projectId],
        queryFn: () => getPipelineInputOptions(projectId!),
        enabled: projectId !== undefined,
    });

    if (projectId === undefined) {
        return <p className="text-sm text-slate-400">Choose a project to see its data.</p>;
    }

    const current = inputState.data;
    const run = view.shownRun;

    return (
        <div className="space-y-4">
            <section className="rounded-xl border border-slate-700 bg-slate-950/40 px-4 py-3">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">In use · next run</h4>
                <p className="mt-1 truncate text-sm text-slate-100">
                    {current ? current.resolved?.label ?? 'Not dataset' : 'Loading…'}
                </p>
                <p className="text-[11px] text-slate-500">Mounted into the notebook as DATASET_PATH.</p>
                {current?.resolved && (
                    <div className="mt-2">
                        <Keys input={current.resolved} />
                    </div>
                )}
                {current?.error && <p className="mt-1 text-xs text-red-300">{current.error}</p>}
                {current && !current.resolved && (
                    // Nothing to train on: send them where data is extracted and the layers are built.
                    <Link
                        to={`/projects/${projectId}/data`}
                        className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-500"
                    >
                        <Database size={12} aria-hidden="true" />
                        Add data
                    </Link>
                )}
            </section>

            {run && (
                // What the run on screen mounted, which may differ from the next run's choice.
                <section className="rounded-xl border border-slate-800 px-4 py-3">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">This run</h4>
                    {view.mounted ? (
                        <>
                            <p className="mt-1 truncate text-sm text-slate-100">{view.mounted.label}</p>
                            <div className="mt-2">
                                <Keys input={view.mounted} />
                            </div>
                        </>
                    ) : (
                        <p className="mt-1 text-sm text-slate-400">
                            {latestPhases(run.phases).dataset?.logs || 'This run did not record what it mounted.'}
                        </p>
                    )}
                </section>
            )}

            {run && <NodeLogs nodeId="input" view={view} />}

            {chooseInput.isError && (
                <p className="rounded-lg border border-red-800 bg-red-900/20 px-3 py-2 text-xs text-red-300">
                    Could not use that input: {chooseInput.error.message}
                </p>
            )}

            {peek && (
                <DataPeek
                    projectId={projectId}
                    choice={peek.choice}
                    label={peek.label}
                    className={INLINE_PEEK}
                    onClose={() => setPeek(null)}
                    onUse={() => {
                        chooseInput.mutate(peek.choice);
                        setPeek(null);
                    }}
                />
            )}

            <section>
                <p className="mb-3 text-xs text-slate-500">Click a layer to preview it, or drag it onto the Input node.</p>
                <InputPalette
                    options={options.data}
                    current={current?.choice ?? {}}
                    previewing={peek?.choice ?? null}
                    disabled={chooseInput.isPending}
                    onChoose={(choice) => chooseInput.mutate(choice)}
                    onPreview={(choice, label) =>
                        setPeek(peek && sameChoice(peek.choice, choice) ? null : { choice, label })
                    }
                />
                {options.isError && <p className="mt-2 text-xs text-red-300">{options.error.message}</p>}
            </section>
        </div>
    );
}

/** One component for every notebook phase: the code it ran and what it printed. */
export function PhasePanel({ phaseId, projectId, view }: { phaseId: string } & NodePanelContext) {
    const phase = NOTEBOOK_PHASES.find((p) => p.id === phaseId);

    if (!view.repo) {
        return (
            <p className="text-sm text-slate-400">
                This project has no repository linked, so there is no notebook to show.{' '}
                <Link to={`/projects/${projectId}`} className="text-brand-400 hover:text-brand-300">
                    Link one
                </Link>
                .
            </p>
        );
    }
    if (!view.cards) {
        return view.head.isError ? (
            <p className="text-sm text-red-300">{view.head.error.message}</p>
        ) : (
            <p className="flex items-center gap-2 text-sm text-slate-400">
                <Spinner size="sm" /> Loading the notebook…
            </p>
        );
    }

    const card = view.cards.find((c) => c.id === phaseId);
    if (!card) {
        // An optional phase with no cells: the run simply goes on without it.
        return (
            <p className="text-sm text-slate-400">
                {phaseId === 'setup' ? (
                    'Every cell in the notebook has an mlops tag, so there is no setup code.'
                ) : (
                    <>
                        No cell is tagged <code className="font-mono text-slate-200">mlops:{phaseId}</code>.{' '}
                        {phase?.label} is optional, so runs go on without it.
                    </>
                )}
            </p>
        );
    }

    const detail = { card, fromRun: view.fromRun, notebookPath: view.notebookPath, branch: view.branch };
    // No run on screen: only the branch's code, so there is nothing to log.
    if (!view.shownRun || card.status === 'missing') return <PhaseDetail {...detail} />;

    // Two windows, like an editor over its terminal: the code on top, what it printed and raised below.
    // Each scrolls on its own, so a long notebook never pushes the error out of sight.
    return (
        <div className="flex h-full min-h-0 flex-col gap-3">
            <div className="min-h-0 flex-[3]">
                <PhaseDetail {...detail} fill hideOutput />
            </div>
            <div className="min-h-0 flex-[2]">
                <NodeLogs nodeId={phaseId} view={view} fill />
            </div>
        </div>
    );
}

/** Registration in MLflow and, when the metrics clear the bar, deployment — plus the run's metrics and logs. */
export function ModelPanel({ view }: NodePanelContext) {
    const run = view.shownRun;
    if (!run) {
        return (
            <p className="text-sm text-slate-400">
                After the notebook runs, its model is logged to MLflow, and deployed when its accuracy clears the
                threshold. {view.runs.length ? 'Pick a run to see what became of its model.' : 'Nothing has run yet.'}
            </p>
        );
    }

    // The project's runs, oldest first, so the chart reads left to right.
    const history = [...view.runs]
        .reverse()
        .filter((r) => r.metrics && Object.keys(r.metrics).length > 0)
        .map((r) => ({ label: truncate(r.id, 6), metrics: r.metrics }));

    return (
        <div className="space-y-6">
            <section className="space-y-3">
                <ModelSummary run={run} />
            </section>

            <section>
                <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Metrics across runs
                </h4>
                <div className="rounded-xl border border-slate-700 bg-slate-950/40 p-4">
                    <MetricsChart dataPoints={history} />
                </div>
            </section>

            <NodeLogs nodeId="model" view={view} />

            {/* The AI advisor stays on the run's own page for now. */}
            <Link to={`/pipelines/${run.id}`} className="block text-xs text-brand-400 hover:underline">
                AI advice for this run →
            </Link>
        </div>
    );
}

/**
 * The shown run's log lines that belong to this node (see nodeLogs.ts): live
 * from the WebSocket while the run is in flight, from the API once it has finished.
 */
function NodeLogs({ nodeId, view, fill = false }: { nodeId: string; view: PipelineView; fill?: boolean }) {
    const run = view.shownRun!;
    const live = ACTIVE.has(run.status);
    const finished = run.status === 'success' || run.status === 'failed';
    const { messages, status } = useWebSocket(live ? getWsUrl(run.id) : null);
    const stored = usePipelineLogs(run.id, finished);

    if (finished && stored.isLoading) {
        return (
            <p className="flex items-center gap-2 text-sm text-slate-400">
                <Spinner size="sm" /> Loading logs…
            </p>
        );
    }

    const all = live ? messages : stored.data?.logs ?? [];
    // A phase's own lines come from the run's cells, and only when the run kept them.
    const card = view.fromRun ? view.cards?.find((c) => c.id === nodeId) : undefined;
    const when = latestPhases(run.phases).execute?.timestamp ?? run.started_at;
    const lines = [...cellLogs(card, run.id, when), ...logsForNode(nodeId, all, view.errorNode)];
    const broke = run.status === 'failed' && view.errorNode === nodeId;

    return (
        <section className={fill ? 'flex h-full min-h-0 flex-col' : ''}>
            <h4
                className={`mb-2 shrink-0 text-[11px] font-semibold uppercase tracking-wider ${broke ? 'text-red-400' : 'text-slate-500'}`}
            >
                {broke ? 'Logs · the run failed here' : 'Logs'}
            </h4>
            <div className={fill ? 'min-h-0 flex-1' : ''}>
                <LogViewer
                    messages={lines}
                    status={live ? status : undefined}
                    title={`${run.id.slice(0, 8)} · this step`}
                    emptyText={live ? 'Waiting for log output…' : 'Nothing was logged for this step in this run.'}
                    fill={fill}
                />
            </div>
        </section>
    );
}

/** Picks the panel body for the node that is open. */
export function renderNodePanelContent(nodeId: string, context: NodePanelContext) {
    if (nodeId === 'input') return <InputPanel {...context} />;
    if (nodeId === 'model') return <ModelPanel {...context} />;
    return <PhasePanel phaseId={nodeId} {...context} />;
}
