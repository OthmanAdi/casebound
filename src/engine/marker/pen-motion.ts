/**
 * How the pen moves in the hand. Pure numbers: no scene, no pointer events.
 *
 * Measured on the reference (SPEC S-RD-13): the pen has no lag. It stands on the pointer in every frame. What
 * gives it life is small: it hovers a little above the paper and comes down when pressed, it leans toward the
 * reader and a little further when pressed, and it swings against the direction of travel on two springs, one
 * sideways (roll) and one toward and away from the reader (pitch).
 */
import { clamp, smoothDamp, type Velocity } from '../core/math';

export interface PenTuning {
  /** How high the pen hovers when it is not pressed, as a share of its length, along its own axis. */
  hover: number;
  /** How far it leans toward the reader, radians, and how much further when pressed. */
  lean: number;
  leanPressed: number;
  /** It never stands straighter than this, radians. */
  leanMin: number;
  /** Turn about its own axis, radians: the chisel faces a little to the side. */
  twist: number;
  /** Smoothing time of the way down onto the paper and of the way up, seconds. */
  down: number;
  up: number;
  /** Roll per pointer speed, radians per pixel per second, and its limit. */
  rollGain: number;
  rollLimit: number;
  /** Pitch per pointer speed and its limit. Moving down the screen the pen stands up, moving up it leans further. */
  pitchGain: number;
  pitchLimit: number;
  /** The springs of roll and pitch: pull per second squared, and the share of speed lost per second as an exponent. */
  stiffness: number;
  loss: number;
  /** Time over which the pointer's speed is averaged, seconds. */
  speedSmooth: number;
  /** Opacity of the footprint under a hovering nib, and how fast it comes and goes, per second. */
  footprint: number;
  footprintRate: number;
}

/** As read in the reference's script and confirmed against its frames. */
export const PEN_DEFAULT: PenTuning = {
  hover: 0.07,
  lean: 0.42,
  leanPressed: 0.12,
  leanMin: 0.05,
  twist: -0.35,
  down: 0.03,
  up: 0.09,
  rollGain: 0.00025,
  rollLimit: 0.4,
  pitchGain: 0.00012,
  pitchLimit: 0.2,
  stiffness: 120,
  loss: 13,
  speedSmooth: 0.05,
  footprint: 0.9,
  footprintRate: 30,
};

export interface PenState {
  /** 1 = hovering, 0 = on the paper. */
  lift: number;
  liftVel: Velocity;
  roll: number;
  rollVel: number;
  pitch: number;
  pitchVel: number;
  /** Smoothed pointer speed, pixels per second. */
  vx: number;
  vy: number;
  /** Where the pointer was in the frame before. Not known before the first frame and after the pen was hidden. */
  x: number;
  y: number;
  seen: boolean;
  /** Opacity of the footprint. */
  footprint: number;
}

export const createPen = (): PenState => ({ lift: 1, liftVel: { v: 0 }, roll: 0, rollVel: 0, pitch: 0, pitchVel: 0, vx: 0, vy: 0, x: 0, y: 0, seen: false, footprint: 0 });

export interface PenInput {
  /** The pointer, in pixels, x to the right and y down. */
  x: number;
  y: number;
  /** The pointer's ray meets a page. */
  onPage: boolean;
  /** The button is down. */
  pressed: boolean;
}

/** Forgets where the pointer was, for a pen that was hidden: its next frame has no speed. */
export function restPen(s: PenState): void {
  s.seen = false;
  s.vx = s.vy = 0;
}

/** One step of an under-damped spring. Returns [value, speed]. */
const spring = (x: number, vel: number, target: number, dt: number, t: PenTuning): [number, number] => {
  let v = vel + (target - x) * t.stiffness * dt;
  v *= Math.exp(-t.loss * dt);
  return [x + v * dt, v];
};

/** Advances the pen by `dt` seconds. */
export function stepPen(s: PenState, input: PenInput, dt: number, t: PenTuning = PEN_DEFAULT): void {
  const step = Math.min(Math.max(dt, 0), 0.05);
  if (step <= 0) return;
  // The speed of the pointer, averaged over a twentieth of a second. None in the first frame.
  if (s.seen) {
    const k = 1 - Math.exp(-step / Math.max(1e-4, t.speedSmooth));
    s.vx += ((input.x - s.x) / step - s.vx) * k;
    s.vy += ((input.y - s.y) / step - s.vy) * k;
  } else s.vx = s.vy = 0;
  s.x = input.x;
  s.y = input.y;
  s.seen = true;

  const down = input.pressed && input.onPage;
  s.lift = smoothDamp(s.lift, down ? 0 : 1, s.liftVel, down ? t.down : t.up, step);
  [s.roll, s.rollVel] = spring(s.roll, s.rollVel, clamp(t.rollGain * s.vx, -t.rollLimit, t.rollLimit), step, t);
  [s.pitch, s.pitchVel] = spring(s.pitch, s.pitchVel, clamp(-t.pitchGain * s.vy, -t.pitchLimit, t.pitchLimit), step, t);

  const shown = input.onPage && !input.pressed ? t.footprint : 0;
  s.footprint += (shown - s.footprint) * (1 - Math.exp(-t.footprintRate * step));
}

/** How far the pen leans toward the reader, radians. */
export const penLean = (s: PenState, t: PenTuning = PEN_DEFAULT): number => Math.max(t.leanMin, t.lean + t.leanPressed * (1 - s.lift) + s.pitch);

/** True while the pen is still coming to rest: its lift, its springs or its footprint are moving. */
export const penMoving = (s: PenState): boolean =>
  Math.abs(s.rollVel) > 1e-3 || Math.abs(s.pitchVel) > 1e-3 || Math.abs(s.roll) > 1e-3 || Math.abs(s.pitch) > 1e-3 || Math.abs(s.liftVel.v) > 1e-3 || Math.abs(s.vx) + Math.abs(s.vy) > 0.5;
