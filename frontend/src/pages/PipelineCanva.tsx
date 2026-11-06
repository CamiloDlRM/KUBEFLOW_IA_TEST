import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { Navigate, Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getPipelineInput, getProjects, setPipelineInput } from '../api/client';
import type { PipelineInputChoice } from '../types';
import { ReactFlow, Background, Controls, Panel } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Node, NodeOrigin, ReactFlowInstance } from '@xyflow/react';
import { INPUT_DRAG_TYPE, decodeChoice } from '../components/canvas/phases';
import RunPipelineModal from '../components/RunPipelineModal';
import NodePanel, { CODE_PANEL_WIDTH, PANEL_MARGIN, PANEL_WIDTH } from '../components/flow/NodePanel';
import { renderNodePanelContent } from '../components/flow/NodePanelContent';
import RunPicker from '../components/flow/RunPicker';
import { buildNodes, edges, isPhase, steps } from '../components/flow/pipelineNodes';
import { ACTIVE, usePipelineView } from '../components/flow/usePipelineView';
import { ChevronDown, Play } from 'lucide-react';

const FOCUS_ZOOM = 1.5;
const CAMERA_DURATION = 600;

// A node's position is its left edge and vertical middle, not its top-left corner.
// Nodes differ in height (some have more lines), so with top-left anchoring their
// middles — and the arrows between them — would not line up.
const NODE_ORIGIN: NodeOrigin = [0, 0.5];

/** Phases open wider: they show code. */
const panelWidthFor = (nodeId: string) => (isPhase(nodeId) ? CODE_PANEL_WIDTH : PANEL_WIDTH);

// React Flow's dark mode, tuned to the app's slate palette.
const darkTheme = {
  '--xy-background-color': '#0f172a', // slate-900
  '--xy-background-pattern-color': '#334155', // slate-700
  '--xy-node-background-color': '#1e293b', // slate-800
  '--xy-node-border-color': '#475569', // slate-600
  '--xy-node-color': '#e2e8f0', // slate-200
  '--xy-edge-stroke': '#64748b', // slate-500
  '--xy-controls-button-background-color': '#1e293b',
  '--xy-controls-button-background-color-hover': '#334155',
  '--xy-controls-button-color': '#e2e8f0',
  '--xy-controls-button-border-color': '#334155',
} as CSSProperties;

export default function PipelineCanva() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: getProjects });
  const project = projects?.find((p) => p.id === Number(projectId));
  const navigate = useNavigate();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [openNode, setOpenNode] = useState<string | null>(null);
  const [flow, setFlow] = useState<ReactFlowInstance | null>(null);
  const openStep = steps.find((s) => s.id === openNode);
  const queryClient = useQueryClient();
  // `?run=` (from a run's detail page) opens on that run; otherwise the newest.
  const [searchParams] = useSearchParams();
  const [selection, setSelection] = useState<string | null>(searchParams.get('run'));
  const view = usePipelineView(project, selection);

  // Same key as the Input panel: choosing there (or dropping on the node) updates the node too.
  const inputState = useQuery({
    queryKey: ['pipeline-input', project?.id],
    queryFn: () => getPipelineInput(project!.id),
    enabled: project !== undefined,
  });
  const resolvedInput = inputState.data?.resolved;
  // Rebuilt only when something they show changes, so React Flow is not handed new nodes every render.
  const { cards, inputStatus, modelStatus, accuracy, deployed } = view;
  const nodes = useMemo(
    () => buildNodes(resolvedInput, { cards, inputStatus, modelStatus, accuracy, deployed }),
    [resolvedInput, cards, inputStatus, modelStatus, accuracy, deployed],
  );
  const [runOpen, setRunOpen] = useState(false);

  const busy = view.busy;
  const notebook = project?.repository?.notebook_path;
  const runBlocked = !project?.repository
    ? 'This project has no repository linked'
    : !notebook
      ? 'The linked repository has no notebook selected'
      : busy
        ? 'A run of this pipeline is already queued or running'
        : undefined;

  // The run on screen jumps to a run as soon as it starts, wherever it was
  // launched from. The first load keeps its run: `?run=` picked it on purpose.
  const activeRunId = view.runs.find((run) => ACTIVE.has(run.status))?.id;
  const seenActive = useRef<string | undefined | null>(null);
  useEffect(() => {
    if (view.runsLoading) return;
    const first = seenActive.current === null;
    if (!first && activeRunId && activeRunId !== seenActive.current) setSelection(activeRunId);
    seenActive.current = activeRunId;
  }, [activeRunId, view.runsLoading]);

  // The backend answers with the run it started, or the one already in flight.
  function runStarted(pipelineId: string) {
    setRunOpen(false);
    setSelection(pipelineId);
    queryClient.invalidateQueries({ queryKey: ['project-runs', project?.id] });
  }

  // Lives here, not in the Input panel, because a drop on the Input node chooses too.
  const chooseInput = useMutation({
    mutationFn: (choice: PipelineInputChoice) => setPipelineInput(project!.id, choice),
    onSuccess: (state) => queryClient.setQueryData(['pipeline-input', project?.id], state),
  });

  // A layer chip from the palette, dragged over the Input node.
  function overInputNode(event: DragEvent) {
    const target = event.target as Element;
    return (
      event.dataTransfer.types.includes(INPUT_DRAG_TYPE) &&
      target.closest('.react-flow__node[data-id="input"]') !== null
    );
  }

  function handleDragOver(event: DragEvent) {
    if (!overInputNode(event)) return;
    event.preventDefault(); // Without this the browser refuses the drop.
    event.dataTransfer.dropEffect = 'copy';
  }

  function handleDrop(event: DragEvent) {
    if (!overInputNode(event) || !project) return;
    event.preventDefault();
    const choice = decodeChoice(event.dataTransfer.getData(INPUT_DRAG_TYPE));
    if (choice) chooseInput.mutate(choice);
  }

  // Centre the node in the space left of the panel, not in the whole canvas.
  function focusNode(node: Node) {
    setOpenNode(node.id);
    if (!flow) return;
    const width = node.measured?.width ?? 0;
    const height = node.measured?.height ?? 0;
    // From the node's anchor (NODE_ORIGIN) to its middle.
    const centerX = node.position.x + width * (0.5 - NODE_ORIGIN[0]);
    const centerY = node.position.y + height * (0.5 - NODE_ORIGIN[1]);
    const offset = (panelWidthFor(node.id) + PANEL_MARGIN) / 2 / FOCUS_ZOOM;
    flow.setCenter(centerX + offset, centerY, { zoom: FOCUS_ZOOM, duration: CAMERA_DURATION });
  }

  function closePanel() {
    if (!openNode) return;
    setOpenNode(null);
    flow?.fitView({ duration: CAMERA_DURATION });
  }

  function chooseProject(id: number) {
    setPickerOpen(false);
    setSelection(null); // another project's runs
    navigate(`/pipelines/canvas/${id}`);
  }

  if (!projectId && projects?.length) {
    return <Navigate to={`/pipelines/canvas/${projects[0].id}`} replace />;
  }

  const projectLabel = project?.name ?? (projects ? 'Project not found' : 'Loading...');

  return (
    <div
      className="relative w-full h-full [&_.react-flow\_\_handle]:opacity-0"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        colorMode="dark"
        nodesDraggable={false}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        style={darkTheme}
        nodeOrigin={NODE_ORIGIN}
        onInit={setFlow}
        onNodeClick={(_, node) => focusNode(node)}
        onPaneClick={closePanel}
        fitView
      >
        <Background />
        <Controls showZoom={true} showFitView={true} showInteractive={false} />
        <Panel position="top-left" className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => setRunOpen(true)}
            disabled={runBlocked !== undefined}
            title={runBlocked}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 font-display text-sm font-semibold text-white shadow-lg transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play size={14} aria-hidden="true" />
            {busy ? 'Running…' : 'Run pipeline'}
          </button>
          <RunPicker runs={view.runs} selected={view.runId} branch={view.repo?.branch ?? ''} onSelect={setSelection} />
        </Panel>
        <Panel position="top-center">
          <div className="relative">
            <button type="button" onClick={() => setPickerOpen((open) => !open)} aria-expanded={pickerOpen} className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/90 px-4 py-2 font-display text-sm font-medium text-slate-100 shadow-lg backdrop-blur transition hover:border-slate-500">
              {projectLabel}
              <ChevronDown size={14} className={`text-slate-400 transition-transform ${pickerOpen ? 'rotate-180' : 'rotate-0'}`} aria-hidden="true" />
            </button>
            {
              pickerOpen && (
                <ul className="absolute left-1/2 top-full mt-2 max-h-72 w-64 -translate-x-1/2 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-1 shadow-xl">
                  {projects?.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => chooseProject(p.id)}
                        className={`w-full truncate rounded-md px-3 py-2 text-left font-display text-sm transition ${p.id === project?.id
                          ? 'bg-brand-600/20 text-brand-400'
                          : 'text-slate-300 hover:bg-slate-800 hover:text-slate-100'
                          }`}
                      >
                        {p.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )
            }
          </div>
        </Panel>
        <Panel position="bottom-center" className="max-w-xl space-y-2">
          {project && !view.repo && (
            <p className="rounded-lg border border-slate-700 bg-slate-900/90 px-4 py-2 text-sm text-slate-300">
              This project has no repository linked, so there is no notebook to run.{' '}
              <Link to={`/projects/${project.id}`} className="text-brand-400 hover:text-brand-300">
                Link one
              </Link>
              .
            </p>
          )}
          {view.failure && (
            <p className="rounded-lg border border-red-800 bg-red-950/90 px-4 py-2 text-sm text-red-300">
              <span className="font-semibold">Failed at {view.failure.stage}:</span> {view.failure.message}
            </p>
          )}
          {view.noCodeReason && (
            <p className="rounded-lg border border-slate-700 bg-slate-900/90 px-4 py-2 text-xs text-slate-400">
              {view.noCodeReason === 'never-downloaded'
                ? 'This run stopped before it downloaded the notebook'
                : 'This run predates code capture'}
              , so the phases show the code on {view.repo?.branch} now.
            </p>
          )}
          {view.head.isError && !view.fromRun && (
            <p className="rounded-lg border border-red-800 bg-red-950/90 px-4 py-2 text-xs text-red-300">
              {view.head.error.message}
            </p>
          )}
        </Panel>
      </ReactFlow>
      {runOpen && project && (
        <RunPipelineModal project={project} onClose={() => setRunOpen(false)} onStarted={runStarted} />
      )}
      {
        openStep && (
          <NodePanel
            title={openStep.label}
            caption={openStep.caption}
            width={panelWidthFor(openStep.id)}
            onClose={closePanel}
          >
            {renderNodePanelContent(openStep.id, { projectId: project?.id, chooseInput, view })}
          </NodePanel>
        )
      }
    </div>
  );
}