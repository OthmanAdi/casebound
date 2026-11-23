import { describe, expect, it } from 'vitest';
import { powerSigmoid } from '../core/math';
import { RIFFLE_DEFAULT, RIFFLE_MAX, riffleCast, riffleDrop, riffleReveal, riffleSeconds, riffleTurn } from './riffle';

const T = RIFFLE_DEFAULT;

describe('riffleCast', () => {
  it('takes the top leaves of both stacks, the lowest of each first', () => {
    const cast = riffleCast(76, 181, 3);
    expect(cast.map((p) => p.index)).toEqual([73, 74, 75, 76, 77, 78]);
    expect(cast.map((p) => p.side)).toEqual([1, 1, 1, 0, 0, 0]);
    expect(cast.map((p) => p.rank)).toEqual([0, 1, 2, 2, 1, 0]);
    // Limp from the bottom of the right stack round to the bottom of the left one.
    expect(cast.map((p) => p.order)).toEqual([5, 4, 3, 2, 1, 0]);
    expect(cast[0]!.lean).toBe(1);
    expect(cast[5]!.lean).toBe(-1);
  });

  it('takes what there is near the first and the last page', () => {
    expect(riffleCast(0, 120, 3).map((p) => [p.index, p.side])).toEqual([[0, 0], [1, 0], [2, 0]]);
    expect(riffleCast(1, 120, 3).map((p) => [p.index, p.side])).toEqual([[0, 1], [1, 0], [2, 0], [3, 0]]);
    expect(riffleCast(120, 120, 3).map((p) => [p.index, p.side])).toEqual([[117, 1], [118, 1], [119, 1]]);
    expect(riffleCast(40, 120, 0)).toEqual([]);
    expect(riffleCast(40, 120, 99).length).toBe(RIFFLE_MAX * 2);
    expect(riffleCast(0, 1, 3)[0]!.lean).toBe(0);
  });
});

describe('the riffle clocks', () => {
  it('settles one leaf every 90 ms, each over 420 ms', () => {
    expect(riffleReveal(0, 0)).toBe(0);
    expect(riffleReveal(0.21, 0)).toBeCloseTo(0.5, 6);
    expect(riffleReveal(0.42, 0)).toBe(1);
    expect(riffleReveal(0.18, 2)).toBe(0);
    expect(riffleReveal(0.18 + 0.21, 2)).toBeCloseTo(0.5, 6);
    expect(riffleReveal(0.6, 2)).toBe(1);
    expect(riffleReveal(-1, 0)).toBe(0);
  });

  it('is done 870 ms after the first of six ranks, 600 ms with three a side', () => {
    const six = Array.from({ length: 6 }, (_, rank) => ({ index: rank, side: 0 as const, rank, order: 0, lean: 0 }));
    expect(riffleSeconds(six)).toBeCloseTo(0.87, 6);
    expect(riffleSeconds(riffleCast(76, 181, 3))).toBeCloseTo(0.6, 6);
    expect(riffleSeconds([])).toBe(0);
  });

  it('lets the leaves go limp 50 ms apart, each over 400 ms after a first 50 ms', () => {
    expect(riffleDrop(0.05, 0)).toBe(0);
    expect(riffleDrop(0.25, 0)).toBeCloseTo(0.5, 6);
    expect(riffleDrop(0.45, 0)).toBe(1);
    expect(riffleDrop(0.3, 5)).toBe(0);
    expect(riffleDrop(0.7, 5)).toBe(1);
  });

  it('with no duration jumps at the leaf\'s turn', () => {
    const snap = { ...T, seconds: 0, dropSeconds: 0 };
    expect(riffleReveal(0.17, 2, snap)).toBe(0);
    expect(riffleReveal(0.19, 2, snap)).toBe(1);
    expect(riffleDrop(0.09, 1, snap)).toBe(0);
    expect(riffleDrop(0.11, 1, snap)).toBe(1);
  });
});

describe('riffleTurn', () => {
  const cast = riffleCast(76, 181, 3);

  it('keeps every leaf on the stack it came from until the pages part', () => {
    for (const part of cast) expect(riffleTurn(0, part, 0)).toBe(0);
  });

  it('stands a waiting leaf on the block direction, fanned out by its place', () => {
    expect(riffleTurn(0.2, cast[0]!, 0)).toBeCloseTo(0.2 * (1 + T.fan), 6);
    expect(riffleTurn(0.2, cast[5]!, 0)).toBeCloseTo(0.2 * (1 - T.fan), 6);
    expect(riffleTurn(0.2, { ...cast[2]!, lean: 0 }, 0)).toBeCloseTo(0.2, 6);
  });

  it('lands each leaf flat on its own side', () => {
    for (const part of cast) expect(riffleTurn(0.42, part, 1)).toBe(part.side);
  });

  it('never lets a leaf pass the one bound next to it, through a whole opening', () => {
    // The opening as the reader runs it: page progress over 0.9 s, the leaves settle from progress 0.25.
    const reading = 76 / 181;
    let started = -1;
    for (let ms = 0; ms <= 2000; ms += 10) {
      const pages = powerSigmoid(ms / 900);
      if (started < 0 && pages >= T.start) started = ms;
      const elapsed = started < 0 ? -1 : (ms - started) / 1000;
      const turns = cast.map((part) => riffleTurn(reading * pages, part, riffleReveal(elapsed, part.rank)));
      // Lower index = nearer the front of the book = further toward the left.
      for (let i = 1; i < turns.length; i++) expect(turns[i]!, `at ${ms} ms, leaf ${i}`).toBeLessThanOrEqual(turns[i - 1]! + 1e-9);
      if (ms === 2000) expect(turns).toEqual([1, 1, 1, 0, 0, 0]);
    }
    expect(started).toBeGreaterThan(300);
    expect(started).toBeLessThan(500);
  });
});
