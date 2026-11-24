import { describe, expect, it } from 'vitest';
import { BRAKE_FULL, braked, createLeafMotion, heldTurn, LEAF_DEFAULT, sendLeaf, sheetTurn, stepLeaf, throwLeaf, windOf } from './leaf-physics';

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

describe('throwLeaf', () => {
  /** A leaf let go by a hand at `from` (a share of the turn), heading for `side`. Returns the simulated turn per frame. */
  const letGo = (from: number, side: 0 | 1, frames: number): number[] => {
    const m = createLeafMotion(side === 1 ? 0 : 1);
    m.angle = m.shown = from * Math.PI;
    sendLeaf(m, side, 0);
    let pending = true;
    const out: number[] = [];
    for (let i = 0; i < frames; i++) {
      stepLeaf(m, 1 / 60);
      if (pending) pending = !throwLeaf(m, side);
      out.push(m.angle / Math.PI);
    }
    return out;
  };

  it('matches a leaf let go past upright on the reference', () => {
    // Simulated turn per frame after a pull was let go at 0.6042 of the turn, read from a frame-stepped capture
    // (PARITY-hand): one step from rest, then the throw.
    const measured = [0.6063, 0.6305, 0.6535, 0.6755, 0.6965, 0.7165, 0.7356, 0.7537, 0.7706, 0.7861, 0.8002, 0.8128, 0.8239];
    const ours = letGo(0.6042, 1, measured.length);
    for (const [i, value] of measured.entries()) expect(Math.abs(ours[i]! - value), `frame ${i + 1}`).toBeLessThan(0.002);
  });

  it('matches a leaf let go before upright: it gathers speed by itself and is thrown as it passes', () => {
    // The same capture, a pull let go at a third of the turn: the frames around upright.
    const measured = [0.4392, 0.4529, 0.467, 0.4815, 0.4963, 0.5114, 0.5357, 0.5591, 0.5815, 0.6031, 0.624, 0.6442];
    const m = createLeafMotion(0);
    m.angle = m.shown = 0.4392 * Math.PI;
    m.velocity = 0.0417;
    sendLeaf(m, 1, 0);
    let pending = true;
    const ours = [0.4392];
    for (let i = 1; i < measured.length; i++) {
      stepLeaf(m, 1 / 60);
      if (pending) pending = !throwLeaf(m, 1);
      ours.push(m.angle / Math.PI);
    }
    for (const [i, value] of measured.entries()) expect(Math.abs(ours[i]! - value), `frame ${i}`).toBeLessThan(0.003);
  });

  it('leaves a leaf alone that falls back to the stack it came from', () => {
    const m = createLeafMotion(0);
    m.angle = m.shown = 0.3 * Math.PI;
    sendLeaf(m, 0, 0);
    stepLeaf(m, 1 / 60);
    const before = m.velocity;
    // Nothing is to come for a leaf that is not on its way across: the caller only asks for one that is.
    expect(throwLeaf(m, 1)).toBe(true);
    expect(m.velocity).toBe(before);
  });

  it('throws a leaf back the same way', () => {
    const back = letGo(0.38, 0, 20);
    const forth = letGo(0.62, 1, 20);
    for (let i = 0; i < 20; i++) expect(back[i]! + forth[i]!).toBeCloseTo(1, 6);
  });
});

describe('sheetTurn', () => {
  it('keeps the sheet on its stack at both ends of the turn', () => {
    expect(sheetTurn(0)).toBe(0);
    expect(sheetTurn(0.03)).toBe(0);
    expect(sheetTurn(0.9)).toBe(1);
    expect(sheetTurn(1)).toBe(1);
  });

  it('follows the sweep measured on the reference', () => {
    // Share of its whole swing the sheet has covered at a drawn turn, in free flight after a tap (PARITY-hand).
    const measured: [number, number][] = [[0.17, 0.091], [0.335, 0.365], [0.49, 0.543], [0.642, 0.757], [0.736, 0.899], [0.778, 0.952], [0.854, 0.993]];
    for (const [turn, share] of measured) expect(Math.abs(sheetTurn(turn) - share), `at ${turn}`).toBeLessThan(0.09);
  });

  it('never goes back', () => {
    for (let k = 1; k <= 100; k++) expect(sheetTurn(k / 100)).toBeGreaterThanOrEqual(sheetTurn((k - 1) / 100));
  });
});

describe('a sheet in a hand', () => {
  it('comes off its stack late and then stands where the hand has it', () => {
    expect(heldTurn(0)).toBe(0);
    expect(heldTurn(0.04)).toBe(0);
    // Measured on the reference in a held pull: 12, 25, 42 and 59 degrees.
    expect(heldTurn(0.16) * 180).toBeGreaterThan(8);
    expect(heldTurn(0.16) * 180).toBeLessThan(14);
    expect(heldTurn(0.21) * 180).toBeGreaterThan(20);
    expect(heldTurn(0.21) * 180).toBeLessThan(27);
    expect(heldTurn(0.27) * 180).toBeGreaterThan(39);
    expect(heldTurn(0.27) * 180).toBeLessThan(45);
    expect(heldTurn(0.34)).toBeCloseTo(0.34, 6);
    expect(heldTurn(0.5)).toBeCloseTo(0.5, 6);
  });

  it('comes down on the other stack the same way, mirrored', () => {
    for (const x of [0, 0.05, 0.1, 0.2, 0.3, 0.45]) expect(heldTurn(1 - x)).toBeCloseTo(1 - heldTurn(x), 9);
    expect(heldTurn(1)).toBe(1);
  });

  it('never goes back as the hand goes on', () => {
    let last = 0;
    for (let x = 0; x <= 1.0001; x += 0.005) {
      const now = heldTurn(x);
      expect(now).toBeGreaterThanOrEqual(last - 1e-12);
      last = now;
    }
  });

  it('stands straighter the slower it moves', () => {
    expect(windOf(0)).toBe(0);
    // A hand pulls at about half the pace of a flying leaf.
    expect(windOf(0.03)).toBeCloseTo(0.25, 6);
    expect(windOf(-0.03)).toBeCloseTo(0.25, 6);
    expect(windOf(0.06)).toBe(1);
    expect(windOf(0.08)).toBe(1);
  });
});

describe('a press on a leaf in the air', () => {
  it('brakes it: the push fades and it loses more speed', () => {
    const fresh = braked(LEAF_DEFAULT, 0);
    expect(fresh.accel).toBe(LEAF_DEFAULT.accel);
    expect(fresh.damping).toBeCloseTo(LEAF_DEFAULT.damping + 0.035, 9);
    const half = braked(LEAF_DEFAULT, BRAKE_FULL / 2);
    expect(half.accel).toBeCloseTo(LEAF_DEFAULT.accel / 2, 9);
    expect(half.damping).toBeCloseTo(LEAF_DEFAULT.damping + 0.035 + 0.2325, 9);
    expect(braked(LEAF_DEFAULT, 9).accel).toBe(0);
  });

  it('slows the leaf without stopping it in the time the press waits', () => {
    const run = (brake: boolean): number => {
      const m = createLeafMotion(0);
      sendLeaf(m, 1);
      for (let i = 0; i < 18; i++) stepLeaf(m, 1 / 60);
      const from = m.angle;
      for (let i = 0; i < 12; i++) stepLeaf(m, 1 / 60, brake ? braked(LEAF_DEFAULT, i / 60) : LEAF_DEFAULT);
      return m.angle - from;
    };
    const free = run(false);
    const slowed = run(true);
    expect(slowed).toBeGreaterThan(0.1 * free);
    expect(slowed).toBeLessThan(0.85 * free);
  });
});
