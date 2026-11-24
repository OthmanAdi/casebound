import { describe, expect, it } from 'vitest';
import { PEN_DEFAULT, createPen, penLean, restPen, stepPen } from './pen-motion';

const DT = 1 / 60;

describe('the pen in the hand', () => {
  it('comes down onto the paper as captured: 0.698, 0.352, 0.156, 0.065, 0.026, 0.010 of the way left', () => {
    const s = createPen();
    for (let i = 0; i < 30; i++) stepPen(s, { x: 197, y: 455, onPage: true, pressed: false }, DT);
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      stepPen(s, { x: 197, y: 455, onPage: true, pressed: true }, DT);
      seen.push(s.lift);
    }
    const captured = [0.698, 0.352, 0.156, 0.065, 0.026, 0.01];
    for (const [i, want] of captured.entries()) expect(seen[i]!).toBeCloseTo(want, 2);
  });

  it('rises again more slowly: half way after about 76 ms, nine tenths after about 176 ms', () => {
    const s = createPen();
    for (let i = 0; i < 60; i++) stepPen(s, { x: 0, y: 0, onPage: true, pressed: true }, DT);
    expect(s.lift).toBeLessThan(1e-3);
    const at = (ms: number): number => {
      const c = { ...s, liftVel: { ...s.liftVel } };
      const steps = Math.round(ms / (1000 / 240));
      for (let i = 0; i < steps; i++) stepPen(c, { x: 0, y: 0, onPage: true, pressed: false }, 1 / 240);
      return c.lift;
    };
    expect(at(23)).toBeGreaterThan(0.04);
    expect(at(23)).toBeLessThan(0.2);
    expect(at(76)).toBeGreaterThan(0.4);
    expect(at(76)).toBeLessThan(0.6);
    expect(at(176)).toBeGreaterThan(0.84);
    expect(at(400)).toBeGreaterThan(0.995);
  });

  it('leans 0.42 rad hovering and 0.54 pressed', () => {
    const s = createPen();
    for (let i = 0; i < 30; i++) stepPen(s, { x: 0, y: 0, onPage: true, pressed: false }, DT);
    expect(penLean(s)).toBeCloseTo(0.42, 3);
    for (let i = 0; i < 30; i++) stepPen(s, { x: 0, y: 0, onPage: true, pressed: true }, DT);
    expect(penLean(s)).toBeCloseTo(0.54, 3);
  });

  it('stays hovering when the press is not on a page', () => {
    const s = createPen();
    for (let i = 0; i < 30; i++) stepPen(s, { x: 0, y: 0, onPage: false, pressed: true }, DT);
    expect(s.lift).toBe(1);
  });

  it('rolls against a sweep as captured: 1200 px a second for a quarter second, then still', () => {
    // The capture: the pointer rests, then moves 20 px a frame for 15 frames and stops.
    const s = createPen();
    let x = 500;
    for (let i = 0; i < 48; i++) stepPen(s, { x, y: 560, onPage: true, pressed: false }, DT);
    const roll: number[] = [];
    for (let f = 1; f <= 75; f++) {
      if (f <= 15) x += 20;
      stepPen(s, { x, y: 560, onPage: true, pressed: false }, DT);
      roll.push(s.roll);
    }
    // Readings every 50 ms from the start of the sweep, less the 0.006 the captured pen still had from before.
    const captured = [0.0055, 0.042, 0.101, 0.166, 0.223, 0.26];
    for (const [k, want] of captured.entries()) expect(roll[(k + 1) * 3 - 1]!).toBeCloseTo(want, 1);
    const peak = Math.max(...roll);
    expect(peak).toBeGreaterThan(0.255);
    expect(peak).toBeLessThan(0.28);
    // The peak comes about 67 ms after the pointer has stopped.
    const at = roll.indexOf(peak) + 1;
    expect(at).toBeGreaterThanOrEqual(17);
    expect(at).toBeLessThanOrEqual(21);
    // It swings past rest by about 0.02 rad some 450 ms after the stop, and is still within 0.002 after 750 ms.
    const low = Math.min(...roll.slice(15));
    expect(low).toBeLessThan(-0.012);
    expect(low).toBeGreaterThan(-0.03);
    expect(Math.abs(roll[15 + 45]!)).toBeLessThan(0.004);
  });

  it('holds a steady roll of 0.05 rad at 200 px a second', () => {
    const s = createPen();
    let x = 0;
    for (let i = 0; i < 240; i++) {
      x += 200 * DT;
      stepPen(s, { x, y: 0, onPage: true, pressed: false }, DT);
    }
    expect(s.roll).toBeCloseTo(0.05, 3);
  });

  it('stands up moving down the screen and leans further moving up', () => {
    const run = (speed: number): number => {
      const s = createPen();
      let y = 500;
      for (let i = 0; i < 240; i++) {
        y += speed * DT;
        stepPen(s, { x: 0, y, onPage: true, pressed: false }, DT);
      }
      return penLean(s);
    };
    // Captured: 0.444 moving up at 200 px a second.
    expect(run(-200)).toBeCloseTo(0.444, 3);
    expect(run(200)).toBeCloseTo(0.396, 3);
    // Never straighter than its limit allows, however fast.
    expect(run(9000)).toBeCloseTo(0.42 - PEN_DEFAULT.pitchLimit, 3);
  });

  it('shows its footprint over a page and takes it away under a press, as captured', () => {
    const s = createPen();
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      stepPen(s, { x: 0, y: 0, onPage: true, pressed: false }, DT);
      seen.push(s.footprint);
    }
    for (const [i, want] of [0.354, 0.569, 0.699, 0.778].entries()) expect(seen[i]!).toBeCloseTo(want, 3);
    for (let i = 0; i < 60; i++) stepPen(s, { x: 0, y: 0, onPage: true, pressed: false }, DT);
    expect(s.footprint).toBeCloseTo(0.9, 3);
    const gone: number[] = [];
    for (let i = 0; i < 4; i++) {
      stepPen(s, { x: 0, y: 0, onPage: true, pressed: true }, DT);
      gone.push(s.footprint);
    }
    for (const [i, want] of [0.546, 0.331, 0.201, 0.122].entries()) expect(gone[i]!).toBeCloseTo(want, 3);
  });

  it('has no speed in its first frame after it was hidden', () => {
    const s = createPen();
    stepPen(s, { x: 0, y: 0, onPage: true, pressed: false }, DT);
    restPen(s);
    stepPen(s, { x: 900, y: 700, onPage: true, pressed: false }, DT);
    expect(s.vx).toBe(0);
    expect(s.vy).toBe(0);
  });
});
