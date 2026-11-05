import { useState, type CSSProperties } from 'react';
import { Navigate, useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getProjects } from '../api/client';
import { ReactFlow, Background, Controls, MarkerType, Position, Panel } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Node, Edge } from '@xyflow/react';
import { NOTEBOOK_PHASES } from '../components/canvas/phases';
import { ChevronDown } from 'lucide-react';

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

const steps = [
  { id: 'input', label: 'Input' }, ...NOTEBOOK_PHASES.map((phase) => ({ id: phase.id, label: phase.label })), { id: 'model', label: 'Model' }
];

const GAP = 180;

const nodes: Node[] = steps.map((step, index) => ({
  id: step.id,
  type: index === 0 ? 'input' : index === steps.length - 1 ? 'output' : 'default',
  position: { x: index * GAP, y: 0 },
  data: { label: step.label },
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
  className: 'font-body2'
}))

const edges: Edge[] = steps.slice(1).map((step, index) => {
  const prev = steps[index];
  return {
    id: `${prev.id}-${step.id}`,
    source: prev.id,
    target: step.id,
    markerEnd: {
      type: MarkerType.Arrow, color: '#64748b', width: 20, height: 20, strokeWidth: 2
    }
  }
})

export default function PipelineCanva() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: getProjects });
  const project = projects?.find((p) => p.id === Number(projectId));
  const navigate = useNavigate();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [openNode, setOpenNode] = useState<string | null>(null);

  function chooseProject(id: number) {
    setPickerOpen(false);
    navigate(`/pipelines/canvas/${id}`);
  }

  if (!projectId && projects?.length) {
    return <Navigate to={`/pipelines/canvas/${projects[0].id}`} replace />;
  }

  const projectLabel = project?.name ?? (project ? 'Project not found' : 'Loading...');

  return (
    <div className="w-full h-full [&_.react-flow\_\_handle]:opacity-0">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        colorMode="dark"
        nodesDraggable={false}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        style={darkTheme}
        onNodeClick={(_, node) => setOpenNode(node.id)}
        onPaneClick={() => setOpenNode(null)}
        fitView
      >
        <Background />
        <Controls showZoom={true} showFitView={true} showInteractive={false} />
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
      </ReactFlow>
    </div>
  );
}