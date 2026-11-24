import { describe, expect, it } from 'vitest';
import { PEN_SHAPE, penMeshes, type PartMesh } from './pen-shape';

const bounds = (m: PartMesh): { min: number[]; max: number[] } => {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.position.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, m.position[i + k]!);
      max[k] = Math.max(max[k]!, m.position[i + k]!);
    }
  }
  return { min, max };
};

describe('the shape of the pen', () => {
  const pen = penMeshes();

  it('is 5.62 from the edge of the nib to the rim of the cap and 5.84 with its dome', () => {
    expect(pen.length).toBe(5.62);
    expect(pen.total).toBeCloseTo(5.84, 2);
    expect(pen.pivot).toBeCloseTo(0.1375, 6);
    expect(bounds(pen.nib).min[1]).toBeCloseTo(-pen.pivot, 6);
    expect(bounds(pen.dome).max[1]).toBeCloseTo(pen.total - pen.pivot, 6);
    expect(bounds(pen.body).max[1]).toBeCloseTo(5.62 - pen.pivot, 6);
  });

  it('has a cap one twelfth wider than the barrel and a barrel 1/8.3 of its length across', () => {
    const body = bounds(pen.body);
    expect(body.max[0]).toBeCloseTo(PEN_SHAPE.cap, 6);
    expect(PEN_SHAPE.cap / PEN_SHAPE.barrel).toBeCloseTo(1.08, 6);
    expect(pen.length / (2 * PEN_SHAPE.barrel)).toBeCloseTo(8.26, 2);
  });

  it('has a chisel for a nib: eight corners, the front edge lowest, the back edge 0.275 higher', () => {
    expect(pen.corners.length).toBe(24);
    const ys = pen.corners.filter((_, i) => i % 3 === 1);
    expect(Math.min(...ys)).toBeCloseTo(-pen.pivot, 6);
    const low = [0, 1, 2, 3].map((k) => ({ y: pen.corners[k * 3 + 1]!, z: pen.corners[k * 3 + 2]! }));
    expect(low.filter((c) => c.z > 0).every((c) => Math.abs(c.y + pen.pivot) < 1e-9)).toBe(true);
    expect(low.filter((c) => c.z < 0).every((c) => Math.abs(c.y - (0.275 - pen.pivot)) < 1e-9)).toBe(true);
    // The pivot lies half way up that slanted face.
    expect((low[0]!.y + low[2]!.y) / 2).toBeCloseTo(0, 9);
  });

  it('gives every part unit normals that point away from the axis or along it', () => {
    for (const part of [pen.nib, pen.collar, pen.body, pen.dome]) {
      expect(part.position.length).toBe(part.normal.length);
      expect(part.index.length % 3).toBe(0);
      expect(Math.max(...part.index)).toBeLessThan(part.position.length / 3);
      for (let i = 0; i < part.normal.length; i += 3) {
        expect(Math.hypot(part.normal[i]!, part.normal[i + 1]!, part.normal[i + 2]!)).toBeCloseTo(1, 6);
      }
    }
    // On the barrel a normal points the way its point lies from the axis.
    const b = pen.body;
    for (let i = 0; i < b.position.length; i += 3) {
      if (Math.abs(b.normal[i + 1]!) > 1e-6) continue;
      expect(b.position[i]! * b.normal[i]! + b.position[i + 2]! * b.normal[i + 2]!).toBeGreaterThan(0);
    }
  });

  it('winds its faces so that they face outward', () => {
    for (const part of [pen.nib, pen.body, pen.dome]) {
      const p = part.position;
      const n = part.normal;
      let facing = 0;
      let all = 0;
      for (let t = 0; t < part.index.length; t += 3) {
        const [a, b, c] = [part.index[t]! * 3, part.index[t + 1]! * 3, part.index[t + 2]! * 3];
        const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
        const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
        const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
        if (Math.hypot(fx, fy, fz) < 1e-9) continue;
        all++;
        if (fx * n[a]! + fy * n[a + 1]! + fz * n[a + 2]! > 0) facing++;
      }
      expect(facing).toBe(all);
    }
  });
});
