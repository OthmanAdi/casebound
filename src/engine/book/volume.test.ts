import { MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { makeDims } from './dims';
import { Volume } from './volume';

const DEG = Math.PI / 180;
const OPEN = 94 * DEG;

const volume = (): Volume => {
  const m = new MeshBasicMaterial();
  return new Volume(makeDims({ pages: 360, thickness: 2.7 }), { cover: m, endpaper: m, pageLeft: m, pageRight: m, edge: m });
};

/** The pose of a book open at reading place `r` whose pages have parted by `p`. */
const pose = (r: number, p: number): { front: number; back: number; split: number; turn: number } => ({ front: OPEN * (2 - 2 * r * p), back: OPEN * 2 * r * p, split: r, turn: p });

describe('page stacks while a book opens', () => {
  it('stand together along the closed book before the pages part', () => {
    const v = volume();
    const p = pose(0.5, 0);
    expect(v.layerShape(0, 1, p).heading).toBeCloseTo(Math.PI / 2, 9);
    expect(v.layerShape(1, 1, p).heading).toBeCloseTo(Math.PI / 2, 9);
  });

  it('swing out by their final angle times the square of the page progress', () => {
    // Read in the reference's page block code and seen in its frames.
    const v = volume();
    for (const r of [0.3, 0.5, 0.7]) {
      for (const p of [0.25, 0.5, 0.8]) {
        const at = pose(r, p);
        expect(v.layerShape(0, 1, at).heading - Math.PI / 2).toBeCloseTo(2 * OPEN * (1 - r) * p * p, 9);
        expect(Math.PI / 2 - v.layerShape(1, 1, at).heading).toBeCloseTo(2 * OPEN * r * p * p, 9);
      }
    }
  });

  it('trail their boards on the way: the back stack is off its board, the wad behind the front one', () => {
    const v = volume();
    const at = pose(0.5, 0.5);
    const right = Math.PI / 2 - v.layerShape(1, 1, at).heading;
    const left = v.layerShape(0, 1, at).heading - Math.PI / 2;
    // A quarter of its final angle above the back board, half way through.
    expect(at.back - right).toBeCloseTo(OPEN * 0.25, 9);
    expect(left).toBeLessThan(at.front);
  });

  it('lie on their boards once the pages have parted', () => {
    const v = volume();
    for (const r of [0.2, 0.5, 0.9]) {
      const at = pose(r, 1);
      expect(v.layerShape(0, 1, at).heading).toBeCloseTo(Math.PI / 2 + at.front, 9);
      expect(v.layerShape(1, 1, at).heading).toBeCloseTo(Math.PI / 2 - at.back, 9);
    }
  });

  it('meet at one point on the spine whatever the split, so no gap opens between them', () => {
    const v = volume();
    for (const r of [0.1, 0.5, 0.8]) {
      const at = pose(r, 0.6);
      expect(v.layerShape(0, 1, at).x).toBeCloseTo(v.layerShape(1, 1, at).x, 9);
    }
  });

  it('give a thick stack a belly and a thin one almost none', () => {
    const v = volume();
    const thick = v.layerShape(1, 1, pose(0.1, 1)).arch!;
    const thin = v.layerShape(0, 1, pose(0.01, 1)).arch!;
    expect(thick).toBeGreaterThan(0.8);
    expect(thin).toBeLessThan(0.1);
    expect(v.layerShape(1, 0, pose(0.5, 1)).arch!).toBeCloseTo(0, 9);
  });
});
