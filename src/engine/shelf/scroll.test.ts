import { describe, expect, it } from 'vitest';
import { SCROLL_DESKTOP, createScrollState, dwell, stepScroll } from './scroll';

describe('dwell', () => {
  it('holds on each whole number for the plateau', () => {
    expect(dwell(2.0, 0.2)).toBe(2);
    expect(dwell(2.09, 0.2)).toBe(2);
    expect(dwell(1.95, 0.2)).toBe(2);
    expect(dwell(2.5, 0.2)).toBeCloseTo(2.5, 6);
  });

  it('is monotone and continuous', () => {
    let prev = dwell(0, 0.18);
    for (let x = 0.001; x < 3; x += 0.001) {
      const y = dwell(x, 0.18);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(y - prev).toBeLessThan(0.01);
      prev = y;
    }
  });

  it('is the identity without a plateau at the ends and middle', () => {
    expect(dwell(0.5, 0)).toBeCloseTo(0.5, 6);
    expect(dwell(1, 0)).toBe(1);
  });
});

describe('stepScroll', () => {
  it('follows a scroll jump and settles on the next book', () => {
    const s = createScrollState();
    stepScroll(s, 0, 700, 4, SCROLL_DESKTOP, 1 / 60);
    let moving = true;
    let frames = 0;
    while (moving && frames < 600) {
      moving = stepScroll(s, 700, 700, 4, SCROLL_DESKTOP, 1 / 60);
      frames++;
    }
    expect(s.progress).toBeCloseTo(1, 2);
    expect(s.active).toBe(1);
    // Within 1 % in roughly a fifth of a second, as measured on the reference (SPEC S-SCR-5).
    expect(frames).toBeLessThan(30);
  });

  it('keeps the active book until progress leaves the hysteresis band', () => {
    const s = createScrollState();
    stepScroll(s, 0, 1000, 4, SCROLL_DESKTOP, 1 / 60);
    for (let i = 0; i < 120; i++) stepScroll(s, 540, 1000, 4, SCROLL_DESKTOP, 1 / 60);
    expect(s.progress).toBeGreaterThan(0.5);
    expect(s.active).toBe(0);
    for (let i = 0; i < 120; i++) stepScroll(s, 760, 1000, 4, SCROLL_DESKTOP, 1 / 60);
    expect(s.active).toBe(1);
  });

  it('jumps when motion is reduced', () => {
    const s = createScrollState();
    stepScroll(s, 0, 500, 3, SCROLL_DESKTOP, 1 / 60);
    stepScroll(s, 1000, 500, 3, SCROLL_DESKTOP, 1 / 60, true);
    expect(s.progress).toBe(2);
  });
});
