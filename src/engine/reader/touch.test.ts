import { describe, expect, it } from 'vitest';
import { TOUCH_DEFAULT as T, boxBounds, edgesFree, fitZoom, phoneBounds, pickSide, pinch, rubber, springStep, trackSpeed, zoomLimits } from './touch';

// A phone of 390 by 844 with the reference's book at zoom 1: a page 236.2 px wide, its spine in the middle.
const area = { width: 390, top: 88, bottom: 760 };
const frame = { x: 195, y: 462, pageW: 374.4 / 1.585, pageH: 559.5 / 1.585 };
const both = { left: true, right: true };

describe('the rubber band', () => {
  it('leaves a value inside the limits alone and lets one past them give way by its share', () => {
    expect(rubber(1, 0.5, 2, 0.35)).toBe(1);
    // Measured: fingers asking for 5.94 at a limit of 3.169 show 4.14; asking for 0.211 at 0.5 show 0.399.
    expect(rubber(5.94, 0.5, 3.169, 0.35)).toBeCloseTo(4.139, 2);
    expect(rubber(0.211, 0.5, 3.169, 0.35)).toBeCloseTo(0.399, 3);
    // Measured: a pan 180 px down past a page that may not move shows 50.4.
    expect(rubber(-180, 0, 0, T.panRubber)).toBeCloseTo(-50.4, 6);
  });
});

describe('one page to the width', () => {
  it('fits a page to 0.96 of the width, never above 3', () => {
    expect(fitZoom(frame, area, T)).toBeCloseTo(1.585, 3);
    expect(fitZoom({ ...frame, pageW: 50, pageH: 70 }, area, T)).toBe(3);
  });

  it('is limited to twice the fitting zoom on a phone, and to 2 on a wide screen', () => {
    expect(zoomLimits(1.585, true, T)).toEqual({ lo: 0.5, hi: 3.17 });
    expect(zoomLimits(0.8, true, T)).toEqual({ lo: 0.5, hi: 2 });
    expect(zoomLimits(1.585, false, T)).toEqual({ lo: 0.5, hi: 2 });
  });

  it('rests on the left page or on the right one, each centred in the window', () => {
    const at = phoneBounds(frame, area, 1.585, both, T);
    expect(at.snap).toBe(true);
    // Measured: the left page with the pan at 197.2 and the spine at 382.2, the right one at -209.5 and 7.8.
    expect(at.bounds.maxX).toBeCloseTo(187.2, 1);
    expect(frame.x + at.bounds.maxX).toBeCloseTo(382.2, 1);
    expect(frame.x + at.bounds.minX).toBeCloseTo(7.8, 1);
    expect(at.bounds.minY).toBe(0);
    expect(at.bounds.maxY).toBe(0);
  });

  it('centres a spread that fits the window, and has no sides then', () => {
    const at = phoneBounds(frame, area, 0.5, both, T);
    expect(at.snap).toBe(true);
    expect(at.bounds.minX).toBe(0);
    expect(at.bounds.maxX).toBe(0);
  });

  it('lets a page wider than the window be panned from one outer edge to the other', () => {
    const at = phoneBounds(frame, area, 3.169, both, T);
    const page = frame.pageW * 3.169;
    expect(at.snap).toBe(false);
    expect(frame.x + at.bounds.maxX - page).toBeCloseTo(0, 6);
    expect(frame.x + at.bounds.minX + page).toBeCloseTo(390, 6);
    // Taller than the room: from its head at the top of the room to its foot at the bottom.
    const half = (frame.pageH * 3.169) / 2;
    expect(frame.y + at.bounds.maxY - half).toBeCloseTo(area.top, 6);
    expect(frame.y + at.bounds.minY + half).toBeCloseTo(area.bottom, 6);
  });

  it('has only the side there is at the first or last spread of a zine', () => {
    const right = phoneBounds(frame, area, 1.585, { left: false, right: true }, T);
    expect(right.bounds.maxX).toBe(right.bounds.minX);
    expect(frame.x + right.bounds.minX).toBeCloseTo(7.8, 1);
    const left = phoneBounds(frame, area, 1.585, { left: true, right: false }, T);
    expect(frame.x + left.bounds.minX).toBeCloseTo(382.2, 1);
  });
});

describe('the sides', () => {
  const b = phoneBounds(frame, area, 1.585, both, T).bounds;

  it('goes to the side the finger carries the pan toward', () => {
    // Measured: let go at 17 px with the finger at about -400 px/s: the right page.
    expect(pickSide(17.2, -400, b, true, T)).toBe('right');
    // Measured: a slow pull of 24 px on the left page goes back to it.
    expect(pickSide(173.3, -60, b, true, T)).toBe('left');
    expect(pickSide(-29.4, 300, b, true, T)).toBe('left');
  });

  it('turns a page only at the end of the pan the pull comes from', () => {
    expect(edgesFree(b.maxX, b, true, 'left', T)).toEqual({ left: true, right: false });
    expect(edgesFree(b.minX, b, true, 'right', T)).toEqual({ left: false, right: true });
    const wide = phoneBounds(frame, area, 3.169, both, T).bounds;
    expect(edgesFree(wide.maxX - 5, wide, false, 'left', T)).toEqual({ left: true, right: false });
    expect(edgesFree((wide.maxX + wide.minX) / 2, wide, false, 'left', T)).toEqual({ left: false, right: false });
    expect(edgesFree(0, null, false, 'left', T)).toEqual({ left: true, right: true });
  });
});

describe('the spring back', () => {
  /** Runs the spring at 60 frames a second and returns the value after each of the given milliseconds. */
  const run = (from: number, goal: number, at: number[]): number[] => {
    let s = { value: from, speed: 0 };
    const out: number[] = [];
    for (let ms = 1000 / 60, i = 0; i < at.length; ms += 1000 / 60) {
      s = springStep(s.value, goal, s.speed, 1 / 60, T);
      if (ms >= at[i]!) out.push(s.value), i++;
    }
    return out;
  };

  it('brings a zoom let go past its limit back as the reference did', () => {
    // Measured from 4.019 to 3.169: 3.419 after 135 ms, 3.184 after 269 ms, 3.158 at 400 ms, then 3.169.
    const [a, b, c] = run(4.019, 3.169, [135, 269, 400]);
    expect(a).toBeGreaterThan(3.169 + 0.15);
    expect(a).toBeLessThan(3.169 + 0.35);
    expect(Math.abs(b! - 3.169)).toBeLessThan(0.06);
    expect(c! - 3.169).toBeLessThan(0.005);
    expect(c! - 3.169).toBeGreaterThan(-0.03);
  });

  it('settles a pan to the other side in about a third of a second, a little past it at most', () => {
    // Measured from -45.6 to -209.5: -156.8 at 108 ms, -201.5 at 222 ms, -210.7 at 344 ms.
    const [a, b, c] = run(-45.6, -209.5, [108, 222, 344]);
    expect(a).toBeLessThan(-110);
    expect(b).toBeLessThan(-190);
    expect(c).toBeGreaterThan(-213);
    expect(c).toBeLessThan(-205);
  });
});

describe('the fingers', () => {
  it('smooths the speed of a finger, in pixels a second', () => {
    let v = 0;
    for (let i = 0; i < 12; i++) v = trackSpeed(v, 0, -20, 50);
    expect(v).toBeCloseTo(-400, 0);
    expect(trackSpeed(100, 0, 50, 400)).toBe(100);
  });

  it('keeps the place under the middle of two fingers under it as they zoom', () => {
    const about = { x: 195, y: 462 };
    const start = { zoom: 1.585, panX: 187.2, panY: 0, dist: 80, cx: 195, cy: 420 };
    const got = pinch(start, 300, 195, 420, about, { lo: 0.5, hi: 3.17 }, T);
    expect(got.zoom).toBeCloseTo(5.944, 3);
    expect(got.shown).toBeCloseTo(3.17 + (5.944 - 3.17) * 0.35, 2);
    // The place of the book under (195, 420) before is under it after.
    const before = (195 - about.x - start.panX) / start.zoom;
    const after = (195 - about.x - got.panX) / got.shown;
    expect(after).toBeCloseTo(before, 9);
    // A middle that moves carries the book with it.
    const moved = pinch(start, 80, 235, 420, about, { lo: 0.5, hi: 3.17 }, T);
    expect(moved.panX - start.panX).toBeCloseTo(40, 9);
  });

  it('keeps a quarter of the book in a wide window', () => {
    const b = boxBounds({ left: 400, top: 200, width: 640, height: 500 }, { width: 1440, height: 900 }, T);
    expect(400 + b.minX + 640).toBe(160);
    expect(400 + b.maxX).toBe(1440 - 160);
    expect(200 + b.minY + 500).toBe(125);
    expect(200 + b.maxY).toBe(900 - 125);
  });
});
