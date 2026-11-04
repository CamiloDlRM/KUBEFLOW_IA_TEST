import { describe, expect, it } from 'vitest';
import {
  CLASS_COLORS,
  OTHER_COLOR,
  classColor,
  formatValue,
  layout,
  positionOf,
  segmentAt,
} from '../../src/components/models/effects';
import type { EffectSegment } from '../../src/types';

const SEGMENTS: EffectSegment[] = [
  { from: 1, to: 13, prediction: 'virtual', share: 0.94, rows: 300 },
  { from: 13, to: 70, prediction: 'ambulatory', share: 0.94, rows: 600 },
  { from: 70, to: 6600, prediction: 'inpatient', share: 1, rows: 100 },
];

describe('layout', () => {
  it('sizes each range by its training rows, not its span of values', () => {
    // 70 to 6,600 minutes is almost the whole value axis and a tenth of the rows.
    expect(layout(SEGMENTS).map((p) => p.width)).toEqual([30, 60, 10]);
    expect(layout(SEGMENTS).map((p) => p.start)).toEqual([0, 30, 90]);
  });
});

describe('positionOf', () => {
  it('places a value inside its range in proportion', () => {
    expect(positionOf(41.5, layout(SEGMENTS))).toBeCloseTo(30 + 60 * ((41.5 - 13) / 57));
  });

  it('has no place for a value the model never saw', () => {
    expect(positionOf(0, layout(SEGMENTS))).toBeNull();
    expect(positionOf(9000, layout(SEGMENTS))).toBeNull();
  });
});

describe('segmentAt', () => {
  it('finds the range a value falls in', () => {
    expect(segmentAt(30, SEGMENTS)?.prediction).toBe('ambulatory');
  });
});

describe('classColor', () => {
  const classes = ['ambulatory', 'emergency', 'inpatient'];

  it('follows the class, not where it appears', () => {
    expect(classColor(classes, 'inpatient')).toBe(CLASS_COLORS[2]);
    expect(classColor(['inpatient', ...classes], 'ambulatory')).toBe(CLASS_COLORS[1]);
  });

  it('has no ninth hue', () => {
    const many = Array.from({ length: 10 }, (_, i) => `class-${i}`);
    expect(classColor(many, 'class-9')).toBe(OTHER_COLOR);
    expect(classColor(classes, 'unknown')).toBe(OTHER_COLOR);
  });
});

describe('formatValue', () => {
  it('keeps boundaries short', () => {
    expect(formatValue(6596.4)).toBe('6,596');
    expect(formatValue(41.73)).toBe('42');
    expect(formatValue(0.2)).toBe('0.2');
    expect(formatValue(null)).toBe('—');
  });
});
