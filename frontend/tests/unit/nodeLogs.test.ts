import { describe, expect, it } from 'vitest';
import { cellLogs, errorNodeOf, logsForNode, runLogLines } from '../../src/components/flow/nodeLogs';
import type { PhaseCard } from '../../src/components/canvas/phases';
import type { NotebookCell, WebSocketLogMessage } from '../../src/types';

const msg = (phase: string, logs: string, status = 'success'): WebSocketLogMessage => ({
  pipeline_id: 'run-1',
  phase,
  status,
  logs,
  timestamp: '2026-10-01T00:00:00Z',
});

function cell(index: number, output: string, error = ''): NotebookCell {
  return { index, phase: 'training', tags: ['mlops:training'], source: 'fit()', output, error, status: 'completed' };
}

function card(id: string, status: PhaseCard['status'], cells: NotebookCell[] = []): PhaseCard {
  return { id, label: id, caption: '', cells, status };
}

const RUN = [
  msg('download', 'Notebook downloaded'),
  msg('validate', 'Notebook validated'),
  msg('execute', 'Executing notebook with papermill...', 'running'),
  msg('dataset', 'Mounted gold'),
  msg('execute', JSON.stringify([{ cell: 3, output: 'loss 0.2' }])),
  msg('register', 'Registered v3'),
  msg('deploy', 'Deployed'),
  msg('complete', 'Pipeline completed successfully.'),
];

describe('logsForNode', () => {
  it('gives Input what happens before the notebook, without the cell dump', () => {
    expect(logsForNode('input', RUN, 'input').map((m) => m.logs)).toEqual([
      'Notebook downloaded',
      'Notebook validated',
      'Executing notebook with papermill...',
      'Mounted gold',
    ]);
  });

  it('gives Model registration, deployment and the end of the run', () => {
    expect(logsForNode('model', RUN, 'input').map((m) => m.phase)).toEqual(['register', 'deploy', 'complete']);
  });

  it('puts the final error on the node that broke, and nowhere else', () => {
    const failed = [...RUN.slice(0, 4), msg('error', 'ValueError: bad shape', 'failed')];
    expect(logsForNode('training', failed, 'training').map((m) => m.logs)).toEqual(['ValueError: bad shape']);
    expect(logsForNode('input', failed, 'training').some((m) => m.phase === 'error')).toBe(false);
  });
});

describe('errorNodeOf', () => {
  it('is the phase whose cell failed', () => {
    const cards = [card('data', 'completed'), card('training', 'failed'), card('export', 'skipped')];
    expect(errorNodeOf({ cards, modelStatus: 'skipped', stage: 'execute' })).toBe('training');
  });

  it('is Model when registering or deploying failed', () => {
    expect(errorNodeOf({ cards: [], modelStatus: 'failed', stage: 'deploy' })).toBe('model');
  });

  it('is Input when the run broke before the notebook', () => {
    expect(errorNodeOf({ cards: [], modelStatus: 'skipped', stage: 'validate' })).toBe('input');
  });
});

describe('cellLogs', () => {
  it("turns a phase's cells into lines: output, then the error it raised", () => {
    const lines = cellLogs(card('training', 'failed', [cell(4, 'epoch 1\n', 'ValueError: bad shape')]), 'run-1', 't');
    expect(lines.map((l) => [l.phase, l.status, l.logs])).toEqual([
      ['cell 5', 'success', 'epoch 1'],
      ['cell 5', 'failed', 'ValueError: bad shape'],
    ]);
  });
});

describe('runLogLines', () => {
  const saved = [
    { name: 'download', status: 'success' as const, timestamp: '2026-10-01T00:00:10Z', logs: 'downloaded' },
    { name: 'register', status: 'running' as const, timestamp: '2026-10-01T00:04:00Z', logs: 'registering' },
  ];

  it("reads a run's saved phases as log lines", () => {
    expect(runLogLines('run-1', saved).map((l) => [l.phase, l.logs])).toEqual([
      ['download', 'downloaded'],
      ['register', 'registering'],
    ]);
  });

  it('adds only the streamed lines newer than the last saved one', () => {
    const streamed = [
      { ...msg('register', 'registering', 'running'), timestamp: '2026-10-01T00:04:00Z' },
      { ...msg('deploy', 'deploying', 'running'), timestamp: '2026-10-01T00:05:00Z' },
    ];
    expect(runLogLines('run-1', saved, streamed).map((l) => l.logs)).toEqual(['downloaded', 'registering', 'deploying']);
  });
});
