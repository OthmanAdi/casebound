import { describe, expect, it } from 'vitest';
import { atlasOf, makeDims } from './dims';
import { COVER_RELIEF, SPINE_TYPE_MIN, WEAVE_CRIMP, WEAVE_PERIOD, reliefLevel, spineTakesType, weaveHeight } from './painter';

describe('the weave', () => {
  const p = WEAVE_PERIOD;
  /** Mean height of the crossing in column i, row j. */
  const crossing = (i: number, j: number): number => {
    let sum = 0;
    for (let y = 0; y < p; y++) for (let x = 0; x < p; x++) sum += weaveHeight(i * p + x + 0.5, j * p + y + 0.5);
    return sum / (p * p);
  };

  it('stays between the gap and the crown of a warp thread', () => {
    for (let y = 0; y < 4 * p; y++) {
      for (let x = 0; x < 4 * p; x++) {
        const h = weaveHeight(x + 0.5, y + 0.5);
        expect(h).toBeGreaterThanOrEqual(0.35);
        expect(h).toBeLessThanOrEqual(0.95);
      }
    }
    expect(weaveHeight(p / 2, p / 2)).toBeCloseTo(0.95, 6);
  });

  it('repeats every two threads in both directions', () => {
    for (const [x, y] of [[1.5, 2.5], [5.5, 9.5], [12.5, 3.5]] as const) {
      expect(weaveHeight(x + 2 * p, y)).toBeCloseTo(weaveHeight(x, y), 10);
      expect(weaveHeight(x, y + 2 * p)).toBeCloseTo(weaveHeight(x, y), 10);
    }
  });

  it('alternates in height from crossing to crossing, which is what is left of it from far away', () => {
    expect(crossing(0, 0)).toBeCloseTo(crossing(1, 1), 10);
    expect(crossing(1, 0)).toBeCloseTo(crossing(0, 1), 10);
    expect(crossing(0, 0)).toBeGreaterThan(crossing(1, 0) + 0.05);
    // Without the crimp both kinds of crossing are equally high, and the smaller copies of the tile are flat.
    const flat = (i: number): number => {
      let sum = 0;
      for (let y = 0; y < p; y++) for (let x = 0; x < p; x++) sum += weaveHeight(i * p + x + 0.5, y + 0.5, 0);
      return sum / (p * p);
    };
    expect(flat(0)).toBeCloseTo(flat(1), 10);
    expect(WEAVE_CRIMP).toBeGreaterThan(0);
  });
});

describe('the relief map', () => {
  it('puts the cloth at mid grey and pressed type below it', () => {
    expect(reliefLevel(0.5)).toBe('rgb(128,128,128)');
    expect(reliefLevel(0.5 - COVER_RELIEF.press)).toBe('rgb(36,36,36)');
  });

  it('stays inside the range a texture can hold', () => {
    expect(reliefLevel(-1)).toBe('rgb(0,0,0)');
    expect(reliefLevel(2)).toBe('rgb(255,255,255)');
  });
});

describe('the type on a spine', () => {
  it('is left off a spine too narrow to read: the fold of a pamphlet', () => {
    for (const pages of [8, 16, 32]) expect(spineTakesType(atlasOf(makeDims({ pages, binding: 'pamphlet' })))).toBe(false);
  });

  it('stays on every case, the thinnest too', () => {
    expect(spineTakesType(atlasOf(makeDims({ pages: 8 })))).toBe(true);
    expect(spineTakesType(atlasOf(makeDims({ thickness: 1.1 })))).toBe(true);
    expect(SPINE_TYPE_MIN).toBeGreaterThan(0);
  });
});
