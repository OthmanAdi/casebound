/**
 * The weight of the open book follows the pointer (SPEC S-RD-5).
 *
 * An open book does not turn toward the pointer as a whole: its boards stay where they lie. What moves is the
 * place it is open at, as far as the case is concerned. The spine rolls toward one side as if the book were open
 * a little earlier or later, the gutter goes with it, and the page under the pointer lies flatter. This module
 * holds the pure part: how far the reading place is shifted for a pointer position, and how that shift moves.
 */
import { clamp, smoothstep } from '../core/math';

export interface PushTuning {
  /** Largest shift near the middle of the spread, as a share of the book. The page under the pointer is pressed flat. */
  max: number;
  /** Near the window edge the book opens toward that side instead, up to this reading place. */
  edge: number;
  /** How late the edge takes over: the middle rule fades with (1 - |x|) to this power plus one. */
  edgePower: number;
  /** How fast the shift follows its goal, 1/s. */
  rate: number;
  /** Seconds to blend when the pointer crosses the middle, where the goal jumps from one side to the other. */
  swap: number;
}

/** Read in the reference's code and confirmed on three captures (pointer on the previous, next and lens buttons). */
export const PUSH_DEFAULT: PushTuning = { max: 0.2, edge: 0.3, edgePower: 4, rate: 7, swap: 0.4 };

/**
 * The shift the pointer asks for. `x` is the pointer across the picture, -1 at the left edge to 1 at the right,
 * measured from the middle of the spread. `reading` is the share of the leaves on the left, 0..1.
 */
export function pushGoal(x: number, reading: number, t: PushTuning = PUSH_DEFAULT): number {
  const side = x < 0 ? -1 : 1;
  const n = Math.min(1, Math.abs(x));
  const edge = 1 - Math.pow(1 - n, t.edgePower);
  // Room toward the edge rule: a book open near its start still has few leaves on the left, and the reverse.
  const room = Math.max(0, t.edge - (side > 0 ? reading : 1 - reading));
  return -side * (1 - n) * (1 - edge) * t.max + side * edge * room;
}

export interface PushState {
  /** The shift in effect. */
  value: number;
  /** Side the pointer was on last: -1 left, 1 right, 0 before the first step. */
  side: -1 | 0 | 1;
  /** The shift at the moment the pointer last crossed the middle, and the seconds since. */
  from: number;
  age: number;
}

export const createPush = (): PushState => ({ value: 0, side: 0, from: 0, age: Infinity });

/** Moves the shift toward the pointer's goal and returns it. `hold` keeps the goal where the shift is, for a page in the hand. */
export function stepPush(s: PushState, x: number, reading: number, dt: number, t: PushTuning = PUSH_DEFAULT, hold = false): number {
  const side = x < 0 ? -1 : 1;
  if (side !== s.side && s.side !== 0) {
    s.from = s.value;
    s.age = 0;
  }
  s.side = side;
  let goal = pushGoal(x, reading, t);
  if (s.age < t.swap) goal = s.from + (goal - s.from) * smoothstep(0, 1, s.age / t.swap);
  s.age += dt;
  if (hold) goal = s.value;
  s.value += (goal - s.value) * (1 - Math.exp(-t.rate * Math.min(dt, 0.05)));
  if (Math.abs(s.value) < 1e-4 && goal === 0) s.value = 0;
  return s.value;
}

/** The reading place the case answers to: the true one plus the shift, kept inside the book. */
export const pushedReading = (reading: number, push: number): number => clamp(reading + push, 0, 1);
