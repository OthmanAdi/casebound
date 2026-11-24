import { describe, expect, it } from 'vitest';
import { BUNDLE_DEFAULT, bundleCount, bundleLift, bundleRecount, bundleSeconds, bundleShown, bundleTurn, releaseLift, stepRelease } from './bundle';

describe('a bundle of leaves', () => {
  it('takes longer the more leaves it holds, within its limits', () => {
    expect(bundleSeconds(1)).toBeCloseTo(0.7, 6);
    expect(bundleSeconds(2)).toBeCloseTo(0.745, 6);
    expect(bundleSeconds(8)).toBeCloseTo(0.835, 6);
    expect(bundleSeconds(23)).toBeCloseTo(0.7 + 0.045 * Math.log2(23), 6);
    expect(bundleSeconds(100000)).toBe(1.1);
  });

  it('waits, then turns on a cosine ease', () => {
    const n = 8;
    const d = bundleSeconds(n);
    expect(bundleTurn(0, n)).toBe(0);
    expect(bundleTurn(BUNDLE_DEFAULT.hold, n)).toBe(0);
    expect(bundleTurn(BUNDLE_DEFAULT.hold + d / 2, n)).toBeCloseTo(0.5, 6);
    expect(bundleTurn(BUNDLE_DEFAULT.hold + d / 4, n)).toBeCloseTo(0.5 - 0.5 * Math.cos(Math.PI / 4), 6);
    expect(bundleTurn(BUNDLE_DEFAULT.hold + d, n)).toBe(1);
    expect(bundleTurn(9, n)).toBe(1);
  });

  it('never turns back', () => {
    let last = 0;
    for (let s = 0; s < 1.4; s += 1 / 120) {
      const now = bundleTurn(s, 12);
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
  });

  it('lifts while it waits and comes down flat', () => {
    expect(bundleLift(0, 0)).toBe(0);
    expect(bundleLift(0.075, 0)).toBeCloseTo(0.5, 6);
    expect(bundleLift(0.15, 0)).toBe(1);
    expect(bundleLift(0.5, 0.5)).toBe(1);
    expect(bundleLift(0.8, 0.9)).toBeCloseTo(0.5, 6);
    expect(bundleLift(1, 1)).toBe(0);
  });

  it('counts the leaves from the top of the stack down to the press', () => {
    // At the top of the edge only the top leaf is under the press: that is a single page.
    expect(bundleCount(1, 180)).toBe(0);
    expect(bundleCount(0.995, 180)).toBe(2);
    expect(bundleCount(0.95, 180)).toBe(10);
    expect(bundleCount(0.5, 180)).toBe(91);
    // Never more than lie there.
    expect(bundleCount(0, 180)).toBe(180);
    expect(bundleCount(0, 1)).toBe(0);
    expect(bundleCount(0.2, 3)).toBe(3);
  });
});

describe('a bundle let go by hand', () => {
  const run = (goal: 0 | 1, from: number): number[] => {
    const seen: number[] = [];
    let p = from;
    for (let i = 0; i < 120 && p !== goal; i++) {
      p = stepRelease(p, goal, 1 / 60);
      seen.push(p);
    }
    return seen;
  };

  it('goes over fast at first and is down in under half a second', () => {
    const seen = run(1, 0);
    // Half way after about a tenth of a second.
    expect(seen[5]).toBeGreaterThan(0.45);
    expect(seen[5]).toBeLessThan(0.56);
    expect(seen[seen.length - 1]).toBe(1);
    expect(seen.length).toBeGreaterThan(20);
    expect(seen.length).toBeLessThan(30);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThan(seen[i - 1]!);
    // What is seen is down a little earlier: the sheet lies from nine tenths of the progress on.
    expect(bundleShown(seen[19]!)).toBe(1);
  });

  it('sinks back the same way when it is not sent', () => {
    const seen = run(0, 0.4);
    expect(seen[seen.length - 1]).toBe(0);
    expect(seen.length).toBeLessThan(30);
  });

  it('stands where its progress says, down at both ends', () => {
    expect(bundleShown(0)).toBe(0);
    expect(bundleShown(0.03)).toBe(0);
    expect(bundleShown(0.465)).toBeCloseTo(0.5, 6);
    expect(bundleShown(0.9)).toBe(1);
    expect(bundleShown(1)).toBe(1);
  });

  it('keeps its lift until it is well over, and loses it at once on the way back', () => {
    expect(releaseLift(0, 1)).toBe(1);
    expect(releaseLift(0.55, 1)).toBe(1);
    expect(releaseLift(0.75, 1)).toBeCloseTo(0.5, 6);
    expect(releaseLift(0.95, 1)).toBeCloseTo(0, 9);
    expect(releaseLift(0.3, 0)).toBe(0);
  });

  it('is counted again from a place on its own edge', () => {
    expect(bundleRecount(1, 20)).toBe(1);
    expect(bundleRecount(0.5, 20)).toBe(11);
    expect(bundleRecount(0, 20)).toBe(20);
  });
});
