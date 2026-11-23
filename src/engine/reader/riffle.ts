/**
 * The opening riffle. While the pages part to the reading place, a few leaves on top of each stack are live:
 * they stand along the direction of the closed block, which rises off the back board as the book falls open,
 * and settle onto their stacks one after another, the lowest of each stack first (SPEC S-RD-1, S-RD-6).
 *
 * This module holds the pure parts: who takes part, and where each leaf is at a given moment.
 */
import { clamp, lerp, smoothstep } from '../core/math';

export interface RiffleTuning {
  /** Live leaves on each side. 0 turns the riffle off. */
  leaves: number;
  /** Page progress at which the leaves start to settle. */
  start: number;
  /** Seconds between one leaf starting to settle and the next one above it. */
  stagger: number;
  /** Seconds one leaf takes to settle. */
  seconds: number;
  /** Page progress at which the leaves start to go limp. */
  dropStart: number;
  /** Seconds before the first leaf goes limp, between one leaf and the next, and for one leaf to go limp. */
  dropDelay: number;
  dropStagger: number;
  dropSeconds: number;
  /** How far the waiting leaves fan out around the block direction, as a share of its rise. */
  fan: number;
}

/** Measured on the reference: 90 ms apart and 420 ms each from page progress 0.25, limp 50 ms apart over 400 ms from 0.2. */
export const RIFFLE_DEFAULT: RiffleTuning = {
  leaves: 3,
  start: 0.25,
  stagger: 0.09,
  seconds: 0.42,
  dropStart: 0.2,
  dropDelay: 0.05,
  dropStagger: 0.05,
  dropSeconds: 0.4,
  fan: 0.25,
};

/** The most leaves a side can have. */
export const RIFFLE_MAX = 4;

export interface RifflePart {
  /** Index of the leaf in the book. */
  index: number;
  /** The stack it settles on: 0 = right, 1 = left. */
  side: 0 | 1;
  /** Its turn to settle, counted from the bottom of its stack. */
  rank: number;
  /** Its turn to go limp: the lowest leaf of the right stack first, the lowest of the left stack last. */
  order: number;
  /** Its place in the fan of waiting leaves: 1 = furthest toward the left, -1 = furthest toward the right. */
  lean: number;
}

/**
 * The leaves that take part, from the lowest of the left stack to the lowest of the right one. `spread` leaves
 * lie on the left when the book is open, out of `total`.
 */
export function riffleCast(spread: number, total: number, perSide: number): RifflePart[] {
  const k = clamp(Math.floor(perSide), 0, RIFFLE_MAX);
  const first = Math.max(0, spread - k);
  const last = Math.min(total, spread + k) - 1;
  const count = last - first + 1;
  const parts: RifflePart[] = [];
  for (let index = first; index <= last; index++) {
    const side: 0 | 1 = index < spread ? 1 : 0;
    parts.push({
      index,
      side,
      rank: side === 1 ? index - first : last - index,
      order: last - index,
      lean: count > 1 ? 1 - (2 * (index - first)) / (count - 1) : 0,
    });
  }
  return parts;
}

/** How far a leaf has settled onto its stack, 0..1, `elapsed` seconds after the first one started. */
export const riffleReveal = (elapsed: number, rank: number, t: RiffleTuning = RIFFLE_DEFAULT): number =>
  t.seconds <= 0 ? (elapsed >= rank * t.stagger ? 1 : 0) : smoothstep(0, 1, (elapsed - rank * t.stagger) / t.seconds);

/** How limp a leaf is, 0 (stiff) to 1, `elapsed` seconds after the first one started to give. */
export const riffleDrop = (elapsed: number, order: number, t: RiffleTuning = RIFFLE_DEFAULT): number =>
  t.dropSeconds <= 0 ? (elapsed >= t.dropDelay + order * t.dropStagger ? 1 : 0) : smoothstep(0, 1, (elapsed - t.dropDelay - order * t.dropStagger) / t.dropSeconds);

/**
 * Turn of a leaf, 0 = lying right to 1 = lying left. `block` is the turn of the block direction: the share of
 * the leaves that lie on the left so far. A waiting leaf stands there, fanned out a little; settling takes it
 * to its side.
 */
export const riffleTurn = (block: number, part: RifflePart, reveal: number, fan = RIFFLE_DEFAULT.fan): number =>
  lerp(clamp(block * (1 + fan * part.lean), 0, 1), part.side, reveal);

/** Seconds from the first leaf starting to settle until the last one is down. */
export const riffleSeconds = (parts: readonly RifflePart[], t: RiffleTuning = RIFFLE_DEFAULT): number =>
  parts.length ? Math.max(...parts.map((p) => p.rank)) * t.stagger + t.seconds : 0;
