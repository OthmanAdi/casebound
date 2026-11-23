import { describe, expect, it } from 'vitest';
import { CURL_DEFAULT, ROLL_STRIDE, createCurl, curlFlat, fillRoll, resetCurl, rollAngle, rollAt, stepCurl, type CurlInput, type CurlState } from './curl';

const T = CURL_DEFAULT;
const DRAG = T.amount * T.drag;
const HOVER = T.amount * T.hover;

/** A leaf lying on the right with the pointer at its fore-edge, half way up. */
const lying: CurlInput = { pages: 1, held: false, hovered: false, covered: false, grabU: 1, grabV: 0.5, pointerY: 0, angle: 0, velocity: 0, target: 0, shown: 0 };

const run = (c: CurlState, input: CurlInput, seconds: number, hz = 60): void => {
  for (let i = 0; i < Math.round(seconds * hz); i++) stepCurl(c, input, 1 / hz);
};

describe('the roll', () => {
  it('leaves the page alone up to the fold line and without strength', () => {
    expect(rollAt(-2, DRAG, T.power, 20)).toEqual({ x: -2, y: 0, angle: 0 });
    const flat = rollAt(3, 0, T.power, 20);
    expect(flat.x).toBeCloseTo(3, 6);
    expect(flat.y).toBe(0);
    expect(flat.angle).toBe(0);
  });

  it('is an arc of a circle when the angle grows evenly', () => {
    // With power 1 the sheet turns by amount / span per unit: a circle of radius span / amount.
    const amount = 2;
    const span = 10;
    const radius = span / amount;
    for (const d of [1, 4, 7.5]) {
      const r = rollAt(d, amount, 1, span, 2048);
      expect(r.angle).toBeCloseTo(d / radius, 6);
      expect(r.x).toBeCloseTo(radius * Math.sin(d / radius), 4);
      expect(r.y).toBeCloseTo(radius * (1 - Math.cos(d / radius)), 4);
    }
  });

  it('stops at a half turn and then runs straight back over the page', () => {
    const span = 26;
    // Where the measured drag strength reaches the half turn: about a fifth of the span.
    const turned = span * Math.pow(Math.PI / DRAG, 1 / T.power);
    expect(turned / span).toBeGreaterThan(0.15);
    expect(turned / span).toBeLessThan(0.25);
    expect(rollAngle(turned * 1.01, DRAG, T.power, span)).toBe(Math.PI);
    const a = rollAt(turned * 1.2, DRAG, T.power, span, 4096);
    const b = rollAt(turned * 1.6, DRAG, T.power, span, 4096);
    expect(a.angle).toBeCloseTo(Math.PI, 5);
    expect(b.y).toBeCloseTo(a.y, 2);
    expect(a.x - b.x).toBeCloseTo(turned * 0.4, 2);
    expect(a.y).toBeGreaterThan(0);
  });

  it('never lifts the sheet below the page', () => {
    for (const amount of [0.5, HOVER, 5, DRAG]) {
      const table = new Float32Array(97 * ROLL_STRIDE);
      fillRoll(table, 96, 9, amount, T.power, 26);
      for (let k = 0; k <= 96; k++) expect(table[k * ROLL_STRIDE + 1]!).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps the length of the page it rolls up (paper does not stretch)', () => {
    const steps = 96;
    const reach = 8;
    const table = new Float32Array((steps + 1) * ROLL_STRIDE);
    fillRoll(table, steps, reach, DRAG, T.power, 26);
    let length = 0;
    for (let k = 1; k <= steps; k++) {
      length += Math.hypot(table[k * ROLL_STRIDE]! - table[(k - 1) * ROLL_STRIDE]!, table[k * ROLL_STRIDE + 1]! - table[(k - 1) * ROLL_STRIDE + 1]!);
    }
    expect(length).toBeCloseTo(reach, 5);
  });

  it('gives the same roll from the table as from a fine integration', () => {
    const steps = 96;
    const reach = 8;
    const table = new Float32Array((steps + 1) * ROLL_STRIDE);
    fillRoll(table, steps, reach, HOVER, T.power, 26);
    for (const k of [12, 48, 96]) {
      const fine = rollAt((k / steps) * reach, HOVER, T.power, 26, 4096);
      expect(table[k * ROLL_STRIDE]!).toBeCloseTo(fine.x, 3);
      expect(table[k * ROLL_STRIDE + 1]!).toBeCloseTo(fine.y, 3);
      expect(table[k * ROLL_STRIDE + 2]!).toBeCloseTo(fine.angle, 5);
    }
  });

  it('lifts a hovered corner gently: well under a quarter turn at the far corner', () => {
    // Reference page 15.6 x 21.45, fold line at 0.74 of the width, slanted 31.5 degrees: the far corner is about 9 past it.
    const corner = rollAt(9.06, HOVER, T.power, 32.4);
    expect(corner.angle).toBeGreaterThan(0.5);
    expect(corner.angle).toBeLessThan(0.8);
    expect(corner.y).toBeGreaterThan(1.5);
    expect(corner.y).toBeLessThan(4);
  });
});

describe('stepCurl', () => {
  it('lifts the corner under a resting pointer to the measured hover strength, and no further', () => {
    const c = createCurl();
    let top = 0;
    for (let i = 0; i < 300; i++) {
      stepCurl(c, { ...lying, hovered: true }, 1 / 60);
      top = Math.max(top, c.shape.amount);
    }
    expect(HOVER).toBeCloseTo(1.966, 2);
    expect(c.shape.amount).toBeCloseTo(HOVER, 2);
    expect(top).toBeLessThanOrEqual(HOVER + 1e-6);
    expect(c.shape.lift).toBe(1);
  });

  it('scales with the page progress of the opening', () => {
    const c = createCurl();
    run(c, { ...lying, hovered: true, pages: 0.92 }, 5);
    expect(c.shape.amount).toBeCloseTo(HOVER * 0.92, 2);
  });

  it('slants the fold line toward the corner the pointer is near', () => {
    const head = createCurl();
    const foot = createCurl();
    run(head, { ...lying, hovered: true, grabV: 1 }, 2);
    run(foot, { ...lying, hovered: true, grabV: 0 }, 2);
    expect(head.shape.tilt).toBeCloseTo((T.tilt * Math.PI) / 180, 3);
    expect(foot.shape.tilt).toBeCloseTo((-T.tilt * Math.PI) / 180, 3);
  });

  it('curls less and over a longer span for a grab at the spine', () => {
    const c = createCurl();
    run(c, { ...lying, hovered: true, grabU: 0 }, 5);
    expect(c.shape.amount).toBeCloseTo(HOVER * (1 - T.innerLoss), 2);
    expect(c.shape.span).toBeCloseTo(T.span * (1 + T.inner), 3);
  });

  it('relaxes without a jump when the pointer leaves, and ends flat', () => {
    const c = createCurl();
    run(c, { ...lying, hovered: true }, 3);
    let last = c.shape.amount;
    let biggest = 0;
    for (let i = 0; i < 240; i++) {
      stepCurl(c, lying, 1 / 60);
      biggest = Math.max(biggest, last - c.shape.amount);
      expect(c.shape.amount).toBeLessThanOrEqual(last + 1e-9);
      last = c.shape.amount;
    }
    expect(biggest).toBeLessThan(0.15);
    expect(curlFlat(c)).toBe(true);
    expect(c.shape.amount).toBe(0);
  });

  it('comes down faster on a sheet another leaf is about to cover', () => {
    const slow = createCurl();
    const fast = createCurl();
    run(slow, { ...lying, hovered: true }, 3);
    run(fast, { ...lying, hovered: true }, 3);
    run(slow, lying, 0.3);
    run(fast, { ...lying, covered: true }, 0.3);
    expect(fast.shape.amount).toBeLessThan(slow.shape.amount * 0.3);
  });

  it('folds a held page over far past the half turn of the roll', () => {
    const c = createCurl();
    run(c, { ...lying, held: true, angle: 0.3, shown: 0.3 }, 3);
    expect(c.shape.amount).toBeGreaterThan(DRAG * 0.9);
    expect(c.shape.amount).toBeLessThanOrEqual(DRAG + 1e-6);
    expect(DRAG).toBeCloseTo(12.78, 1);
  });

  it('fades out as the leaf stands edge-on and lifts toward the reader on either side', () => {
    const c = createCurl();
    run(c, { ...lying, held: true, angle: 0.5, shown: 0.5 }, 3);
    stepCurl(c, { ...lying, held: true, angle: Math.PI / 2, shown: Math.PI / 2 }, 1 / 60);
    expect(c.shape.amount).toBeLessThan(1e-6);
    stepCurl(c, { ...lying, held: true, angle: 2.6, shown: 2.6 }, 1 / 60);
    expect(c.shape.lift).toBe(-1);
    expect(c.shape.amount).toBeGreaterThan(5);
  });

  it('lets a released leaf carry its curl and relax it before it lands', () => {
    const c = createCurl();
    run(c, { ...lying, held: true, angle: 1, shown: 1 }, 2);
    const held = c.shape.amount;
    // Let go at about a third of the way to the left side: the curl stays strong, without a jump.
    stepCurl(c, { ...lying, angle: 1, shown: 1, target: 1 }, 1 / 60);
    expect(c.flying).toBe(true);
    expect(Math.abs(c.shape.amount - held)).toBeLessThan(held * 0.1);
    // It relaxes as the leaf comes down on the left.
    const at = (share: number): number => {
      const angle = share * Math.PI;
      run(c, { ...lying, angle, shown: angle, target: 1, velocity: 0.03 }, 0.5);
      return c.shape.amount;
    };
    const mid = at(0.65);
    const late = at(0.8);
    const down = at(0.93);
    expect(mid).toBeGreaterThan(late);
    expect(late).toBeGreaterThan(0.5);
    expect(down).toBe(0);
    expect(c.flying).toBe(false);
  });

  it('gives a leaf turned by a key a curl once it is in the air, and none while it creeps down', () => {
    const c = createCurl();
    stepCurl(c, { ...lying, angle: 0.08, shown: 0.02, velocity: 0.08, target: 1 }, 1 / 60);
    expect(c.flying).toBe(false);
    run(c, { ...lying, angle: 0.6, shown: 0.55, velocity: 0.05, target: 1, pointerY: -0.4 }, 0.5);
    expect(c.flying).toBe(true);
    expect(c.shape.amount).toBeGreaterThan(3);
    // The fold slants by at least the measured 30 degrees, toward the half of the window the pointer is in.
    expect(c.shape.tilt).toBeCloseTo((-T.flightTilt * Math.PI) / 180, 2);
    run(c, { ...lying, angle: 2.95, shown: 2.95, velocity: 0.003, target: 1 }, 0.5);
    expect(c.flying).toBe(false);
    expect(c.shape.amount).toBe(0);
  });

  it('lets the pointer lift the corner of a leaf that has all but landed', () => {
    const c = createCurl();
    run(c, { ...lying, angle: 1.2, shown: 1.2, velocity: 0.05, target: 1 }, 0.5);
    run(c, { ...lying, angle: 2.95, shown: 2.95, velocity: 0.003, target: 1, hovered: true }, 3);
    expect(c.shape.amount).toBeGreaterThan(HOVER * 0.9);
    expect(c.shape.lift).toBe(-1);
  });

  it('does not jump when a hand takes a hovered page', () => {
    const c = createCurl();
    run(c, { ...lying, hovered: true, grabV: 0.9 }, 3);
    let last = c.shape.amount;
    for (let i = 0; i < 120; i++) {
      stepCurl(c, { ...lying, held: true, grabV: 0.9, angle: 0.01 * i, shown: 0.01 * i }, 1 / 60);
      expect(Math.abs(c.shape.amount - last)).toBeLessThan(0.6);
      last = c.shape.amount;
    }
  });

  it('runs nearly the same at 30, 60 and 120 Hz', () => {
    const at = (hz: number): number => {
      const c = createCurl();
      run(c, { ...lying, hovered: true }, 0.5, hz);
      return c.shape.amount;
    };
    expect(Math.abs(at(30) - at(60))).toBeLessThan(0.08);
    expect(Math.abs(at(120) - at(60))).toBeLessThan(0.08);
  });

  it('is flat again after a reset', () => {
    const c = createCurl();
    run(c, { ...lying, held: true, angle: 0.4, shown: 0.4 }, 1);
    resetCurl(c);
    expect(curlFlat(c)).toBe(true);
    expect(c.shape.amount).toBe(0);
    expect(c.flying).toBe(false);
  });
});
