import { describe, expect, it, vi } from 'vitest';
import { inputNote } from '../../src/components/flow/NodePanelContent';
import type { MountedInput, Pipeline, PipelinePhase } from '../../src/types';

vi.mock('../../src/api/client', () => ({}));

const gold: MountedInput = { layer: 'gold', label: 'gold v3', bucket: 'gold', keys: ['p4/v3/train.csv'] };
const silver: MountedInput = { layer: 'silver', label: 'silver · hospital', bucket: 'silver', keys: ['p4/s1/a.csv'] };

function run(dataset?: Partial<PipelinePhase>): Pipeline {
  return {
    id: 'run-1',
    repo_id: 9,
    status: 'success',
    commit_sha: 'abc',
    branch: 'main',
    started_at: 't',
    finished_at: 't',
    phases: dataset ? [{ name: 'dataset', status: 'success', timestamp: 't', logs: '', ...dataset }] : [],
    metrics: {},
    owner_username: null,
  };
}

describe('inputNote', () => {
  it('says nothing when the run trained on the data selected here', () => {
    expect(inputNote(gold, { ...gold }, run({ logs: 'Mounted gold v3' }))).toBeNull();
  });

  it('names both when the run trained on other data', () => {
    expect(inputNote(gold, silver, run({ logs: 'Mounted silver' }))).toMatch(/trained on silver · hospital, not on gold v3/);
  });

  it('warns when the notebook brings its own data', () => {
    const own = run({ logs: 'The notebook brings its own data; nothing downloaded from MinIO and DATASET_PATH was not injected.' });
    expect(inputNote(gold, undefined, own)).toMatch(/brings its own data, so gold v3 was not used/);
  });

  it('stays quiet when nothing is selected, or the run kept no record of its mount', () => {
    expect(inputNote(null, undefined, run({ logs: 'The notebook brings its own data' }))).toBeNull();
    expect(inputNote(gold, undefined, run({ logs: 'Mounted gold v2' }))).toBeNull();
    expect(inputNote(gold, undefined, run())).toBeNull();
  });
});
