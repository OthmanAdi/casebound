import { describe, expect, it } from 'vitest';
import { approach, easeInOutQuad, expFactor, frameFactor, powerSigmoid, seeded, smoothDamp, smoothstep, springStep, wrapAngle } from './math';

describe('smoothDamp', () => {
  it('reaches the target without overshoot', () => {
    const vel = { v: 0 };
    let x = 0;
    let max = 0;
    for (let i = 0; i < 240; i++) {
      x = smoothDamp(x, 1, vel, 0.066, 1 / 60);
      max = Math.max(max, x);
    }
    expect(x).toBeCloseTo(1, 4);
    expect(max).toBeLessThanOrEqual(1);
  });

  it('gives the same curve at 60 and 120 Hz', () => {
    const run = (hz: number): number => {
      const vel = { v: 0 };
      let x = 0;
      for (let i = 0; i < hz * 0.1; i++) x = smoothDamp(x, 1, vel, 0.066, 1 / hz);
      return x;
    };
    expect(Math.abs(run(60) - run(120))).toBeLessThan(0.02);
  });

  it('has a falling decay ratio, unlike a plain exponential', () => {
    // After the input stops, the ratio remaining(t + 50 ms) / remaining(t) should fall over time (SPEC S-SCR-4).
    const vel = { v: 0 };
    let x = 0;
    const remaining: number[] = [];
    for (let i = 1; i <= 18; i++) {
      x = smoothDamp(x, 1, vel, 0.066, 1 / 60);
      if (i % 3 === 0) remaining.push(1 - x);
    }
    const r1 = remaining[1]! / remaining[0]!;
    const r3 = remaining[4]! / remaining[3]!;
    expect(r3).toBeLessThan(r1);
  });
});

describe('factors', () => {
  it('expFactor composes across split frames', () => {
    const whole = approach(0, 1, 6, 1 / 30);
    const half = approach(approach(0, 1, 6, 1 / 60), 1, 6, 1 / 60);
    expect(whole).toBeCloseTo(half, 10);
  });

  it('frameFactor equals k at 60 Hz', () => {
    expect(frameFactor(0.06, 1 / 60)).toBeCloseTo(0.06, 10);
    expect(expFactor(0, 1)).toBe(0);
  });
});

describe('curves', () => {
  it('smoothstep and easings hit their ends', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(easeInOutQuad(0)).toBe(0);
    expect(easeInOutQuad(1)).toBe(1);
    expect(powerSigmoid(0)).toBe(0);
    expect(powerSigmoid(1)).toBe(1);
    expect(powerSigmoid(0.5)).toBeLessThan(0.5);
  });
});

describe('springStep', () => {
  it('settles on the target', () => {
    const s = { x: 0, v: 0 };
    for (let i = 0; i < 300; i++) springStep(s, 1, 480, 42, 1 / 60);
    expect(s.x).toBeCloseTo(1, 3);
    expect(Math.abs(s.v)).toBeLessThan(1e-3);
  });
});

describe('helpers', () => {
  it('wrapAngle keeps angles in [-pi, pi)', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(-Math.PI, 10);
    expect(wrapAngle(-0.5)).toBeCloseTo(-0.5, 10);
  });

  it('seeded is repeatable', () => {
    const a = seeded(7);
    const b = seeded(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
