import { describe, expect, it } from 'vitest';
import {
  decodeChoice,
  encodeChoice,
  mountedOf,
  phaseCards,
  sameChoice,
} from '../../src/components/canvas/phases';
import type { NotebookCell, Pipeline, PipelinePhase } from '../../src/types';

function cell(phase: string, overrides: Partial<NotebookCell> = {}): NotebookCell {
  return {
    index: 0,
    phase,
    tags: phase ? [`mlops:${phase}`] : [],
    source: `# ${phase || 'untagged'}`,
    output: '',
    error: '',
    status: 'pending',
    ...overrides,
  };
}

function run(status: Pipeline['status'], phases: Partial<PipelinePhase>[] = []): Pipeline {
  return {
    id: 'run-1',
    repo_id: 1,
    status,
    commit_sha: 'abc',
    branch: 'main',
    started_at: '2026-10-23T10:00:00Z',
    finished_at: null,
    phases: phases.map((phase) => ({ name: '', status: 'pending', timestamp: '', logs: '', ...phase }) as PipelinePhase),
    metrics: {},
  };
}

const NOTEBOOK = ['', 'config', 'data', 'preprocessing', 'training', 'export'].map((phase) => cell(phase));

describe('phaseCards', () => {
  it('lays the phases out in run order, with untagged cells as Setup', () => {
    // Untagged cells run too. Dropping them would show less code than runs.
    const cards = phaseCards(NOTEBOOK);
    expect(cards.map((card) => card.id)).toEqual([
      'setup', 'config', 'data', 'preprocessing', 'training', 'export',
    ]);
  });

  it('shows a required phase with no cells instead of hiding it', () => {
    const cards = phaseCards([cell('config'), cell('training'), cell('export')]);
    expect(cards.find((card) => card.id === 'preprocessing')?.status).toBe('missing');
  });

  it('leaves out an optional phase the notebook does not have', () => {
    expect(phaseCards(NOTEBOOK).some((card) => card.id === 'evaluation')).toBe(false);
  });

  it('reports nothing for code read from the branch', () => {
    expect(phaseCards(NOTEBOOK).every((card) => card.status === 'idle')).toBe(true);
  });

  it('says the phases after a failure never ran, not that they are pending', () => {
    const cells = [
      cell('config', { status: 'completed' }),
      cell('preprocessing', { status: 'failed', error: 'KeyError: age' }),
      cell('training'),
      cell('export'),
    ];
    const cards = phaseCards(cells, run('failed'));
    expect(cards.map((card) => [card.id, card.status])).toEqual([
      ['config', 'completed'],
      ['preprocessing', 'failed'],
      ['training', 'skipped'],
      ['export', 'skipped'],
    ]);
  });

  it('marks the notebook as running while the run is executing it', () => {
    const cards = phaseCards(NOTEBOOK, run('running', [{ name: 'execute', status: 'running' }]));
    expect(new Set(cards.map((card) => card.status))).toEqual(new Set(['running']));
  });

  it('marks it as waiting before the run reaches it', () => {
    const cards = phaseCards(NOTEBOOK, run('running', [{ name: 'download', status: 'success' }]));
    expect(new Set(cards.map((card) => card.status))).toEqual(new Set(['waiting']));
  });
});

describe('input choices', () => {
  it('survive the trip through a drag', () => {
    const choice = { layer: 'silver' as const, source_id: 2 };
    expect(decodeChoice(encodeChoice(choice))).toEqual(choice);
  });

  it('ignore anything that is not a choice', () => {
    expect(decodeChoice('not json')).toBeNull();
    expect(decodeChoice('{"layer": "platinum"}')).toBeNull();
  });

  it('tell newest gold from a pinned build', () => {
    expect(sameChoice({ layer: 'gold' }, { layer: 'gold', version: 2 })).toBe(false);
    expect(sameChoice({ layer: 'gold', version: 2 }, { layer: 'gold', version: 2 })).toBe(true);
  });
});

describe('mountedOf', () => {
  it('reads nothing from a run older than the record', () => {
    expect(mountedOf({ ...run('success'), mounted_input: {} })).toBeUndefined();
    expect(
      mountedOf({ ...run('success'), mounted_input: { layer: 'gold', label: 'gold v2', bucket: 'gold', keys: [] } })
        ?.label,
    ).toBe('gold v2');
  });
});
