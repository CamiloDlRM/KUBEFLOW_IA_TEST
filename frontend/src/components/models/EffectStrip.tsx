import { useState } from 'react';
import type { EffectSegment, ModelEffect } from '../../types';
import { classColor, formatValue, layout, positionOf, segmentAt } from './effects';

function describeSegment(segment: EffectSegment): string {
  return `${formatValue(segment.from)} – ${formatValue(segment.to)}: ${segment.prediction} for ${Math.round(
    segment.share * 100,
  )}% of ${segment.rows.toLocaleString('en-US')} training rows`;
}

/**
 * One input's training range, coloured by what the model answered there.
 *
 * Each range is as wide as its share of the training rows (see `layout`), the
 * white tick is the value in the form, and the line under the strip says what
 * the range under the pointer — or under the tick — holds. The full list sits
 * in a disclosure for anyone who cannot use the colours.
 */
export default function EffectStrip({
  effect,
  classes,
  value,
}: {
  effect: ModelEffect;
  classes: (string | number)[] | undefined;
  value: number | null;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const segments = effect.segments ?? [];
  if (segments.length === 0) return null;

  const placed = layout(segments);
  const marker = value === null ? null : positionOf(value, placed);
  const focus = hovered !== null ? segments[hovered] : value === null ? undefined : segmentAt(value, segments);

  return (
    <div className="space-y-1">
      <div
        role="img"
        aria-label={`${effect.input}: ${segments.map(describeSegment).join('; ')}`}
        className="relative h-3"
        onMouseLeave={() => setHovered(null)}
      >
        {/* The ranges in a box of their own, so the tick is not the "last"
            child that the rounded right end belongs to. */}
        <div className="flex h-full gap-[2px]">
          {placed.map(({ segment, width }, index) => (
            <span
              key={`${segment.from}-${index}`}
              onMouseEnter={() => setHovered(index)}
              style={{ flexGrow: width, flexBasis: 0, background: classColor(classes, segment.prediction) }}
              className={`h-full min-w-[3px] first:rounded-l last:rounded-r transition-opacity ${
                hovered !== null && hovered !== index ? 'opacity-40' : ''
              }`}
            />
          ))}
        </div>
        {marker !== null && (
          <span
            aria-hidden="true"
            style={{ left: `${marker}%` }}
            className="pointer-events-none absolute -bottom-1 -top-1 w-[2px] -translate-x-1/2 rounded-full bg-white shadow-[0_0_0_2px_#0f172a]"
          />
        )}
      </div>
      <div className="flex justify-between font-mono text-[10px] text-slate-500">
        <span>{formatValue(segments[0].from)}</span>
        <span>{formatValue(segments[segments.length - 1].to)}</span>
      </div>
      <p className="min-h-[1rem] text-[11px] text-slate-400">{focus ? describeSegment(focus) : ' '}</p>
      <details className="text-[11px] text-slate-500">
        <summary className="cursor-pointer select-none hover:text-slate-300">All ranges</summary>
        <ul className="mt-1 space-y-0.5 font-mono">
          {segments.map((segment, index) => (
            <li key={`${segment.from}-${index}`} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-sm"
                style={{ background: classColor(classes, segment.prediction) }}
              />
              {describeSegment(segment)}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
