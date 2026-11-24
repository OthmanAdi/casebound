import { describe, expect, it } from 'vitest';
import { INK_DEFAULT, InkBook, extendStroke, strokeOutlines, type InkSurface, type Stroke } from './ink';

/** A surface that only remembers what was asked of it. */
const fake = (log: string[]) => (width: number, height: number): InkSurface & { fills: number } => {
  const s = {
    width,
    height,
    fills: 0,
    clear: () => { s.fills = 0; log.push('clear'); },
    copy: (from: InkSurface) => { s.fills += (from as typeof s).fills; },
    fill: () => { s.fills += 1; log.push('fill'); },
    touch: () => { log.push('touch'); },
  };
  return s;
};

const book = (log: string[] = []): InkBook => new InkBook(0.66, 1000, fake(log));

describe('a stroke of the pen', () => {
  const stroke: Stroke = { color: '#ffe14a', width: 0.02, points: [0.2, 0.5, 0.6, 0.5] };

  it('leaves a band as wide as the nib is long when it is drawn across the page', () => {
    const outlines = strokeOutlines(stroke, 660, 1000, { ...INK_DEFAULT, nibAngle: 0 });
    // A nib at each end and the band between them.
    expect(outlines.length).toBe(3);
    const band = outlines[1]!;
    const ys = band.filter((_, i) => i % 2 === 1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.02 * 1000, 6);
    const xs = band.filter((_, i) => i % 2 === 0);
    expect(Math.min(...xs)).toBeCloseTo(0.2 * 660, 6);
    expect(Math.max(...xs)).toBeCloseTo(0.6 * 660, 6);
  });

  it('leaves a thin line when it is drawn along the edge of the nib', () => {
    const up: Stroke = { ...stroke, points: [0.4, 0.3, 0.4, 0.6] };
    const band = strokeOutlines(up, 660, 1000, { ...INK_DEFAULT, nibAngle: 0 })[1]!;
    const xs = band.filter((_, i) => i % 2 === 0);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0, 6);
  });

  it('winds every outline the same way, so a stroke fills as one shape', () => {
    const zig: Stroke = { ...stroke, points: [0.2, 0.5, 0.6, 0.52, 0.3, 0.47, 0.3, 0.6] };
    for (const o of strokeOutlines(zig, 660, 1000)) {
      let sum = 0;
      for (let i = 0; i < o.length; i += 2) sum += o[i]! * o[(i + 3) % o.length]! - o[(i + 2) % o.length]! * o[i + 1]!;
      expect(sum).toBeGreaterThanOrEqual(0);
    }
  });

  it('puts the foot of the page at the bottom of the picture', () => {
    const low: Stroke = { ...stroke, points: [0.5, 0.1] };
    const nib = strokeOutlines(low, 660, 1000)[0]!;
    expect(nib[1]!).toBeGreaterThan(850);
  });

  it('drops points that are too near the last one and keeps within the page', () => {
    const s: Stroke = { color: '#ffe14a', width: 0.02, points: [] };
    expect(extendStroke(s, 0.5, 0.5, 0.66)).toBe(true);
    expect(extendStroke(s, 0.5001, 0.5, 0.66)).toBe(false);
    expect(extendStroke(s, 0.52, 0.5, 0.66)).toBe(true);
    expect(extendStroke(s, 1.4, -0.2, 0.66)).toBe(true);
    expect(s.points).toEqual([0.5, 0.5, 0.52, 0.5, 1, 0]);
  });
});

describe('the marks of a book', () => {
  it('give a page a picture with its first stroke and say so once', () => {
    const b = book();
    expect(b.shown(12)).toBeNull();
    expect(b.begin(12, 0.2, 0.5, '#ffe14a', 0.02)).toBe(true);
    b.move(0.4, 0.5);
    b.end();
    expect(b.shown(12)).not.toBeNull();
    expect(b.begin(12, 0.2, 0.4, '#ffe14a', 0.02)).toBe(false);
    b.end();
    expect(b.strokes(12).length).toBe(2);
    expect(b.marked).toEqual([12]);
  });

  it('show the stroke that is being drawn before it is finished', () => {
    const b = book();
    b.begin(3, 0.2, 0.5, '#ffe14a', 0.02);
    b.move(0.5, 0.5);
    expect(b.drawing).toBe(3);
    expect(b.strokes(3).length).toBe(0);
    expect((b.shown(3) as unknown as { fills: number }).fills).toBe(1);
    b.end();
    expect(b.drawing).toBeNull();
    expect((b.shown(3) as unknown as { fills: number }).fills).toBe(1);
  });

  it('finish a stroke when the nib is put down somewhere else', () => {
    const b = book();
    b.begin(3, 0.2, 0.5, '#ffe14a', 0.02);
    b.begin(4, 0.2, 0.5, '#ffe14a', 0.02);
    expect(b.strokes(3).length).toBe(1);
    expect(b.drawing).toBe(4);
  });

  it('take the last stroke away, and wipe a page or all of them', () => {
    const b = book();
    for (const v of [0.3, 0.4, 0.5]) { b.begin(7, 0.2, v, '#ffe14a', 0.02); b.move(0.6, v); b.end(); }
    b.begin(8, 0.2, 0.5, '#ffe14a', 0.02); b.end();
    expect(b.undo(7)).toBe(true);
    expect(b.strokes(7).length).toBe(2);
    b.clear(7);
    expect(b.strokes(7).length).toBe(0);
    expect(b.strokes(8).length).toBe(1);
    expect(b.undo(7)).toBe(false);
    b.clear();
    expect(b.marked).toEqual([]);
  });

  it('come back from what was saved, and leave out what is not a stroke', () => {
    const b = book();
    b.begin(7, 0.2, 0.3, '#ffe14a', 0.02); b.move(0.61234567, 0.3); b.end();
    const saved = JSON.parse(JSON.stringify(b.toJSON()));
    expect(saved['7'][0].points).toEqual([0.2, 0.3, 0.6123, 0.3]);
    const c = book();
    c.load({ ...saved, x: [1], 9: [{ color: 'red', width: 0.02, points: [0, 0] }, { color: '#00ff00', width: 5, points: [2, -1] }], 10: 'no' });
    expect(c.strokes(7).length).toBe(1);
    expect(c.strokes(9).length).toBe(1);
    expect(c.strokes(9)[0]!.width).toBe(0.2);
    expect(c.strokes(9)[0]!.points).toEqual([1, 0]);
    expect(c.marked.sort()).toEqual([7, 9]);
    c.load(null);
    expect(c.marked).toEqual([]);
  });
});
