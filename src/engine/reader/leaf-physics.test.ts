import { describe, expect, it } from 'vitest';
import { LEAF_DEFAULT, createLeafMotion, sendLeaf, stepLeaf } from './leaf-physics';

const run = (hz: number, seconds: number, side: 0 | 1 = 1, settle = 0): { progress: number[]; restedAt: number | null } => {
  const m = createLeafMotion(side === 1 ? 0 : 1);
  sendLeaf(m, side);
  const progress: number[] = [];
  let restedAt: number | null = null;
  for (let i = 0; i < hz * seconds; i++) {
    stepLeaf(m, 1 / hz, { ...LEAF_DEFAULT, settle });
    progress.push(m.shown / Math.PI);
    if (m.resting && restedAt === null) restedAt = (i + 1) / hz;
  }
  return { progress, restedAt };
};

describe('stepLeaf', () => {
  it('turns at the measured pace: about half way after 0.45 s, most of the way by 0.8 s', () => {
    const { progress } = run(60, 3);
    const at = (s: number): number => progress[Math.round(s * 60) - 1]!;
    expect(at(0.43)).toBeGreaterThan(0.38);
    expect(at(0.43)).toBeLessThan(0.62);
    expect(at(0.8)).toBeGreaterThan(0.72);
    expect(at(0.8)).toBeLessThan(0.95);
  });

  it('matches the turn measured on the reference at 60 fps', () => {
    // Turn progress of a button-triggered page turn, read from a frame-stepped capture (research/SPEC.md S-RD-9).
    const measured: [number, number][] = [[50, 0.088], [100, 0.15], [200, 0.264], [400, 0.473], [600, 0.674], [800, 0.829], [1000, 0.88], [1200, 0.901], [1600, 0.925], [2000, 0.94]];
    const { progress } = run(60, 2.2);
    for (const [ms, value] of measured) {
      const ours = progress[Math.round((ms / 1000) * 60) - 1]!;
      // The capture samples the frame after the trigger, so allow one frame of offset.
      expect(Math.abs(ours - value), `at ${ms} ms`).toBeLessThan(0.03);
    }
  });

  it('with a settling pull, never overshoots and comes to rest on the target side', () => {
    const { progress, restedAt } = run(60, 6, 1, 0.006);
    expect(Math.max(...progress)).toBeLessThanOrEqual(1 + 1e-9);
    expect(progress.at(-1)).toBeCloseTo(1, 3);
    expect(restedAt).not.toBeNull();
  });

  it('is monotone on the way', () => {
    const { progress } = run(60, 3);
    for (let i = 1; i < progress.length; i++) expect(progress[i]!).toBeGreaterThanOrEqual(progress[i - 1]! - 1e-9);
  });

  it('gives nearly the same turn at 30, 60 and 120 Hz', () => {
    const a = run(30, 1).progress.at(-1)!;
    const b = run(60, 1).progress.at(-1)!;
    const c = run(120, 1).progress.at(-1)!;
    expect(Math.abs(a - b)).toBeLessThan(0.04);
    expect(Math.abs(c - b)).toBeLessThan(0.04);
  });

  it('turns back the same way', () => {
    const { progress } = run(60, 6, 0, 0.006);
    expect(progress.at(-1)).toBeCloseTo(0, 3);
  });
});
