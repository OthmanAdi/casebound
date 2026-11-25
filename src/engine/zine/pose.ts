/**
 * Where a zine is while it is not being read: on its way in from the right, lying closed over the picture, or on
 * its way out (SPEC S-ZINE-3). Pure arithmetic; `zine.ts` applies it.
 *
 * Measured on a zine of the reference at 1440 x 900 with a virtual clock: of the way that is left it has 0.80,
 * 0.64, 0.51, 0.40 a frame after it is first seen; half the way takes 67 ms, 90 % takes 167 ms, 99 % takes
 * 383 ms. That is a presence p that closes 0.12 of its remaining way a frame, and a distance of 45 (1 - p) squared.
 */
import { DEG, clamp, frameFactor, lerp } from '../core/math';

export interface ZinePoseTune {
  /** How far to the right it starts, world units. */
  flyFrom: number;
  /** Share of the remaining way its presence closes in a frame of 1/60 s. */
  flyRate: number;
  /** It is drawn from this presence on. */
  shown: number;
  /** Pitch, yaw and roll of the closed zine at rest, degrees. */
  liePitch: number;
  lieYaw: number;
  lieRoll: number;
}

/**
 * The resting turn is fitted to the outline of the closed zine in a still: its left edge leans 7 degrees to the
 * left, its right edge is a tenth shorter than its left, and its top edge falls 6 degrees toward the right. With
 * these three angles the four corners of ours lie 10 px from the still's on average, at 1440 x 900.
 */
export const ZINE_POSE: ZinePoseTune = { flyFrom: 45, flyRate: 0.12, shown: 0.02, liePitch: -21, lieYaw: 33, lieRoll: 11 };

/** One step of the presence toward 1 (coming) or 0 (going). It arrives: the last thousandth is not waited for. */
export function stepPresence(p: number, coming: boolean, dt: number, tune: ZinePoseTune = ZINE_POSE): number {
  const goal = coming ? 1 : 0;
  const next = p + (goal - p) * frameFactor(tune.flyRate, dt);
  return Math.abs(goal - next) < 1e-3 ? goal : next;
}

/** How far right of its place the zine is at presence p. */
export function flyOffset(p: number, tune: ZinePoseTune = ZINE_POSE): number {
  const rest = 1 - clamp(p, 0, 1);
  return tune.flyFrom * rest * rest;
}

/**
 * Its turn at presence p, radians: it comes in lying on its back and tips up to its resting pitch on the same
 * curve as the way; yaw and roll come with the presence itself.
 */
export function flyTurn(p: number, tune: ZinePoseTune = ZINE_POSE): { pitch: number; yaw: number; roll: number } {
  const q = clamp(p, 0, 1);
  const way = 1 - (1 - q) * (1 - q);
  return { pitch: lerp(-90, tune.liePitch, way) * DEG, yaw: tune.lieYaw * q * DEG, roll: tune.lieRoll * q * DEG };
}

/**
 * The number in the bar: the sides turned so far. 1 while it lies closed; the reader's spread k (0 = the cover
 * turned) shows 2 k + 2. Measured: 1, 2, 4, 6 and so on, one number, not two.
 */
export const zineNumber = (spread: number | null): number => (spread === null ? 1 : 2 * Math.max(0, Math.round(spread)) + 2);

/** The reader's page for a number of the bar or of the address. Null: closed. */
export function zinePage(n: number, leaves: number): number | null {
  if (!Number.isFinite(n) || n < 2) return null;
  return clamp(Math.round(n / 2) - 1, 0, leaves) * 2;
}
