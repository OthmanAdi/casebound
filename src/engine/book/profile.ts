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
  /** How far the outer half of the leaf falls over, radians at the free edge. Positive toward larger headings. */
  flop?: number;
  /**
   * Height of the belly of a leaf that lies down, in world units. The pages of a thick book do not lie flat: they
   * rise out of the gutter, are highest a third of the way out and come down to the fore-edge. Both ends of the
   * leaf stay where they are. A leaf that stands has none: the belly fades with the cosine of the heading.
   */
  arch?: number;
}

/** Peak of u^1.5 (1 - u)^3, at u = 1/3. */
const BELLY_PEAK = Math.pow(1 / 3, 1.5) * Math.pow(2 / 3, 3);

/** Shape of the belly along the leaf: 0 at the gutter and at the fore-edge, 1 a third of the way out, flat at both ends. */
export const bellyAt = (u: number): number => (u <= 0 || u >= 1 ? 0 : (Math.pow(u, 1.5) * Math.pow(1 - u, 3)) / BELLY_PEAK);

/** Slope of `bellyAt`. */
export const bellySlope = (u: number): number => (u <= 0 || u >= 1 ? 0 : (Math.sqrt(u) * (1 - u) * (1 - u) * (1.5 - 4.5 * u)) / BELLY_PEAK);

export function headingAt(shape: LeafShape, s: number): number {
  const up = Math.PI / 2;
  const settle = shape.turnLength <= 1e-5 ? (s > 0 ? 1 : 0) : 1 - Math.exp(-s / shape.turnLength);
  const u = shape.length > 0 ? s / shape.length : 0;
  const bow = shape.bow ? shape.bow * Math.sin(Math.PI * u) : 0;
  const tip = shape.tip ? shape.tip * u * u * u : 0;
  // The inner half stays as it is; the outer half eases over.
  const outer = Math.min(Math.max(u * 2 - 1, 0), 1);
  const flop = shape.flop ? shape.flop * outer * outer * (3 - 2 * outer) : 0;
  return up + (shape.heading - up) * settle + bow + tip + flop;
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
    let tx = Math.cos(a);
    let tz = Math.sin(a);
    out[o] = x;
    out[o + 1] = z;
    if (shape.arch && shape.length > 0) {
      // The belly lifts the leaf off its own line, toward the side it shows: its ends do not move.
      const u = s / shape.length;
      const lift = shape.arch * Math.cos(shape.heading);
      const h = lift * bellyAt(u);
      const slope = (lift * bellySlope(u)) / shape.length;
      out[o] = x - tz * h;
      out[o + 1] = z + tx * h;
      const nx = tx - tz * slope;
      const nz = tz + tx * slope;
      const len = Math.hypot(nx, nz) || 1;
      tx = nx / len;
      tz = nz / len;
    }
    out[o + 2] = tx;
    out[o + 3] = tz;
  }
}

/** Arc-length position of sample i, matching `sampleLeaf`. */
export const sampleDistance = (length: number, count: number, i: number): number => length * Math.pow(i / count, CROWD);

/** The inverse of `sampleDistance`: the sample index, with its fraction, at an arc-length position. */
export const sampleIndex = (length: number, count: number, s: number): number => count * Math.pow(Math.min(Math.max(s / length, 0), 1), 1 / CROWD);

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
