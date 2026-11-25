import { describe, expect, it } from 'vitest';
import { ZINE_POSE, flyOffset, flyTurn, stepPresence, zineLast, zineLean, zineNumber, zineOnBack, zinePage } from './pose';

const DT = 1 / 60;
const DEG = Math.PI / 180;

/** The way left, frame by frame from the first frame it is seen, as a share of the way at that frame. */
function wayLeft(frames: number): number[] {
  let p = 0;
  const out: number[] = [];
  let first = 0;
  for (let i = 0; out.length < frames; i++) {
    p = stepPresence(p, true, DT);
    if (p < ZINE_POSE.shown) continue;
    if (!first) first = flyOffset(p);
    out.push(flyOffset(p) / first);
  }
  return out;
}

describe('a zine coming in', () => {
  it('starts 45 units to the right and ends in its place', () => {
    expect(flyOffset(0)).toBe(45);
    expect(flyOffset(1)).toBe(0);
    expect(flyOffset(2)).toBe(0);
  });

  it('is seen from its first frame, 34.85 units out, as captured on a phone', () => {
    const p = stepPresence(0, true, DT);
    expect(p).toBeCloseTo(0.12, 10);
    expect(p).toBeGreaterThan(ZINE_POSE.shown);
    expect(flyOffset(p)).toBeCloseTo(34.85, 2);
  });

  it('covers the way at the measured pace: half in about 67 ms, nine tenths in about 167 ms', () => {
    const left = wayLeft(40);
    // Measured: 1, 0.80, 0.64, 0.51, 0.40. The rule alone is a little ahead; the capture has a second, eased shift in it.
    expect(left[1]).toBeCloseTo(0.774, 3);
    expect(left[2]).toBeCloseTo(0.6, 2);
    expect(left.findIndex((x) => x <= 0.5) * DT * 1000).toBeGreaterThanOrEqual(50);
    expect(left.findIndex((x) => x <= 0.5) * DT * 1000).toBeLessThanOrEqual(67);
    expect(left.findIndex((x) => x <= 0.1) * DT * 1000).toBeGreaterThanOrEqual(150);
    expect(left.findIndex((x) => x <= 0.1) * DT * 1000).toBeLessThanOrEqual(167);
    expect(left.findIndex((x) => x <= 0.01) * DT * 1000).toBeLessThanOrEqual(383);
  });

  it('arrives, and does not creep for ever', () => {
    let p = 0;
    let frames = 0;
    while (p < 1 && frames < 200) {
      p = stepPresence(p, true, DT);
      frames++;
    }
    expect(p).toBe(1);
    expect(frames).toBeLessThan(60);
  });

  it('does not depend on the frame rate', () => {
    let a = 0;
    let b = 0;
    for (let i = 0; i < 12; i++) a = stepPresence(a, true, DT);
    for (let i = 0; i < 6; i++) b = stepPresence(b, true, DT * 2);
    expect(a).toBeCloseTo(b, 10);
  });

  it('comes in on its back and tips up to its resting turn', () => {
    expect(flyTurn(0).pitch).toBeCloseTo(-90 * DEG, 10);
    expect(flyTurn(0).yaw).toBeCloseTo(0, 10);
    const rest = flyTurn(1);
    expect(rest.pitch).toBeCloseTo(ZINE_POSE.liePitch * DEG, 10);
    expect(rest.yaw).toBeCloseTo(ZINE_POSE.lieYaw * DEG, 10);
    expect(rest.roll).toBeCloseTo(ZINE_POSE.lieRoll * DEG, 10);
    // Measured in its first frames: -70.9 degrees, then -58.7.
    expect(flyTurn(0.12).pitch / DEG).toBeGreaterThan(-78);
    expect(flyTurn(0.12).pitch / DEG).toBeLessThan(-70);
  });
});

describe('a zine going away', () => {
  it('goes the way it came, and is out of sight within ten frames', () => {
    let p = 1;
    for (let i = 0; i < 10; i++) p = stepPresence(p, false, DT);
    expect(flyOffset(p)).toBeGreaterThan(20);
    for (let i = 0; i < 60; i++) p = stepPresence(p, false, DT);
    expect(p).toBe(0);
  });
});

describe('the number in the bar', () => {
  it('is 1 while the zine lies closed, then 2, 4, 6', () => {
    expect(zineNumber(null)).toBe(1);
    expect([0, 1, 2, 7].map(zineNumber)).toEqual([2, 4, 6, 16]);
  });

  it('goes back to the reader\'s page, and to closed below 2', () => {
    expect(zinePage(1, 8)).toBeNull();
    expect(zinePage(Number.NaN, 8)).toBeNull();
    expect(zinePage(2, 8)).toBe(0);
    expect(zinePage(6, 8)).toBe(4);
    // Read in the reference: an odd number is rounded down to the leaves turned.
    expect(zinePage(7, 8)).toBe(4);
    expect(zinePage(99, 8)).toBe(16);
    for (const spread of [0, 1, 5, 8]) expect(zinePage(zineNumber(spread), 8)).toBe(spread * 2);
  });

  it('counts the back cover too: closed onto its back the zine shows every side', () => {
    expect(zineLast(8)).toBe(20);
    expect(zineOnBack(zineLast(8), 8)).toBe(true);
    expect(zineOnBack(zineNumber(8), 8)).toBe(false);
    expect(zineOnBack(19, 8)).toBe(false);
  });
});

describe('the lean about the spine', () => {
  it('raises the side with fewer leaves, evenly from the first leaf to the last', () => {
    expect(zineLean(0, 14, 6.5)).toBeCloseTo(6.5);
    expect(zineLean(7, 14, 6.5)).toBeCloseTo(0);
    expect(zineLean(14, 14, 6.5)).toBeCloseTo(-6.5);
    // Measured: 0.93 degrees a leaf of fourteen.
    expect(zineLean(3, 14, 6.5) - zineLean(4, 14, 6.5)).toBeCloseTo(13 / 14);
  });

  it('turns toward the pointer by up to its share', () => {
    expect(zineLean(7, 14, 6.5, 3, 1)).toBeCloseTo(3);
    expect(zineLean(7, 14, 6.5, 3, -4)).toBeCloseTo(-3);
  });
});
