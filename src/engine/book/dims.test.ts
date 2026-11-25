import { describe, expect, it } from 'vitest';
import { atlasOf, makeDims } from './dims';

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
