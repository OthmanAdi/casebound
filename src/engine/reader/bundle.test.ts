import { describe, expect, it } from 'vitest';
import { BUNDLE_DEFAULT, bundleCount, bundleLift, bundleSeconds, bundleTurn } from './bundle';

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
