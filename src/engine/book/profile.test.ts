import { describe, expect, it } from 'vitest';
import { PROFILE_STRIDE, sampleLeaf, turnLengthForHeight } from './profile';

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
