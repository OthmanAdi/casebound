/**
 * From scroll position to the value the books read. Pure functions, so the feel can be tested without a browser.
 * SPEC S-SCR-1..6.
 */
import { clamp, smoothDamp, smoothstep, type Velocity } from '../core/math';

export interface ScrollTuning {
  /** Pixels of scrolling around a featured book's rest position during which it dwells: half after it, half before the next book rests. */
  lockPx: number;
  /**
   * How far the book still travels while it dwells, in slots per pixel of scrolling. 0 holds it dead still.
   * Measured: 2.08e-4 at 1440 x 900, which is 0.15 of a slot over a slot of 722 px and 0.18 over one of 872 px.
   */
  creep: number;
  /** Smooth time of the damping, seconds. */
  smoothTime: number;
  /** Progress must leave this band around the current book before the active book changes. */
  hysteresis: number;
}

export const SCROLL_DESKTOP: ScrollTuning = { lockPx: 150, creep: 2.08e-4, smoothTime: 0.066, hysteresis: 0.65 };
export const SCROLL_COMPACT: ScrollTuning = { lockPx: 150, creep: 2.08e-4, smoothTime: 0.0945, hysteresis: 0.65 };

/**
 * The dwell curve. Raw progress runs evenly with the scroll bar; the returned progress lingers around each whole
 * number for `plateau` (a fraction of a slot, half before and half after) and makes up the way in between, so
 * every book gets a moment at rest without any scroll snapping.
 *
 * Measured: the book never stands dead still. It creeps at `creep` slots per slot the whole way, and a cycloid
 * between the two dwells carries the rest. The curve has no kink: its slope is `creep` at both ends of the cycloid.
 */
export function dwell(raw: number, plateau: number, creep = 0): number {
  const i = Math.floor(raw);
  const f = raw - i;
  const p = clamp(plateau, 0, 0.9);
  const c = clamp(creep, 0, 0.9);
  // The plateau is centred on the whole number: half before, half after.
  const u = clamp((f - p / 2) / (1 - p), 0, 1);
  const cycloid = u - Math.sin(2 * Math.PI * u) / (2 * Math.PI);
  return i + c * f + (1 - c) * cycloid;
}

/** Smooths the step of a mouse wheel notch before the damper sees it. */
export interface BridgeState {
  prevY: number;
  prevDy: number;
  /** Engine time of the last notch, seconds. */
  lastNotch: number;
  /** Smoothed time between notches, seconds. */
  interval: number;
  /** Length of the ramp a notch is spread over, seconds. */
  ramp: number;
  active: boolean;
  out: number;
  target: number;
  rate: number;
  init: boolean;
}

export const createBridge = (): BridgeState => ({ prevY: Number.NaN, prevDy: 0, lastNotch: -Infinity, interval: 0.1, ramp: 0.1, active: false, out: 0, target: 0, rate: 0, init: false });

/**
 * A wheel notch moves the page by a block of pixels in one frame. Fed straight to the damper the books lunge.
 * Measured: a jump of 24 px or more that follows a still frame, within 120 ms of a wheel event, reaches the damper
 * as a straight ramp instead, 1.15 times the time between notches long (60 to 160 ms, 115 ms for a single notch).
 * The ramp stays in force until 0.35 s after the last notch. Scroll bars, keys and touch are not touched.
 * @param target the progress the scroll position asks for
 * @param time engine time in seconds
 * @param wheelAgo seconds since the last wheel event
 * @returns the progress to hand to the damper
 */
export function stepBridge(s: BridgeState, target: number, scrollY: number, time: number, dt: number, wheelAgo: number): number {
  if (Number.isNaN(s.prevY)) s.prevY = scrollY;
  const dy = scrollY - s.prevY;
  s.prevY = scrollY;
  const notch = Math.abs(dy) >= 24 && s.prevDy === 0 && wheelAgo <= 0.12;
  s.prevDy = dy;
  if (notch) {
    const since = time - s.lastNotch;
    s.interval = since <= 0.3 ? (s.active ? s.interval + (since - s.interval) * 0.5 : since) : 0.1;
    s.ramp = clamp(1.15 * s.interval, 0.06, 0.16);
    s.lastNotch = time;
    s.active = true;
  } else if (s.active && time - s.lastNotch > Math.max(0.35, s.ramp)) s.active = false;
  if (!s.init || (!s.active && s.out === s.target)) {
    s.out = s.target = target;
    s.rate = 0;
    s.init = true;
    return target;
  }
  if (target !== s.target) {
    s.target = target;
    s.rate = Math.abs(target - s.out) / s.ramp;
  }
  const left = target - s.out;
  const step = s.rate * dt;
  s.out = Math.abs(left) <= step ? target : s.out + Math.sign(left) * step;
  return s.out;
}

export interface ScrollState {
  /** Damped progress in slots. Book i is centred when this equals i. */
  progress: number;
  velocity: Velocity;
  /** Index of the book that counts as current. */
  active: number;
  seeded: boolean;
}

export const createScrollState = (): ScrollState => ({ progress: 0, velocity: { v: 0 }, active: 0, seeded: false });

/**
 * Limits on how fast the stack runs. Without them a quick scroll or a jump of the scroll bar from one end of the
 * page to the other shows the book it left and then the book it came to: the books between are over before they
 * are seen.
 */
export interface ScrollLimits {
  /** The most the progress falls, in slots per second: the way back up the page. 0: no limit. */
  fall?: number;
  /** The most it rises, in slots per second: the way down the page. 0: no limit. */
  rise?: number;
  /** The progress does not fall below this. Used while the row of spines still holds the books of the stack. */
  floor?: number;
}

/**
 * Advances the damped progress by one frame.
 * @returns true while the value is still moving
 */
export function stepScroll(
  state: ScrollState,
  scrollY: number,
  slotPx: number,
  count: number,
  tuning: ScrollTuning,
  dt: number,
  still = false,
  wheel?: { bridge: BridgeState; time: number; ago: number },
  limits?: ScrollLimits,
): boolean {
  const raw = clamp(slotPx > 0 ? scrollY / slotPx : 0, 0, Math.max(0, count - 1));
  const asked = dwell(raw, tuning.lockPx / Math.max(1, slotPx), tuning.creep * slotPx);
  // A wheel notch is spread over a short ramp before the damper follows it.
  const target = wheel && state.seeded && !still ? stepBridge(wheel.bridge, asked, scrollY, wheel.time, clamp(dt, 1 / 240, 1 / 30), wheel.ago) : asked;
  const before = state.progress;
  if (!state.seeded || still) {
    state.progress = target;
    state.velocity.v = 0;
    state.seeded = true;
  } else {
    const step = clamp(dt, 1 / 240, 1 / 30);
    let next = smoothDamp(state.progress, target, state.velocity, tuning.smoothTime, step);
    if (limits && next > before && limits.rise && limits.rise > 0 && next > before + limits.rise * step) {
      next = before + limits.rise * step;
      state.velocity.v = limits.rise;
    }
    if (limits && next < before) {
      // Every book on the way is seen: the stack comes down no faster than this.
      if (limits.fall && limits.fall > 0 && next < before - limits.fall * step) {
        next = before - limits.fall * step;
        state.velocity.v = -limits.fall;
      }
      // And it waits where it is while it may not go lower.
      if (limits.floor !== undefined && next < limits.floor) {
        next = Math.min(before, limits.floor);
        state.velocity.v = 0;
      }
    }
    state.progress = next;
  }
  if (Math.abs(state.progress - state.active) > tuning.hysteresis) state.active = clamp(Math.round(state.progress), 0, count - 1);
  return Math.abs(state.progress - before) > 1e-4 || Math.abs(state.progress - asked) > 1e-3;
}

export interface HasteState {
  /** Scroll position of the frame before, pixels. NaN before the first frame. */
  y: number;
  /** Smoothed scroll speed in window heights per second. */
  speed: number;
  /** 0..1: how much of the extra turn rate is in effect. */
  w: number;
}

export const createHaste = (): HasteState => ({ y: Number.NaN, speed: 0, w: 0 });

/**
 * How hurried the turn of the books is this frame, 0..1. Measured: a book follows its turn half as fast again
 * while the page scrolls faster than 2.5 window heights per second (nothing below 1), and the hurry wears off
 * over 0.6 s. After a jump of the scroll bar the arriving book therefore finishes its turn with its travel
 * instead of trailing it.
 */
export function stepHaste(state: HasteState, scrollY: number, windowPx: number, dt: number): number {
  if (!Number.isNaN(state.y) && dt > 0) {
    const now = Math.abs(scrollY - state.y) / dt / Math.max(1, windowPx);
    state.speed += (now - state.speed) * (1 - Math.exp(-dt / 0.12));
  }
  state.y = scrollY;
  state.w = Math.max(smoothstep(1, 2.5, state.speed), state.w - dt / 0.6);
  return state.w;
}
