import { describe, expect, it } from 'vitest';
import { SPIN_DEFAULT, createSpin, dragSpin, grabSpin, releaseSpin, stepSpin, wrapAngle } from './spin';

const run = (s: ReturnType<typeof createSpin>, seconds: number, fps: number): void => {
  for (let i = 0; i < Math.round(seconds * fps); i++) stepSpin(s, 1 / fps);
};

describe('spin', () => {
  it('turns by the measured gain and the drawn book catches up', () => {
    const s = createSpin();
    const grab = grabSpin(s, false);
    dragSpin(s, grab, 200, -40);
    expect(s.yaw).toBeCloseTo(200 * 0.0084375, 6);
    expect(s.pitch).toBeCloseTo(-40 * 0.0084375, 6);
    run(s, 0.6, 60);
    expect(s.shownYaw).toBeCloseTo(s.yaw, 3);
    expect(s.shownPitch).toBeCloseTo(s.pitch, 3);
  });

  it('a finger turns the book only sideways', () => {
    const s = createSpin();
    const grab = grabSpin(s, true);
    dragSpin(s, grab, 100, 300);
    expect(s.pitch).toBe(0);
    expect(s.yaw).toBeCloseTo(100 * 0.01125, 6);
  });

  it('coasts twenty first steps far, whatever the frame rate', () => {
    const ends = [30, 60, 120].map((fps) => {
      const s = createSpin();
      const grab = grabSpin(s, false);
      releaseSpin(s, grab, 600, 0);
      const first = s.coastYaw;
      expect(first).toBeCloseTo((600 * 0.0084375) / 60, 6);
      run(s, 1.9, fps);
      return s.yaw / first;
    });
    for (const e of ends) expect(e).toBeGreaterThan(19);
    for (const e of ends) expect(e).toBeLessThan(20.01);
    expect(Math.abs(ends[0]! - ends[2]!)).toBeLessThan(0.3);
  });

  it('caps the coasting step', () => {
    const s = createSpin();
    const grab = grabSpin(s, false);
    releaseSpin(s, grab, 90000, 90000);
    expect(Math.hypot(s.coastYaw, s.coastPitch)).toBeCloseTo(SPIN_DEFAULT.inertiaCap, 6);
  });

  it('leaves a small pitch alone and levels a book left upside down', () => {
    const small = createSpin(0.6, 0);
    releaseSpin(small, grabSpin(small, false), 0, 0);
    run(small, 9, 60);
    expect(small.pitch).toBeCloseTo(0.6, 6);

    const over = createSpin(2.4, 0);
    releaseSpin(over, grabSpin(over, false), 0, 0);
    run(over, 1.5, 60);
    expect(over.pitch).toBeCloseTo(2.4, 6);
    run(over, 6, 60);
    expect(Math.abs(wrapAngle(over.pitch))).toBeLessThan(1e-6);
  });

  it('turns with the hand when grabbed upside down', () => {
    const s = createSpin(Math.PI, 0);
    const grab = grabSpin(s, false);
    expect(grab.flip).toBe(-1);
    dragSpin(s, grab, 100, 0);
    expect(s.yaw).toBeLessThan(0);
  });

  it('lifts the trailing cover while the book turns and shuts it afterwards', () => {
    const s = createSpin();
    const grab = grabSpin(s, false);
    let peak = 0;
    for (let i = 0; i < 40; i++) {
      dragSpin(s, grab, i * 14, 0);
      stepSpin(s, 1 / 60);
      peak = Math.max(peak, s.front);
    }
    expect(peak).toBeGreaterThan(0.05);
    expect(peak).toBeLessThanOrEqual(SPIN_DEFAULT.flapLimit + 1e-6);
    expect(s.back).toBe(0);
    releaseSpin(s, grab, 0, 0);
    run(s, 2, 60);
    expect(s.front).toBe(0);
  });

  it('lifts the board as far as the board of the reference stood', () => {
    // A pull of 260 px straight down in 0.8 s (PARITY-hand): the pitch runs at 2.6 to 3 rad/s and the front board
    // of the reference stands 14.5 to 15 degrees open from 400 ms on.
    const s = createSpin();
    const grab = grabSpin(s, false);
    const lift: number[] = [];
    for (let i = 1; i <= 48; i++) {
      dragSpin(s, grab, 0, (260 * i) / 48);
      stepSpin(s, 1 / 60);
      lift.push((s.front * 180) / Math.PI);
    }
    expect(lift[23]).toBeGreaterThan(12.5);
    expect(lift[23]).toBeLessThan(16.5);
    expect(lift[47]).toBeGreaterThan(13);
    expect(lift[47]).toBeLessThan(16.5);
    expect(s.back).toBe(0);
  });

  it('comes to rest and says so', () => {
    const s = createSpin();
    const grab = grabSpin(s, false);
    dragSpin(s, grab, 80, 10);
    releaseSpin(s, grab, 0, 0);
    let moving = true;
    for (let i = 0; i < 60 * 6 && moving; i++) moving = stepSpin(s, 1 / 60);
    expect(moving).toBe(false);
  });
});
