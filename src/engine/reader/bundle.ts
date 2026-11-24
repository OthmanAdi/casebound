/**
 * A bundle of leaves turned as one block (SPEC S-RD-12). The fore-edge of a page stack takes every leaf from the
 * top of the stack down to the place under the pointer. There are two ways a block turns.
 *
 * By hand: under a resting pointer the block lifts off its stack, foot of the page first, and waits. A press let
 * go, or a flick, sends it over quickly: fast at first, slower as it comes down. A pointer that leaves lets it
 * sink back.
 *
 * By itself (`reader.turnLeaves`): a short hold, then a cosine ease whose length grows with the logarithm of the
 * leaves in the block.
 */
import { clamp } from '../core/math';

export interface BundleTuning {
  /** Fewest leaves that turn as a block. Below it a press on the fore-edge turns one leaf like any other press. */
  min: number;
  /** Seconds the block waits after the hand lets go, lifting, before it starts to turn. */
  hold: number;
  /** Seconds the turn of the smallest block takes. */
  base: number;
  /** Seconds added for every doubling of the leaves in the block. */
  perDoubling: number;
  /** The longest a turn takes, seconds. */
  longest: number;
  /** How far the block lifts off the stack it lies on, radians. */
  lift: number;
  /** Seconds for the lift to build up. */
  liftSeconds: number;
  /** Share of the turn from which the lift goes again, so the block comes down flat. */
  liftFade: number;
  /** The foot of the page leads the lift by this share and the head trails by it: the block twists as it rises. */
  twist: number;
  /** How far the block bows against the air, as a share of the bow of a single sheet. */
  bow: number;
  /** How far a block lifts under the pointer or in a hand, radians. 0: no block lifts under a resting pointer. */
  handLift: number;
  /** How fast that lift builds up, and how fast it goes, 1/s. */
  liftRate: number;
  dropRate: number;
  /** A block let go by hand covers this share of the way that is left per second, */
  turnRate: number;
  /** and never less than this share of the whole turn per second. */
  turnLeast: number;
  /** Pointer speed, px per ms, above which a held block is sent over without waiting for the hand to let go. */
  flick: number;
  /** Seconds a lifted block waits for a pointer that has left its edge before it sinks back. */
  leave: number;
}

export const BUNDLE_DEFAULT: BundleTuning = {
  min: 2,
  hold: 0.12,
  base: 0.7,
  perDoubling: 0.045,
  longest: 1.1,
  lift: (7 * Math.PI) / 180,
  liftSeconds: 0.15,
  liftFade: 0.8,
  twist: 0.6,
  bow: 0.25,
  handLift: (16 * Math.PI) / 180,
  liftRate: 12,
  dropRate: 10,
  turnRate: 7,
  turnLeast: 0.9,
  flick: 0.7,
  leave: 0.09,
};

/** Seconds a block of `leaves` takes to turn over. */
export const bundleSeconds = (leaves: number, t: BundleTuning = BUNDLE_DEFAULT): number =>
  clamp(t.base + t.perDoubling * Math.log2(Math.max(1, leaves)), t.base, t.longest);

/** How far a block of `leaves` has turned, 0 to 1, `elapsed` seconds after it was let go. */
export const bundleTurn = (elapsed: number, leaves: number, t: BundleTuning = BUNDLE_DEFAULT): number => {
  const k = clamp((elapsed - t.hold) / bundleSeconds(leaves, t), 0, 1);
  return 0.5 - 0.5 * Math.cos(Math.PI * k);
};

/** How much of its lift the block has, 0 to 1: it builds up from the moment of letting go and is gone at the landing. */
export const bundleLift = (elapsed: number, turn: number, t: BundleTuning = BUNDLE_DEFAULT): number =>
  clamp(elapsed / Math.max(1e-3, t.liftSeconds), 0, 1) * (1 - clamp((turn - t.liftFade) / Math.max(1e-3, 1 - t.liftFade), 0, 1));

/**
 * The leaves a press on a fore-edge takes. `depth` says where on the edge the press is, 0 at the board and 1 at
 * the top of the stack, and `here` how many leaves lie on that stack. The leaf under the press comes along.
 * Returns 0 when that is fewer than a block.
 */
export const bundleCount = (depth: number, here: number, t: BundleTuning = BUNDLE_DEFAULT): number => {
  const count = Math.min(here, Math.round((1 - clamp(depth, 0, 1)) * here) + 1);
  return count >= Math.max(2, t.min) ? count : 0;
};

/**
 * Where a block in a hand stands, 0 to 1, for its raw progress. Read in the reference: it stays down for the
 * first 0.03 and is down again from 0.9, with a smoothstep between.
 */
export const bundleShown = (progress: number): number => {
  const t = clamp((progress - 0.03) / 0.87, 0, 1);
  return t * t * (3 - 2 * t);
};

/** One frame of a block let go by hand, on its way to `goal`: over (1) or back onto its stack (0). Returns its new progress. */
export const stepRelease = (progress: number, goal: 0 | 1, dt: number, t: BundleTuning = BUNDLE_DEFAULT): number => {
  const left = goal - progress;
  const step = Math.max(Math.abs(left) * (1 - Math.exp(-t.turnRate * dt)), t.turnLeast * dt);
  return Math.abs(left) <= step ? goal : progress + Math.sign(left) * step;
};

/** The lift a block let go by hand is heading for, 0 to 1: gone by the time it comes down, and gone at once on the way back. */
export const releaseLift = (progress: number, goal: 0 | 1): number => (goal === 1 ? 1 - clamp((progress - 0.55) / 0.4, 0, 1) : 0);

/**
 * The leaves in a block, counted again from a place on the fore-edge of the block itself. `within` says where on
 * its edge the pointer is, 0 at the leaf that lies lowest and 1 at the top one, for a block of `leaves`.
 */
export const bundleRecount = (within: number, leaves: number): number => Math.min(leaves, Math.round((1 - clamp(within, 0, 1)) * leaves) + 1);
