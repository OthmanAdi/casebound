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
 * turned) shows 2 k + 2, the folio printed on its left page (`PAMPHLET_FOLIO_SHIFT`). Measured: 1, 2, 4, 6 and so on,
 * one number, not two; read in the reference: twice the leaves turned, the cover counted as a leaf.
 */
export const zineNumber = (spread: number | null): number => (spread === null ? 1 : 2 * Math.max(0, Math.round(spread)) + 2);

/** The number of a zine closed onto its back: every side, the four of its cover counted. */
export const zineLast = (leaves: number): number => 2 * (leaves + 2);

/** Leaves turned for a number of the bar or of the address, the covers counted. Read in the reference: half of it, rounded down. */
export const zineTurned = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.floor(n / 2)) : 0);

/** The reader's page for a number of the bar or of the address. Null: closed. */
export function zinePage(n: number, leaves: number): number | null {
  const turned = zineTurned(n);
  if (turned < 1) return null;
  return clamp(turned - 1, 0, leaves) * 2;
}

/** True for a number that asks for the zine closed onto its back. */
export const zineOnBack = (n: number, leaves: number): boolean => zineTurned(n) >= leaves + 2;

/**
 * The turn of an open zine about its spine, degrees, positive raising its left side, for `turned` leaves of `of`
 * (both covers counted as leaves). Read in the reference: its group turns about the spine by 99 degrees from the
 * first leaf to the last, and its leaves, lying on their own ground, give most of it back. Measured on the page,
 * the side with fewer leaves lies higher, 13 degrees across the whole booklet, linear in the leaves turned:
 * `lean` at the start, minus `lean` at the end. The pointer adds up to `pointer` toward its side (`toward` -1 to 1).
 */
export function zineLean(turned: number, of: number, lean: number, pointer = 0, toward = 0): number {
  const n = of > 0 ? clamp(turned / of, 0, 1) : 0.5;
  return lean * (1 - 2 * n) + pointer * clamp(toward, -1, 1);
}

/**
 * The paper of a zine, against the book's leaf (`LEAF_DEFAULT`). Fitted with `stepLeaf` to a leaf of the reference's
 * zine turned by key (0.14, 0.25, 0.40, 0.50, 0.67, 0.84, 0.87, 0.94 of its turn after 50, 100, 200, 300, 500, 800,
 * 1000 and 2100 ms; ours within 0.01, rms 0.007): it starts faster and lands as slowly. Its cover is the same paper
 * sent off with the book's starting speed (0.06, 0.21, 0.46, 0.70, 0.81 after 50, 200, 500, 800 and 1000 ms; rms 0.004).
 */
export const ZINE_PAPER = { damping: 0.16, follow: 0.05, kick: 0.2, coverKick: 0.08 };
