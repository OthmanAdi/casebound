import { describe, expect, it } from 'vitest';
import { easeInOutQuad, frameFactor } from '../core/math';
import { SCROLL_DESKTOP, createBridge, createHaste, createScrollState, dwell, stepBridge, stepHaste, stepScroll } from './scroll';

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

describe('dwell with creep', () => {
  it('keeps moving through the dwell and has no kink where the dwell ends', () => {
    // Inside the dwell the book creeps in a straight line.
    expect(dwell(2.05, 0.2, 0.15)).toBeCloseTo(2 + 0.15 * 0.05, 9);
    expect(dwell(2.97, 0.2, 0.15)).toBeCloseTo(3 - 0.15 * 0.03, 9);
    expect(dwell(3, 0.2, 0.15)).toBe(3);
    expect(dwell(2.5, 0.2, 0.15)).toBeCloseTo(2.5, 9);
    // The slope never jumps: neighbouring steps of 0.001 differ by little anywhere, also at the ends of the dwell.
    let prev = dwell(0, 0.2, 0.15);
    let slope = 0.15;
    for (let x = 0.001; x < 2; x += 0.001) {
      const y = dwell(x, 0.2, 0.15);
      const now = (y - prev) / 0.001;
      expect(now).toBeGreaterThan(0.149);
      expect(Math.abs(now - slope)).toBeLessThan(0.02);
      slope = now;
      prev = y;
    }
  });

  it('follows the curve measured on the reference when given its geometry', () => {
    // Reference at 1440 x 900: 872 px between two rest positions, the book dwells 75 px after one and 71 px
    // before the next, and creeps 0.15 slots per 722 px. Slots travelled for pixels scrolled past the rest position,
    // from a settled capture every 6 px.
    const measured: [number, number][] = [[50, 0.0104], [100, 0.0211], [150, 0.0371], [200, 0.0677], [300, 0.1953], [400, 0.408], [500, 0.6501], [600, 0.8454], [700, 0.9504], [800, 0.9851]];
    for (const [px, slots] of measured) expect(Math.abs(dwell(px / 872, 146 / 872, (0.15 * 872) / 722) - slots)).toBeLessThan(0.006);
  });

  it('moves a book in step with a short scroll inside the dwell', () => {
    // Measured: 100 px in half a second moves the centred book 11 px on screen by the time 90 px are scrolled,
    // where a dead plateau had moved it 4. One slot is 24 world, 31.57 px per world at the shelf plane.
    const s = createScrollState();
    const slot = 730;
    stepScroll(s, 0, slot, 4, SCROLL_DESKTOP, 1 / 60);
    for (let k = 1; k <= 24; k++) stepScroll(s, 100 * (0.5 - 0.5 * Math.cos((Math.PI * k) / 30)), slot, 4, SCROLL_DESKTOP, 1 / 60);
    const px = s.progress * 24 * 31.57;
    expect(px).toBeGreaterThan(8);
    expect(px).toBeLessThan(14);
  });
});

describe('stepHaste', () => {
  it('is full after a jump of the scroll bar and wears off within 0.8 s', () => {
    const h = createHaste();
    stepHaste(h, 0, 900, 1 / 60);
    expect(stepHaste(h, 943, 900, 1 / 60)).toBe(1);
    // The smoothed speed stays above 2.5 window heights per second for about 0.15 s; then 0.6 s of decay.
    let w = 1;
    for (let k = 0; k < 6; k++) w = stepHaste(h, 943, 900, 1 / 60);
    expect(w).toBe(1);
    for (let k = 0; k < 24; k++) w = stepHaste(h, 943, 900, 1 / 60);
    expect(w).toBeGreaterThan(0.3);
    expect(w).toBeLessThan(0.5);
    for (let k = 0; k < 18; k++) w = stepHaste(h, 943, 900, 1 / 60);
    expect(w).toBe(0);
  });

  it('stays out of an ordinary glide', () => {
    // One slot in 1.4 s peaks at 1.2 window heights per second.
    const h = createHaste();
    let most = 0;
    for (let k = 0; k <= 84; k++) most = Math.max(most, stepHaste(h, 943 * (0.5 - 0.5 * Math.cos((Math.PI * k) / 84)), 900, 1 / 60));
    expect(most).toBeLessThan(0.05);
  });

  it('lets the arriving book finish its turn as measured after a jump', () => {
    // Degrees left to the rest pose for the arriving book, n frames after the first frame that shows the jump
    // (reference capture, 60 fps; the arrival pose is 121.5 degrees from rest).
    const measured: [number, number][] = [[2, 113.6], [3, 96.6], [4, 76.8], [5, 59.0], [6, 44.5], [8, 25.3], [10, 14.6], [12, 8.5], [15, 3.9], [20, 1.1]];
    const s = createScrollState();
    const h = createHaste();
    const slot = 730;
    let turn = 1;
    const frame = (y: number): void => {
      stepScroll(s, y, slot, 4, SCROLL_DESKTOP, 1 / 60);
      const w = stepHaste(h, y, 900, 1 / 60);
      const b = s.progress - 1;
      const goal = easeInOutQuad(Math.min(1, Math.max(0, (Math.abs(b) - 0.1) / 0.7)));
      turn += (goal - turn) * frameFactor(Math.min(1, 0.165 * (1 + 0.5 * w)), 1 / 60);
    };
    frame(0);
    const left: number[] = [];
    for (let n = 0; n <= 20; n++) {
      frame(slot);
      left.push(turn * 121.5);
    }
    for (const [n, deg] of measured) expect(Math.abs(left[n]! - deg)).toBeLessThan(1.5);
    // Without the hurry the turn trails: 10 degrees more are left a sixth of a second after the jump.
  });
});

describe('stepBridge', () => {
  /** One wheel notch of 100 px half way between two books; returns the share of the move done, frame by frame. */
  const notch = (withWheel: boolean): number[] => {
    const s = createScrollState();
    const bridge = createBridge();
    const slot = 730;
    let time = 0;
    const frame = (y: number, ago: number): void => {
      time += 1 / 60;
      stepScroll(s, y, slot, 4, SCROLL_DESKTOP, 1 / 60, false, { bridge, time, ago });
    };
    for (let k = 0; k < 30; k++) frame(329, 10);
    const from = s.progress;
    const seen: number[] = [];
    for (let k = 0; k < 60; k++) {
      frame(429, withWheel ? (k + 1) / 60 : 10);
      seen.push(s.progress);
    }
    const to = seen[seen.length - 1]!;
    return seen.map((p) => (p - from) / (to - from));
  };

  it('spreads a wheel notch over a ramp, as measured', () => {
    // Share of its move the arriving book has done, frame by frame after one notch (reference capture, 60 fps).
    const measured = [0.013, 0.052, 0.117, 0.204, 0.308, 0.424, 0.549, 0.665, 0.76, 0.832, 0.885, 0.922, 0.948, 0.966, 0.977, 0.985];
    const ours = notch(true);
    for (const [n, share] of measured.entries()) expect(Math.abs(ours[n]! - share)).toBeLessThan(0.012);
  });

  it('leaves a jump alone that no wheel made', () => {
    // A scroll bar drag or a key: the damper alone, half the move within 40 ms.
    const ours = notch(false);
    expect(ours[0]).toBeGreaterThan(0.08);
    expect(ours[2]).toBeGreaterThan(0.4);
  });

  it('passes small steps through and comes to rest on the target', () => {
    const b = createBridge();
    expect(stepBridge(b, 0.2, 100, 0, 1 / 60, 0.01)).toBe(0.2);
    // 10 px in a frame is no notch.
    expect(stepBridge(b, 0.21, 110, 1 / 60, 1 / 60, 0.01)).toBe(0.21);
    // A notch after a still frame ramps: a 115 ms ramp covers about a seventh per frame.
    stepBridge(b, 0.21, 110, 2 / 60, 1 / 60, 0.01);
    const first = stepBridge(b, 0.41, 210, 3 / 60, 1 / 60, 0.01);
    expect(first).toBeGreaterThan(0.23);
    expect(first).toBeLessThan(0.25);
    let out = first;
    for (let k = 4; k < 40; k++) out = stepBridge(b, 0.41, 210, k / 60, 1 / 60, k / 60);
    expect(out).toBe(0.41);
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
