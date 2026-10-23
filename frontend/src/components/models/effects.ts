import type { EffectSegment } from '../../types';

/**
 * The geometry and colour of a model's effect strips, kept out of the
 * components so it can be pinned by tests.
 */

/**
 * One colour per class, in the reference categorical order, stepped for a
 * dark surface and validated on the panel's #0f172a (adjacent CVD ΔE ≥ 8.4,
 * normal-vision ΔE ≥ 19.3, all ≥ 3:1). A class keeps its colour by its place
 * in the model's class list, so the same class is the same colour on every
 * strip and in the probability bars.
 */
export const CLASS_COLORS = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
];

/** Past eight classes there is no ninth hue: the label carries identity. */
export const OTHER_COLOR = '#64748b';

export function classColor(classes: (string | number)[] | undefined, label: unknown): string {
  const index = (classes ?? []).findIndex((value) => String(value) === String(label));
  return index >= 0 && index < CLASS_COLORS.length ? CLASS_COLORS[index] : OTHER_COLOR;
}

export interface Placed {
  segment: EffectSegment;
  /** Percent of the strip's width where this range starts, and how wide it is. */
  start: number;
  width: number;
}

/**
 * Each range as wide as its share of the training rows.
 *
 * A value axis would be the obvious scale and the wrong one: encounter costs
 * run from $40 to $15,000 with almost every row under $500, so a linear strip
 * is one sliver of everything and a wide band of a few inpatient stays. Sized
 * by rows, the strip shows where the data is — and the boundaries carry their
 * values as labels, so nothing is lost.
 */
export function layout(segments: EffectSegment[]): Placed[] {
  const total = segments.reduce((sum, segment) => sum + segment.rows, 0) || 1;
  let start = 0;
  return segments.map((segment) => {
    const width = (segment.rows / total) * 100;
    const placed = { segment, start, width };
    start += width;
    return placed;
  });
}

/** Where `value` sits on the strip, or null when it is outside the training range. */
export function positionOf(value: number, placed: Placed[]): number | null {
  for (const { segment, start, width } of placed) {
    if (value >= segment.from && value <= segment.to) {
      const span = segment.to - segment.from;
      return start + (span > 0 ? ((value - segment.from) / span) * width : width / 2);
    }
  }
  return null;
}

export function segmentAt(value: number, segments: EffectSegment[]): EffectSegment | undefined {
  return segments.find((segment) => value >= segment.from && value <= segment.to);
}

/** A boundary value, short enough to sit under a strip. */
export function formatValue(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const magnitude = Math.abs(value);
  if (magnitude >= 1000) return Math.round(value).toLocaleString('en-US');
  if (magnitude >= 10) return value.toFixed(0);
  return Number(value.toFixed(2)).toString();
}
