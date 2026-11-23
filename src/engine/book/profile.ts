/**
 * Cross-section of a leaf of paper bound at the spine.
 *
 * The book is described in the "open-book frame": X runs across the spread, Y up the page, Z out of the page
 * toward the reader. A leaf starts at its binding point on the spine heading straight up (+Z) and turns toward
 * its resting direction over a short distance. One function describes every sheet in the book: the layers of
 * the two page blocks, and the single leaves that turn.
 *
 * Headings are angles measured from +X toward +Z, in radians:
 *   0 = lying to the right, pi/2 = standing up, pi = lying to the left.
 */

/** Values stored per sample: x, z, tangent x, tangent z. */
export const PROFILE_STRIDE = 4;

/** How densely samples crowd toward the binding, where the curvature is. */
const CROWD = 1.7;
const SUBSTEPS = 4;

export interface LeafShape {
  /** Binding point on the spine. */
  x: number;
  z: number;
  /** Heading the leaf settles into away from the spine. */
  heading: number;
  /** Distance over which the leaf turns from upright to its heading. 0 = a sharp fold at the binding. */
  turnLength: number;
  /** Length of the leaf from binding to fore-edge. */
  length: number;
  /** Extra arc along the leaf, radians at mid-length. Positive bows toward larger headings. */
  bow?: number;
  /** Curl at the free edge, radians. */
  tip?: number;
}

export function headingAt(shape: LeafShape, s: number): number {
  const up = Math.PI / 2;
  const settle = shape.turnLength <= 1e-5 ? (s > 0 ? 1 : 0) : 1 - Math.exp(-s / shape.turnLength);
  const u = shape.length > 0 ? s / shape.length : 0;
  const bow = shape.bow ? shape.bow * Math.sin(Math.PI * u) : 0;
  const tip = shape.tip ? shape.tip * u * u * u : 0;
  return up + (shape.heading - up) * settle + bow + tip;
}

/**
 * Writes `count + 1` samples into `out` (stride 4). Samples are equally spaced in a warped parameter so there
 * are more of them near the binding.
 */
export function sampleLeaf(shape: LeafShape, count: number, out: Float32Array): void {
  let x = shape.x;
  let z = shape.z;
  let s = 0;
  for (let i = 0; i <= count; i++) {
    const target = shape.length * Math.pow(i / count, CROWD);
    const step = (target - s) / SUBSTEPS;
    for (let k = 0; k < SUBSTEPS && step > 0; k++) {
      const a = headingAt(shape, s + step / 2);
      x += Math.cos(a) * step;
      z += Math.sin(a) * step;
      s += step;
    }
    const a = headingAt(shape, s);
    const o = i * PROFILE_STRIDE;
    out[o] = x;
    out[o + 1] = z;
    out[o + 2] = Math.cos(a);
    out[o + 3] = Math.sin(a);
  }
}

/** Arc-length position of sample i, matching `sampleLeaf`. */
export const sampleDistance = (length: number, count: number, i: number): number => length * Math.pow(i / count, CROWD);

/**
 * For a leaf lying flat on a stack, the height it gains while turning is turnLength x Si(pi/2).
 * This is the inverse: the turn length that puts a layer at the given height.
 */
export const turnLengthForHeight = (height: number): number => height / 1.3708;

/** The sine integral Si(x), by its power series. Accurate to 1e-9 up to x = 4. */
export function sineIntegral(x: number): number {
  let term = x;
  let sum = x;
  for (let k = 1; k < 16; k++) {
    term *= (-x * x) / ((2 * k) * (2 * k + 1));
    sum += term / (2 * k + 1);
  }
  return sum;
}

/**
 * While a leaf turns from upright through `turn` radians it is carried sideways, toward the side it turns
 * away from, by turnLength x Si(turn). This is the inverse: the turn length that carries it `offset`.
 * For a quarter turn it equals `turnLengthForHeight`.
 */
export const turnLengthForOffset = (offset: number, turn: number): number => Math.max(0, offset) / Math.max(sineIntegral(Math.abs(turn)), 0.05);
