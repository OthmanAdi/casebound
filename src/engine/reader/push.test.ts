import { describe, expect, it } from 'vitest';
import { PUSH_DEFAULT, createPush, pushGoal, pushedReading, stepPush } from './push';

describe('pushGoal', () => {
  it('presses the page under the pointer flat: toward the start on the right, toward the end on the left', () => {
    expect(pushGoal(0.001, 0.5)).toBeCloseTo(-0.2, 2);
    expect(pushGoal(-0.001, 0.5)).toBeCloseTo(0.2, 2);
  });

  it('rests on the right side with no pointer, as the reference does', () => {
    // Captured: a book open in its middle rests as if open at 0.304 of its leaves.
    expect(pushGoal(0, 0.5044)).toBeCloseTo(-0.2, 6);
    expect(pushedReading(0.5044, pushGoal(0, 0.5044))).toBeCloseTo(0.3044, 4);
  });

  it('gives the shifts captured with the pointer on three buttons of the toolbar', () => {
    // Next page: just left of the middle. Previous page: further left. Lens: just right.
    expect(pushGoal(-0.021, 0.513)).toBeCloseTo(0.18, 2);
    expect(pushGoal(-0.236, 0.513)).toBeCloseTo(0.052, 2);
    expect(pushGoal(0.063, 0.5044)).toBeCloseTo(-0.145, 2);
  });

  it('fades out toward the window edge in a book open near its middle', () => {
    expect(Math.abs(pushGoal(0.6, 0.5))).toBeLessThan(0.003);
    expect(pushGoal(1, 0.5)).toBeCloseTo(0, 9);
    expect(pushGoal(-1, 0.5)).toBeCloseTo(0, 9);
  });

  it('opens a book that is near its start further when the pointer is at the right edge', () => {
    expect(pushGoal(1, 0.1)).toBeCloseTo(0.2, 6);
    expect(pushGoal(1, 0.3)).toBeCloseTo(0, 6);
    expect(pushGoal(-1, 0.9)).toBeCloseTo(-0.2, 6);
  });

  it('never leaves the book', () => {
    for (const reading of [0, 0.05, 0.5, 0.95, 1]) {
      for (let x = -1; x <= 1; x += 0.05) {
        const r = pushedReading(reading, pushGoal(x, reading));
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('stepPush', () => {
  const settle = (hz: number, x: number, seconds: number, state = createPush()): number => {
    let v = 0;
    for (let i = 0; i < hz * seconds; i++) v = stepPush(state, x, 0.5, 1 / hz);
    return v;
  };

  it('reaches the goal at the same pace at 30, 60 and 120 frames a second', () => {
    const at = [30, 60, 120].map((hz) => settle(hz, 0.05, 0.25));
    expect(at[0]!).toBeCloseTo(at[1]!, 2);
    expect(at[2]!).toBeCloseTo(at[1]!, 2);
    expect(settle(60, 0.05, 3)).toBeCloseTo(pushGoal(0.05, 0.5), 3);
  });

  it('does not jump when the pointer crosses the middle', () => {
    const s = createPush();
    settle(60, 0.02, 3, s);
    const before = s.value;
    let worst = 0;
    let last = before;
    for (let i = 0; i < 90; i++) {
      const v = stepPush(s, -0.02, 0.5, 1 / 60);
      worst = Math.max(worst, Math.abs(v - last));
      last = v;
    }
    expect(before).toBeLessThan(-0.15);
    expect(last).toBeGreaterThan(0.15);
    // The whole way is 0.36; no single frame takes more than a twentieth of it.
    expect(worst).toBeLessThan(0.018);
  });

  it('stays where it is while a page is held', () => {
    const s = createPush();
    settle(60, 0.02, 3, s);
    const held = s.value;
    for (let i = 0; i < 60; i++) stepPush(s, 0.9, 0.5, 1 / 60, PUSH_DEFAULT, true);
    expect(s.value).toBeCloseTo(held, 9);
  });
});
