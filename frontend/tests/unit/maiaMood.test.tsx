import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MaiaAvatar, maiaMoodFor } from '../../src/components/flow/Maia';
import type { Pipeline } from '../../src/types';

vi.mock('../../src/api/client', () => ({}));

const run = (status: Pipeline['status']) => ({ status }) as Pipeline;

describe('maiaMoodFor', () => {
  it('is sad on the node where a failed run broke, and only there', () => {
    const view = { shownRun: run('failed'), errorNode: 'training', deployed: false };
    expect(maiaMoodFor(view, 'training')).toBe('sad');
    expect(maiaMoodFor(view, 'data')).toBe('calm');
    expect(maiaMoodFor(view, null)).toBe('calm');
  });

  it('is alert on Model when a run worked but its model was not deployed', () => {
    expect(maiaMoodFor({ shownRun: run('success'), errorNode: 'input', deployed: false }, 'model')).toBe('alert');
    expect(maiaMoodFor({ shownRun: run('success'), errorNode: 'input', deployed: false }, 'training')).toBe('calm');
  });

  it('is happy on Model when the run worked and its model is deployed', () => {
    expect(maiaMoodFor({ shownRun: run('success'), errorNode: 'input', deployed: true }, 'model')).toBe('happy');
    expect(maiaMoodFor({ shownRun: run('success'), errorNode: 'input', deployed: true }, 'training')).toBe('calm');
  });

  it('is calm while the run is still going, or with no run', () => {
    expect(maiaMoodFor({ shownRun: run('running'), errorNode: 'input', deployed: false }, 'model')).toBe('calm');
    expect(maiaMoodFor({ shownRun: undefined, errorNode: 'input', deployed: false }, 'model')).toBe('calm');
  });
});

describe('MaiaAvatar', () => {
  it('wears her mood as a class, which the stylesheet turns into her face and colours', () => {
    const { container, rerender } = render(<MaiaAvatar mood="sad" />);
    expect(container.querySelector('svg')).toHaveClass('maia-sad');
    rerender(<MaiaAvatar mood="alert" />);
    expect(container.querySelector('svg')).toHaveClass('maia-alert');
    expect(container.querySelector('.maia-tentacle-right')).not.toBeNull();
    rerender(<MaiaAvatar mood="happy" />);
    expect(container.querySelector('svg')).toHaveClass('maia-happy');
    expect(container.querySelector('.maia-spin')).not.toBeNull();
  });
});
