import { describe, expect, it } from 'vitest';
import { INK_DEFAULT, InkBook, extendStroke, strokeCurve, strokeOutlines, type InkSurface, type Stroke } from './ink';

/** A surface that only remembers what was asked of it. */
const fake = (log: string[]) => (width: number, height: number): InkSurface & { fills: number } => {
  const s = {
    width,
    height,
    fills: 0,
    clear: () => { s.fills = 0; log.push('clear'); },
    copy: (from: InkSurface) => { s.fills += (from as typeof s).fills; },
    fill: () => { s.fills += 1; log.push('fill'); },
    line: () => { s.fills += 1; log.push('line'); },
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
    expect(extendStroke(s, 0.5, 0.5004, 0.66)).toBe(false);
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
    b.move(0.3, 0.4);
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
    b.move(0.3, 0.5);
    b.begin(4, 0.2, 0.5, '#ffe14a', 0.02);
    expect(b.strokes(3).length).toBe(1);
    expect(b.drawing).toBe(4);
  });

  it('take the last stroke away, and wipe a page or all of them', () => {
    const b = book();
    for (const v of [0.3, 0.4, 0.5]) { b.begin(7, 0.2, v, '#ffe14a', 0.02); b.move(0.6, v); b.end(); }
    b.begin(8, 0.2, 0.5, '#ffe14a', 0.02); b.move(0.3, 0.5); b.end();
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

describe('the round nib', () => {
  const t = INK_DEFAULT;

  it('draws a straight stroke as a straight curve from the first point to the last', () => {
    const c = strokeCurve({ color: '#fff082', width: 0.0205, points: [0.1, 0.5, 0.3, 0.5, 0.5, 0.5] }, 1024, 1024);
    expect(c.length).toBe(2 + 6 * 2);
    expect(c.slice(0, 2)).toEqual([102.4, 512]);
    expect(c.slice(-2)).toEqual([512, 512]);
    for (let i = 1; i < c.length; i += 2) expect(c[i]).toBeCloseTo(512, 9);
    // Handles lie between the ends of their step.
    expect(c[2]!).toBeGreaterThan(102.4);
    expect(c[4]!).toBeLessThan(307.2);
  });

  it('gives a single point no curve but its place, and nothing to nothing', () => {
    expect(strokeCurve({ color: '#fff082', width: 0.02, points: [0.5, 0.25] }, 1024, 1024)).toEqual([512, 768]);
    expect(strokeCurve({ color: '#fff082', width: 0.02, points: [] }, 1024, 1024)).toEqual([]);
  });

  it('keeps every handle within 0.45 of its step', () => {
    const points = [0.1, 0.5, 0.12, 0.52, 0.4, 0.5, 0.41, 0.3, 0.7, 0.31];
    const c = strokeCurve({ color: '#fff082', width: 0.02, points }, 1024, 1024);
    let x = c[0]!, y = c[1]!;
    for (let i = 2; i < c.length; i += 6) {
      const step = Math.hypot(c[i + 4]! - x, c[i + 5]! - y);
      expect(Math.hypot(c[i]! - x, c[i + 1]! - y)).toBeLessThanOrEqual(t.smooth * step + 1e-9);
      expect(Math.hypot(c[i + 2]! - c[i + 4]!, c[i + 3]! - c[i + 5]!)).toBeLessThanOrEqual(t.smooth * step + 1e-9);
      x = c[i + 4]!;
      y = c[i + 5]!;
    }
  });

  it('shortens the handles at a sharp corner, so the corner stays one', () => {
    const soft = strokeCurve({ color: '#fff082', width: 0.02, points: [0.2, 0.5, 0.4, 0.5, 0.6, 0.45] }, 1024, 1024);
    const sharp = strokeCurve({ color: '#fff082', width: 0.02, points: [0.2, 0.5, 0.4, 0.5, 0.25, 0.45] }, 1024, 1024);
    const handleAtCorner = (c: number[]): number => Math.hypot(c[4]! - c[6]!, c[5]! - c[7]!);
    expect(handleAtCorner(sharp)).toBeLessThan(handleAtCorner(soft) * 0.6);
  });

  it('leaves nothing for a press without a move, and a dot only where taps are kept', () => {
    const log: string[] = [];
    const b = new InkBook(1, 1024, fake(log));
    b.begin(5, 0.5, 0.5, '#fff082', 0.0205, 0.8);
    expect((b.shown(5) as unknown as { fills: number }).fills).toBe(1);
    b.end();
    expect(b.strokes(5).length).toBe(0);
    expect((b.shown(5) as unknown as { fills: number }).fills).toBe(0);
    b.tuning.dropTaps = false;
    b.begin(5, 0.5, 0.5, '#fff082', 0.0205, 0.8);
    b.end();
    expect(b.strokes(5).length).toBe(1);
    expect(b.strokes(5)[0]!.strength).toBe(0.8);
    expect(JSON.parse(JSON.stringify(b.toJSON()))['5'][0].strength).toBe(0.8);
  });

  it('paints with a line when round and with a filled shape when a chisel', () => {
    const log: string[] = [];
    const b = new InkBook(1, 1024, fake(log));
    b.begin(5, 0.2, 0.5, '#fff082', 0.0205);
    b.move(0.4, 0.5);
    b.end();
    expect(log.includes('line')).toBe(true);
    expect(log.includes('fill')).toBe(false);
    log.length = 0;
    b.tuning.round = false;
    b.begin(5, 0.2, 0.6, '#fff082', 0.0205);
    b.move(0.4, 0.6);
    b.end();
    expect(log.includes('fill')).toBe(true);
  });
});
