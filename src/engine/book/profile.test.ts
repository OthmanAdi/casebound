import { describe, expect, it } from 'vitest';
import { PROFILE_STRIDE, bellyAt, bellySlope, headingAt, sampleDistance, sampleIndex, sampleLeaf, sineIntegral, turnLengthForHeight, turnLengthForOffset } from './profile';

const sample = (shape: Parameters<typeof sampleLeaf>[0], n = 32): Float32Array => {
  const out = new Float32Array((n + 1) * PROFILE_STRIDE);
  sampleLeaf(shape, n, out);
  return out;
};
const end = (a: Float32Array): { x: number; z: number } => ({ x: a[a.length - 4]!, z: a[a.length - 3]! });

describe('sampleLeaf', () => {
  it('stands straight up when the heading is upright (closed book)', () => {
    const p = end(sample({ x: 0.4, z: 0.1, heading: Math.PI / 2, turnLength: 1, length: 12 }));
    expect(p.x).toBeCloseTo(0.4, 5);
    expect(p.z).toBeCloseTo(12.1, 4);
  });

  it('lies flat on the board with a sharp fold', () => {
    const p = end(sample({ x: 1, z: 0, heading: 0, turnLength: 0, length: 10 }));
    expect(p.x).toBeCloseTo(11, 3);
    expect(p.z).toBeCloseTo(0, 3);
  });

  it('settles at the predicted height above the board when it turns over a distance', () => {
    const height = 0.9;
    const p = end(sample({ x: 0, z: 0, heading: 0, turnLength: turnLengthForHeight(height), length: 12 }, 64));
    expect(p.z).toBeCloseTo(height, 1);
  });

  it('is carried sideways by the predicted amount for any turn, also folded back past flat', () => {
    for (const heading of [0.2, Math.PI / 2 - 1.2, Math.PI, Math.PI / 2 + 3.0, Math.PI / 2 - 3.0]) {
      const offset = 0.6;
      const turn = heading - Math.PI / 2;
      const p = end(sample({ x: 0, z: 0, heading, turnLength: turnLengthForOffset(offset, turn), length: 14 }, 96));
      // Distance of the far end from the line a sharply folded leaf would lie on, toward the side it turned away from.
      const side = turn > 0 ? -1 : 1;
      const across = side * (-Math.sin(heading) * p.x + Math.cos(heading) * p.z);
      expect(across).toBeCloseTo(offset, 2);
    }
  });

  it('knows the sine integral', () => {
    expect(sineIntegral(0)).toBe(0);
    expect(sineIntegral(Math.PI / 2)).toBeCloseTo(1.370762, 5);
    expect(sineIntegral(Math.PI)).toBeCloseTo(1.851937, 5);
    expect(sineIntegral(-1)).toBeCloseTo(-0.946083, 5);
  });

  it('finds the sample at a distance along the leaf, and stays on the leaf beyond its ends', () => {
    for (const i of [0, 1, 7, 31, 56]) expect(sampleIndex(12.8, 56, sampleDistance(12.8, 56, i))).toBeCloseTo(i, 6);
    const between = sampleIndex(12.8, 56, (sampleDistance(12.8, 56, 20) + sampleDistance(12.8, 56, 21)) / 2);
    expect(between).toBeGreaterThan(20);
    expect(between).toBeLessThan(21);
    expect(sampleIndex(12.8, 56, -1)).toBe(0);
    expect(sampleIndex(12.8, 56, 99)).toBe(56);
  });

  it('lets only the outer half of the leaf fall over', () => {
    const shape = { x: 0, z: 0, heading: Math.PI / 2, turnLength: 0.5, length: 10 };
    for (const s of [0, 2, 5]) expect(headingAt({ ...shape, flop: 1.6 }, s)).toBeCloseTo(headingAt(shape, s), 9);
    expect(headingAt({ ...shape, flop: 1.6 }, 7.5) - headingAt(shape, 7.5)).toBeCloseTo(0.8, 9);
    expect(headingAt({ ...shape, flop: 1.6 }, 10) - headingAt(shape, 10)).toBeCloseTo(1.6, 9);
    expect(headingAt({ ...shape, flop: -1.6 }, 10) - headingAt(shape, 10)).toBeCloseTo(-1.6, 9);
  });

  it('mirrors left and right', () => {
    const r = end(sample({ x: 0.2, z: 0, heading: 0.3, turnLength: 0.6, length: 9 }));
    const l = end(sample({ x: -0.2, z: 0, heading: Math.PI - 0.3, turnLength: 0.6, length: 9 }));
    expect(l.x).toBeCloseTo(-r.x, 4);
    expect(l.z).toBeCloseTo(r.z, 4);
  });

  it('keeps the leaf length whatever the shape (paper does not stretch)', () => {
    const a = sample({ x: 0, z: 0, heading: 2.4, turnLength: 0.8, length: 10, bow: 0.5, tip: -0.4 }, 96);
    let len = 0;
    for (let i = 1; i <= 96; i++) {
      const dx = a[i * 4]! - a[(i - 1) * 4]!;
      const dz = a[i * 4 + 1]! - a[(i - 1) * 4 + 1]!;
      len += Math.hypot(dx, dz);
    }
    expect(len).toBeGreaterThan(9.9);
    expect(len).toBeLessThanOrEqual(10.001);
  });
});

describe('the belly of a lying leaf', () => {
  const flat = { x: 0, z: 0, heading: 0, turnLength: 0.4, length: 13 };

  it('is highest a third of the way out and flat at both ends', () => {
    expect(bellyAt(1 / 3)).toBeCloseTo(1, 9);
    expect(bellyAt(0)).toBe(0);
    expect(bellyAt(1)).toBe(0);
    expect(bellySlope(1 / 3)).toBeCloseTo(0, 9);
    expect(bellySlope(1e-9)).toBeLessThan(1e-3);
    expect(bellySlope(1 - 1e-9)).toBeCloseTo(0, 9);
    for (const u of [0.1, 0.5, 0.8]) expect((bellyAt(u + 1e-5) - bellyAt(u - 1e-5)) / 2e-5).toBeCloseTo(bellySlope(u), 4);
  });

  it('leaves the binding and the fore-edge where they are', () => {
    const a = sample(flat, 56);
    const b = sample({ ...flat, arch: 1.2 }, 56);
    for (const i of [0, 56]) {
      expect(b[i * PROFILE_STRIDE]!).toBeCloseTo(a[i * PROFILE_STRIDE]!, 6);
      expect(b[i * PROFILE_STRIDE + 1]!).toBeCloseTo(a[i * PROFILE_STRIDE + 1]!, 6);
    }
  });

  it('lifts a page toward its reader on either side, and a standing leaf not at all', () => {
    const at = (shape: typeof flat & { arch?: number }, i: number): [number, number] => {
      const p = sample(shape, 56);
      return [p[i * PROFILE_STRIDE]!, p[i * PROFILE_STRIDE + 1]!];
    };
    // Sample 30 of 56 is close to a third of the way along.
    const right = at({ ...flat, arch: 1 }, 30)[1] - at(flat, 30)[1];
    const leftShape = { ...flat, heading: Math.PI };
    const left = at({ ...leftShape, arch: 1 }, 30)[1] - at(leftShape, 30)[1];
    expect(right).toBeGreaterThan(0.9);
    expect(left).toBeGreaterThan(0.9);
    const up = { ...flat, heading: Math.PI / 2 };
    expect(at({ ...up, arch: 1 }, 30)[0]).toBeCloseTo(at(up, 30)[0], 9);
  });

  it('keeps tangents of unit length', () => {
    const p = sample({ ...flat, arch: 1.4 }, 56);
    for (let i = 0; i <= 56; i++) expect(Math.hypot(p[i * PROFILE_STRIDE + 2]!, p[i * PROFILE_STRIDE + 3]!)).toBeCloseTo(1, 6);
  });
});
