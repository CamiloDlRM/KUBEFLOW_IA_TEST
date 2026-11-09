import { act, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LandingMaia, { type LandingStop } from '../../src/components/LandingMaia';

vi.mock('../../src/api/client', () => ({}));

// jsdom has no IntersectionObserver: keep the callback so a test can say which section is in view.
let report: (entries: Partial<IntersectionObserverEntry>[]) => void = () => {};
class FakeObserver {
  constructor(callback: (entries: Partial<IntersectionObserverEntry>[]) => void) {
    report = callback;
  }
  observe() {}
  disconnect() {}
}

describe('LandingMaia', () => {
  beforeEach(() => vi.stubGlobal('IntersectionObserver', FakeObserver));
  afterEach(() => vi.unstubAllGlobals());

  function setup() {
    const hero = createRef<HTMLElement>();
    const advisor = createRef<HTMLElement>();
    const stops: LandingStop[] = [
      { ref: hero, side: 'right', height: 0.45, mood: 'calm', says: "Hi, I'm Maia!" },
      { ref: advisor, side: 'left', height: 0.35, mood: 'happy', says: 'That advisor is me.' },
    ];
    const utils = render(
      <>
        <section ref={hero} />
        <section ref={advisor} />
        <LandingMaia stops={stops} />
      </>,
    );
    return { ...utils, hero, advisor };
  }

  it('greets the visitor at the top of the page', () => {
    const { container } = setup();
    expect(screen.getByText("Hi, I'm Maia!")).toBeInTheDocument();
    expect(container.querySelector('svg.maia')).toHaveClass('maia-calm');
  });

  it('moves on to what each section is about as it reaches the middle of the screen', async () => {
    const { container, advisor } = setup();

    act(() => report([{ isIntersecting: true, target: advisor.current! }]));

    expect(await screen.findByText('That advisor is me.')).toBeInTheDocument();
    expect(container.querySelector('svg.maia')).toHaveClass('maia-happy');
  });
});
