import { describe, expect, it } from 'vitest';
import { runLink } from '../../src/utils/links';

describe('runLink', () => {
  it('opens a run on its project canvas', () => {
    expect(runLink('run-1', 4)).toBe('/pipelines/canvas/4?run=run-1');
  });

  it('keeps the run page for runs older than projects', () => {
    expect(runLink('run-1', null)).toBe('/pipelines/run-1');
    expect(runLink('run-1', undefined)).toBe('/pipelines/run-1');
  });
});
