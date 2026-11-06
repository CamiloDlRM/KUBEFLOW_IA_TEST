import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, type UseMutationResult } from '@tanstack/react-query';
import { Database } from 'lucide-react';
import { getPipelineInput, getPipelineInputOptions } from '../../api/client';
import type { PipelineInputChoice, PipelineInputState } from '../../types';
import InputPalette from '../canvas/InputPalette';
import DataPeek from '../canvas/DataPeek';
import { Keys, ModelSummary, PhaseDetail } from '../canvas/NodeDetail';
import { NOTEBOOK_PHASES, latestPhases, sameChoice } from '../canvas/phases';
import Spinner from '../Spinner';
import type { PipelineView } from './usePipelineView';

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

    return <PhaseDetail card={card} fromRun={view.fromRun} notebookPath={view.notebookPath} branch={view.branch} />;
}

/** Registration in MLflow and, when the metrics clear the bar, deployment. */
export function ModelPanel({ view }: NodePanelContext) {
    if (!view.shownRun) {
        return (
            <p className="text-sm text-slate-400">
                After the notebook runs, its model is logged to MLflow, and deployed when its accuracy clears the
                threshold. {view.runs.length ? 'Pick a run to see what became of its model.' : 'Nothing has run yet.'}
            </p>
        );
    }
    return (
        <div className="space-y-4">
            <ModelSummary run={view.shownRun} />
            <Link to={`/pipelines/${view.shownRun.id}`} className="block text-xs text-brand-400 hover:underline">
                Logs, metrics and AI advice for this run →
            </Link>
        </div>
    );
}

/** Picks the panel body for the node that is open. */
export function renderNodePanelContent(nodeId: string, context: NodePanelContext) {
    if (nodeId === 'input') return <InputPanel {...context} />;
    if (nodeId === 'model') return <ModelPanel {...context} />;
    return <PhasePanel phaseId={nodeId} {...context} />;
}
