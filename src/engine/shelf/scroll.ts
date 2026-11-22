/**
 * From scroll position to the value the books read. Pure functions, so the feel can be tested without a browser.
 * SPEC S-SCR-1..6.
 */
import { clamp, smoothDamp, type Velocity } from '../core/math';

export interface ScrollTuning {
  /** Pixels of scrolling during which a featured book holds still at the centre. */
  lockPx: number;
  /** Smooth time of the damping, seconds. */
  smoothTime: number;
  /** Progress must leave this band around the current book before the active book changes. */
  hysteresis: number;
}

export const SCROLL_DESKTOP: ScrollTuning = { lockPx: 150, smoothTime: 0.066, hysteresis: 0.65 };
export const SCROLL_COMPACT: ScrollTuning = { lockPx: 150, smoothTime: 0.0945, hysteresis: 0.65 };

/**
 * The dwell curve. Raw progress runs evenly with the scroll bar; the returned progress waits on each whole
 * number for `plateau` (a fraction of a slot) and then leaves gently, so every book gets a moment at rest
 * without any scroll snapping.
 */
export function dwell(raw: number, plateau: number): number {
  const i = Math.floor(raw);
  const f = raw - i;
  const p = clamp(plateau, 0, 0.9);
  // The plateau is centred on the whole number: half before, half after.
  const half = p / 2;
  if (f <= half) return i;
  if (f >= 1 - half) return i + 1;
  const g = (f - half) / (1 - p);
  // Half straight line, half cycloid: leaves and arrives with zero slope but keeps moving in the middle.
  const cycloid = g - Math.sin(2 * Math.PI * g) / (2 * Math.PI);
  return i + 0.5 * g + 0.5 * cycloid;
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
 * Advances the damped progress by one frame.
 * @returns true while the value is still moving
 */
export function stepScroll(state: ScrollState, scrollY: number, slotPx: number, count: number, tuning: ScrollTuning, dt: number, still = false): boolean {
  const raw = clamp(slotPx > 0 ? scrollY / slotPx : 0, 0, Math.max(0, count - 1));
  const target = dwell(raw, tuning.lockPx / Math.max(1, slotPx));
  const before = state.progress;
  if (!state.seeded || still) {
    state.progress = target;
    state.velocity.v = 0;
    state.seeded = true;
  } else {
    state.progress = smoothDamp(state.progress, target, state.velocity, tuning.smoothTime, clamp(dt, 1 / 240, 1 / 30));
  }
  if (Math.abs(state.progress - state.active) > tuning.hysteresis) state.active = clamp(Math.round(state.progress), 0, count - 1);
  return Math.abs(state.progress - before) > 1e-4 || Math.abs(state.progress - target) > 1e-3;
}
