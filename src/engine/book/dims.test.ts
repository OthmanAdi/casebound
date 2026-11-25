import { MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { COVER_H, COVER_W, LEAF_THICKNESS, PAMPHLET_COVER, atlasOf, makeDims } from './dims';
import { Volume } from './volume';

describe('the strip a case is painted on', () => {
  it('lays out back, spine and front from left to right with nothing between them', () => {
    const a = atlasOf(makeDims({ pages: 320 }));
    expect(a.back[0]).toBe(0);
    expect(a.back[1]).toBe(a.spine[0]);
    expect(a.spine[1]).toBe(a.front[0]);
    expect(a.front[1]).toBe(1);
  });

  it('gives both boards the same share', () => {
    const a = atlasOf(makeDims({ pages: 320 }));
    expect(a.back[1] - a.back[0]).toBeCloseTo(a.front[1] - a.front[0], 12);
  });

  it('is as long as two boards, two hinges and the spine between them', () => {
    const d = makeDims({ thickness: 2.4 });
    const a = atlasOf(d);
    const spine = d.thickness - d.board - 2 * d.hinge;
    const arc = (d.hinge * Math.PI) / 2;
    const board = d.coverW - d.hinge - d.board / 2;
    expect(a.aspect * d.coverH).toBeCloseTo(spine + 2 * arc + 2 * board, 9);
    expect(a.hinge * a.aspect * d.coverH).toBeCloseTo(arc / 2, 9);
  });

  it('gives a thicker book a wider spine and narrower boards on the strip', () => {
    const thin = atlasOf(makeDims({ thickness: 1.6 }));
    const thick = atlasOf(makeDims({ thickness: 3 }));
    expect(thick.spine[1] - thick.spine[0]).toBeGreaterThan(thin.spine[1] - thin.spine[0]);
    expect(thick.front[1] - thick.front[0]).toBeLessThan(thin.front[1] - thin.front[0]);
    expect(thick.aspect).toBeGreaterThan(thin.aspect);
  });
});

describe('the dimensions of a case', () => {
  it('are a case unless a binding is named', () => {
    const d = makeDims({ pages: 240 });
    expect(d.binding).toBe('case');
    expect(d.board).toBe(0.2);
    expect(d.square).toBeGreaterThan(0);
    expect(d.pageH).toBeLessThan(d.coverH);
  });
});

describe('the dimensions of a pamphlet', () => {
  const d = makeDims({ pages: 16, binding: 'pamphlet' });

  it('have the trim size of every other book', () => {
    expect(d.coverW).toBe(COVER_W);
    expect(d.coverH).toBe(COVER_H);
  });

  it('have a cover of paper that stands out nowhere beyond the pages', () => {
    expect(d.board).toBe(PAMPHLET_COVER);
    expect(d.square).toBe(0);
    expect(d.pageH).toBe(d.coverH);
    expect(d.coverW - d.pageW).toBeLessThan(0.2);
  });

  it('are as thick as their leaves and their cover, and no thicker', () => {
    expect(d.leaves).toBe(8);
    expect(d.thickness).toBeCloseTo(8 * LEAF_THICKNESS + 2 * PAMPHLET_COVER, 10);
    expect(d.blockT).toBeCloseTo(8 * LEAF_THICKNESS, 10);
    expect(d.thickness).toBeLessThan(makeDims({ pages: 16 }).thickness / 4);
  });

  it('have a fold for a spine: the two hinges all but meet', () => {
    const flat = (d.thickness - d.board) / 2 - d.hinge;
    expect(flat).toBeGreaterThan(0);
    expect(flat).toBeLessThan(0.02);
  });

  it('grow with their pages', () => {
    expect(makeDims({ pages: 32, binding: 'pamphlet' }).thickness).toBeGreaterThan(d.thickness);
  });

  it('build a volume like any other book, closed and open', () => {
    const m = new MeshBasicMaterial();
    const volume = new Volume(d, { cover: m, endpaper: m, pageLeft: m, pageRight: m, edge: m });
    for (const pose of [
      { front: 0, back: 0, split: 0.5, turn: 0 },
      { front: Math.PI / 2, back: Math.PI / 2, split: 0.25, turn: 1 },
    ]) {
      volume.setPose(pose);
      for (const mesh of [volume.caseMesh, volume.leftBlock, volume.rightBlock]) {
        const p = mesh.geometry.getAttribute('position');
        let widest = 0;
        for (let i = 0; i < p.count; i++) {
          expect(Number.isFinite(p.getX(i)) && Number.isFinite(p.getY(i)) && Number.isFinite(p.getZ(i))).toBe(true);
          widest = Math.max(widest, Math.abs(p.getX(i)), Math.abs(p.getZ(i)));
        }
        // Nothing reaches further from the fold than a cover is wide.
        expect(widest).toBeLessThan(d.coverW + 0.5);
      }
    }
  });
});
