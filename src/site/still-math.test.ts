import { describe, expect, it } from 'vitest';
import { STILLS_KEY, faceLight, stillsAsked, turnsFor, wayBack } from './still-math';

const store = (start: Record<string, string> = {}) => {
  const kept = new Map(Object.entries(start));
  return {
    kept,
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => void kept.set(k, v),
    removeItem: (k: string) => void kept.delete(k),
  };
};

describe('asking for the page of stills', () => {
  it('is off for a plain address', () => {
    expect(stillsAsked(new URLSearchParams(''), store())).toBe(false);
  });

  it('is on with ?nowebgl and stays on for the tab', () => {
    const s = store();
    expect(stillsAsked(new URLSearchParams('nowebgl'), s)).toBe(true);
    expect(s.kept.get(STILLS_KEY)).toBe('1');
    expect(stillsAsked(new URLSearchParams(''), s)).toBe(true);
  });

  it('is forgotten with ?webgl, which wins over ?nowebgl', () => {
    const s = store({ [STILLS_KEY]: '1' });
    expect(stillsAsked(new URLSearchParams('webgl&nowebgl'), s)).toBe(false);
    expect(s.kept.has(STILLS_KEY)).toBe(false);
    expect(stillsAsked(new URLSearchParams(''), s)).toBe(false);
  });

  it('goes by the address alone where storage refuses', () => {
    const broken = {
      getItem: () => {
        throw new Error('no');
      },
      setItem: () => {
        throw new Error('no');
      },
      removeItem: () => {
        throw new Error('no');
      },
    };
    expect(stillsAsked(new URLSearchParams('nowebgl'), broken)).toBe(true);
    expect(stillsAsked(new URLSearchParams(''), broken)).toBe(false);
    expect(stillsAsked(new URLSearchParams('nowebgl'), null)).toBe(true);
  });
});

describe('the light on a still', () => {
  it('shows the front at its painted colour and the spine a little darker when the book is at rest', () => {
    const l = faceLight(0);
    expect(l.front).toBeGreaterThan(0.96);
    expect(l.front).toBeLessThan(1.05);
    expect(l.spine).toBeLessThan(l.front);
    expect(l.spine).toBeGreaterThan(0.8);
  });

  it('leaves the faces that look away from the light in shade', () => {
    const l = faceLight(0);
    expect(l.back).toBeCloseTo(0.55, 9);
    expect(l.tail).toBeCloseTo(0.55, 9);
  });

  it('lights the back when the book is turned half round', () => {
    const l = faceLight(180);
    expect(l.back).toBeCloseTo(faceLight(0).front, 9);
    expect(l.front).toBeCloseTo(0.55, 9);
  });

  it('is the same after a whole turn', () => {
    const a = faceLight(40);
    const b = faceLight(400);
    for (const face of ['front', 'back', 'spine', 'fore', 'head', 'tail'] as const) expect(b[face]).toBeCloseTo(a[face], 9);
  });

  it('never leaves the range a face can be drawn in', () => {
    for (let t = 0; t < 360; t += 15) for (const v of Object.values(faceLight(t))) {
      expect(v).toBeGreaterThanOrEqual(0.55);
      expect(v).toBeLessThanOrEqual(1.12);
    }
  });
});

describe('a still turned by hand', () => {
  it('turns once round for a pull of one and a half of its widths', () => {
    expect(turnsFor(600, 400)).toBeCloseTo(1, 9);
    expect(turnsFor(-300, 400)).toBeCloseTo(-0.5, 9);
  });

  it('goes back the shorter way', () => {
    expect(wayBack(0.25).delta).toBeCloseTo(-0.25, 9);
    expect(wayBack(0.75).delta).toBeCloseTo(0.25, 9);
    expect(wayBack(-0.25).delta).toBeCloseTo(0.25, 9);
    expect(wayBack(3.1).delta).toBeCloseTo(-0.1, 9);
  });

  it('takes 600 ms and up to 300 ms more for half a turn', () => {
    expect(wayBack(0).ms).toBe(600);
    expect(wayBack(0.25).ms).toBeCloseTo(750, 9);
    expect(wayBack(0.5).ms).toBeCloseTo(900, 9);
  });
});
