import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { Navigate, Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getPipelineInput, getProjects, setPipelineInput } from '../api/client';
import type { PipelineInputChoice } from '../types';
import { ReactFlow, Background, Controls, Panel } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import '../components/flow/canvas.css';
import type { Node, NodeOrigin, ReactFlowInstance } from '@xyflow/react';
import { INPUT_DRAG_TYPE, decodeChoice } from '../components/canvas/phases';
import RunPipelineModal from '../components/RunPipelineModal';
import { BACK_BUTTON_CLASS } from '../components/BackLink';
import NodePanel, { PANEL_MARGIN, panelWidthFor } from '../components/flow/NodePanel';
import { renderNodePanelContent } from '../components/flow/NodePanelContent';
import { MAIA_PANEL, MaiaAvatar, MaiaPanelContent, maiaMoodFor } from '../components/flow/Maia';
import RunPicker from '../components/flow/RunPicker';
import { buildNodes, edges, steps } from '../components/flow/pipelineNodes';
import { ACTIVE, usePipelineView } from '../components/flow/usePipelineView';
import { ArrowLeft, ChevronDown, Play } from 'lucide-react';

const FOCUS_ZOOM = 1.8; // React Flow's default maxZoom is 2
const CAMERA_DURATION = 600;
/** Extra screen pixels the focused node moves left, so it sits clear of the panel rather than near it. */
const FOCUS_NUDGE = 60;
/** Matches the move's CSS transition (duration-700) plus a beat to settle. */
const SWIM_DURATION = 800;
/** Maia at rest at the bottom, and opened: about the width of a node. */
const MAIA_SIZE = 80;
const MAIA_EXPANDED = 150;
/** React Flow's gap between a panel and the canvas edge. */
const MAIA_BOTTOM = 15;

// A node's position is its left edge and vertical middle, not its top-left corner.
// Nodes differ in height (some have more lines), so with top-left anchoring their
// middles — and the arrows between them — would not line up.
const NODE_ORIGIN: NodeOrigin = [0, 0.5];

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
  const builtNodes = useMemo(
    () => buildNodes(resolvedInput, { cards, inputStatus, modelStatus, accuracy, deployed }),
    [resolvedInput, cards, inputStatus, modelStatus, accuracy, deployed],
  );
  // The node whose panel is open glows white (`.node-open` in index.css).
  const nodes = useMemo(
    () =>
      builtNodes.map((node) =>
        node.id === openNode ? { ...node, className: `${node.className ?? ''} node-open` } : node,
      ),
    [builtNodes, openNode],
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
    const offset = (maiaShift + FOCUS_NUDGE) / FOCUS_ZOOM;
    flow.setCenter(centerX + offset, centerY, { zoom: FOCUS_ZOOM, duration: CAMERA_DURATION });
  }

  function closePanel() {
    if (!openNode) return;
    setOpenNode(null);
    flow?.fitView({ duration: CAMERA_DURATION });
  }

  // Maia's panel takes the place of a node's: one panel open at a time. The camera
  // stays put, since she talks about the whole run rather than one node.
  const maiaOpen = openNode === MAIA_PANEL;
  const [autoAnalyze, setAutoAnalyze] = useState(false);

  // While she moves out of the panel's way (or back), she swims: leaning into the move,
  // tentacles beating faster. Only on open and close, not when one panel replaces another.
  const panelOpen = openNode !== null;
  const [swimming, setSwimming] = useState<'left' | 'right' | null>(null);
  const wasOpen = useRef(panelOpen);
  useEffect(() => {
    if (wasOpen.current === panelOpen) return;
    wasOpen.current = panelOpen;
    setSwimming(panelOpen ? 'left' : 'right');
    const timer = window.setTimeout(() => setSwimming(null), SWIM_DURATION);
    return () => window.clearTimeout(timer);
  }, [panelOpen]);
  // The canvas's size, to place Maia in the middle of the space the panel leaves.
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setCanvasSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // The panel scales with the canvas, so on a small screen it leaves room for the nodes.
  const panelWidth = panelWidthFor(canvasSize.width);
  const freeWidth = Math.max(canvasSize.width - panelWidth - PANEL_MARGIN, 0);
  /** How far Maia moves left with a panel open: to the middle of the space the panel leaves. */
  const maiaShift = (panelWidth + PANEL_MARGIN) / 2;

  // Opened, Maia grows to about a node's size in the middle of the free space, and the
  // nodes move up out of her way to the top of it.
  // `analyze`: opened from a failure, so she starts reviewing the run without another click.
  function openMaia(analyze = false) {
    setOpenNode(MAIA_PANEL);
    setAutoAnalyze(analyze);
    if (!flow || !canvasSize.width) return;
    const bounds = flow.getNodesBounds(flow.getNodes());
    const zoom = Math.min(1.2, (freeWidth * 0.85) / Math.max(bounds.width, 1));
    const screenX = freeWidth / 2;
    const screenY = canvasSize.height * 0.24;
    flow.setViewport(
      {
        x: screenX - (bounds.x + bounds.width / 2) * zoom,
        y: screenY - (bounds.y + bounds.height / 2) * zoom,
        zoom,
      },
      { duration: CAMERA_DURATION },
    );
  }
  // From her spot at the bottom to the middle of the free space, a little below centre
  // so the nodes above have room. The sideways move is already done by maiaShift.
  const maiaRise = MAIA_BOTTOM + MAIA_SIZE / 2 - canvasSize.height * 0.4;
  const maiaExpanded: CSSProperties | undefined = maiaOpen
    ? { transform: `translateY(${maiaRise}px) scale(${MAIA_EXPANDED / MAIA_SIZE})` }
    : undefined;

  // Each click on her gives off a flash; the key restarts its animation.
  const [flash, setFlash] = useState(0);
  function toggleMaia() {
    setFlash((count) => count + 1);
    if (maiaOpen) closePanel();
    else openMaia();
  }

  function chooseProject(id: number) {
    setPickerOpen(false);
    setSelection(null); // another project's runs
    // Replace, not push: switching projects here should not become a stop for Back.
    navigate(`/pipelines/canvas/${id}`, { replace: true });
  }

  // Back to wherever the canvas was opened from. Opened directly (a bookmark, a new
  // tab), there is no such place in the app, so it goes to the list of runs instead.
  // React Router numbers each history entry it makes (`idx`); a replace keeps the number,
  // so a redirect into the canvas still counts as the first page.
  const cameFromApp = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;
  function goBack() {
    if (cameFromApp) navigate(-1);
    else navigate('/pipelines');
  }

  if (!projectId && projects?.length) {
    return <Navigate to={`/pipelines/canvas/${projects[0].id}`} replace />;
  }

  const projectLabel = project?.name ?? (projects ? 'Project not found' : 'Loading...');

  return (
    <div
      ref={canvasRef}
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
        <Panel position="top-right">
          {/* Same look as the Home button on the sign-in pages. */}
          <button
            type="button"
            onClick={goBack}
            className={BACK_BUTTON_CLASS}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {cameFromApp ? 'Back' : 'Pipelines'}
          </button>
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
        <Panel position="bottom-center" className="max-w-xl">
          {/* With a panel open on the right, Maia (and the notices with her) swim left to the
              middle of the space that is left, so the panel never covers her. */}
          <div
            className="flex flex-col items-center gap-2 transition-transform duration-700 ease-in-out motion-reduce:transition-none"
            style={{ transform: openNode ? `translateX(-${maiaShift}px)` : undefined }}
          >
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
            <p className="max-h-[25vh] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-red-800 bg-red-950/90 px-4 py-2 text-sm text-red-300">
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
            <p className="max-h-[25vh] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-red-800 bg-red-950/90 px-4 py-2 text-xs text-red-300">
              {view.head.error.message}
            </p>
          )}
          {/* She is sad when the run failed: offer her review of it, right above her. */}
          {view.shownRun?.status === 'failed' && !maiaOpen && (
            <button
              type="button"
              onClick={() => openMaia(true)}
              className="rounded-full border border-red-500/40 bg-slate-900/90 px-4 py-1.5 text-xs font-semibold text-red-200 shadow-lg transition hover:bg-red-950/90"
            >
              Ask Maia what went wrong
            </button>
          )}
          {/* Maia floats at the bottom, under any notice; she looks at the cursor and
              closes her eyes when it is on her (`maia-hover`). Opened, she grows and rises
              to the middle of the free space (maiaExpanded). */}
          <button
            type="button"
            onClick={toggleMaia}
            aria-label="Ask Maia, your AI advisor"
            aria-pressed={maiaOpen}
            title="Ask Maia about this run"
            style={maiaExpanded}
            // A glow that follows her outline: with no backdrop, a box shadow would draw a circle.
            className={`maia-hover relative mt-2 rounded-full transition duration-500 ease-in-out hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 motion-reduce:transition-none ${
              maiaOpen ? 'drop-shadow-[0_0_12px_rgba(167,139,250,0.9)]' : 'drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)]'
            }`}
          >
            {flash > 0 && <span key={flash} aria-hidden="true" className="maia-flash" />}
            <MaiaAvatar size={MAIA_SIZE} followCursor swimming={swimming} mood={maiaMoodFor(view, openNode)} />
          </button>
          </div>
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
            onClose={closePanel}
            width={panelWidth}
          >
            {renderNodePanelContent(openStep.id, { projectId: project?.id, chooseInput, view, openMaia })}
          </NodePanel>
        )
      }
      {maiaOpen && (
        <NodePanel
          title="Maia"
          // The gradient "Maia" is written in across the app (sidebar, landing, sign-in).
          titleClassName="bg-gradient-to-r from-indigo-400 via-violet-400 to-fuchsia-400 bg-clip-text text-transparent"
          caption="Your AI training advisor · reviews this run's code, metrics and history"
          onClose={closePanel}
          width={panelWidth}
        >
          <MaiaPanelContent view={view} autoAnalyze={autoAnalyze} />
        </NodePanel>
      )}
    </div>
  );
}