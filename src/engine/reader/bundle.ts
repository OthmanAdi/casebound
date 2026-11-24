/**
 * A bundle of leaves turned as one block (SPEC S-RD-12). A press on the fore-edge of a page stack takes every
 * leaf from the top of the stack down to that place. When the hand lets go the block lifts off its stack, foot
 * of the page first, and turns over on a clock: a short hold, then a cosine ease whose length grows with the
 * logarithm of the leaves in it.
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
