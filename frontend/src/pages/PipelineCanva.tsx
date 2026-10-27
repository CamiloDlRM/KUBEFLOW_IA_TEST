import { ReactFlow, Background, Controls, MiniMap } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const nodes = [
  { id: '1', position: { x: 0, y: 0 }, data: { label: 'API' } },
  { id: '2', position: { x: 250, y: 100 }, data: { label: 'Postgres' } },
];

const edges = [{ id: 'e1-2', source: '1', target: '2' }];

export default function PipelineCanva() {
    return (
    <div style={{ width: '100%', height: '100vh' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={(_, node) => console.log('Seleccionaste', node.id)}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}