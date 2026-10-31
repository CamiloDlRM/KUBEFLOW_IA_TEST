import type { ReactNode } from 'react';

/**
 * The drawings in the manual are schematics, not screenshots.
 *
 * A screenshot goes stale the first time a button moves, and it cannot be
 * printed in two inks. A schematic keeps the labels — which are the part a
 * reader actually needs — and reduces everything else to rules and boxes.
 *
 * Every drawing carries numbered pins. The numbers are the contract between
 * the drawing and the "What you see" list that follows it: pin 3 is always
 * item 3, so a reader can look at a shape and then read what it is.
 */

export function WfFrame({
  path,
  children,
  className = '',
}: {
  /** The breadcrumb printed in the window chrome, e.g. "maia / projects". */
  path: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`wf ${className}`}>
      <div className="wf-chrome">
        <span className="wf-dot" />
        <span className="wf-dot" />
        <span className="wf-dot" />
        <span className="wf-title ml-2 truncate">{path}</span>
      </div>
      <div className="wf-body">{children}</div>
    </div>
  );
}

/**
 * A pin anchored to the element it describes rather than to a percentage of
 * the frame, so it does not drift when the drawing reflows on a phone.
 */
export function Pin({ n, className = '-right-2 -top-2' }: { n: number; className?: string }) {
  return (
    <span className={`wf-pin ${className}`} aria-hidden="true">
      {n}
    </span>
  );
}

export function WfLabel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`wf-label ${className}`}>{children}</span>;
}

export function WfLines({ count = 2, className = '' }: { count?: number; className?: string }) {
  return (
    <span className={`wf-col w-full ${className}`}>
      {Array.from({ length: count }).map((_, index) => (
        <span
          key={index}
          className="wf-line"
          style={{ width: index === count - 1 && count > 1 ? '62%' : '100%' }}
        />
      ))}
    </span>
  );
}

export function WfStatus({ tone, children }: { tone: 'ok' | 'bad' | 'idle'; children: ReactNode }) {
  const color = tone === 'ok' ? 'bg-[var(--ok)]' : tone === 'bad' ? 'bg-[var(--bad)]' : 'bg-[var(--rule-strong)]';
  return (
    <span className="wf-pill">
      <span className={`inline-block h-[5px] w-[5px] rounded-full ${color}`} />
      {children}
    </span>
  );
}
