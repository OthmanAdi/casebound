import { describe, expect, it } from 'vitest';
import { ROW_DEFAULT, choose, createRow, joinOf, placeAt, pushAt, restX, rowCall, rowOrder, rowSettled, stepChoice, stepRow } from './row';

const widths = [2.2, 2.6, 2.4, 2.5, 3.0, 2.1];
const run = (s: ReturnType<typeof createRow>, past: number, seconds: number, fps = 60, hovered = -1): void => {
  for (let i = 0; i < Math.round(seconds * fps); i++) stepRow(s, widths, past, hovered, 1 / fps);
};

describe('row of spines', () => {
  it('keeps catalogue order for a small library and wraps a large one', () => {
    expect(rowOrder(6, 3)).toEqual([0, 1, 2, 3, 4, 5]);
    // 21 books, 4 featured: seven move to the front, so the featured stand near the middle.
    const big = rowOrder(21, 3);
    expect(big.slice(0, 7)).toEqual([14, 15, 16, 17, 18, 19, 20]);
    expect(big.indexOf(3)).toBe(10);
  });

  it('packs the spines with a gap, measured from the anchor', () => {
    const x = restX(widths, 3, ROW_DEFAULT.gap);
    expect(x[3]).toBe(0);
    expect(x[4]! - x[3]!).toBeCloseTo(2.5 / 2 + ROW_DEFAULT.gap + 3.0 / 2, 6);
    expect(x[2]! - x[3]!).toBeCloseTo(-(2.4 / 2 + ROW_DEFAULT.gap + 2.5 / 2), 6);
  });

  it('pushes the neighbours of an open cover apart by its extra width', () => {
    const yaw = [0, 0, 0, 1, 0, 0];
    const extra = (ROW_DEFAULT.slot - widths[3]!) / 2;
    expect(pushAt(4, widths, yaw, ROW_DEFAULT.slot)).toBeCloseTo(extra, 6);
    expect(pushAt(2, widths, yaw, ROW_DEFAULT.slot)).toBeCloseTo(-extra, 6);
    expect(pushAt(3, widths, yaw, ROW_DEFAULT.slot)).toBe(0);
  });

  it('assembles past the upper threshold and only leaves below the lower one', () => {
    const s = createRow(6, 3);
    const at = (call: number): number => {
      // Invert the eased call for a scroll position.
      let lo = 0, hi = 1;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (rowCall(mid) < call) lo = mid;
        else hi = mid;
      }
      return hi;
    };
    run(s, at(0.25), 1);
    expect(s.called).toBe(false);
    run(s, at(0.3), 2);
    expect(s.called).toBe(true);
    expect(s.assemble).toBeGreaterThan(0.99);
    run(s, at(0.2), 1);
    expect(s.called).toBe(true);
    run(s, at(0.15), 2);
    expect(s.called).toBe(false);
    expect(s.assemble).toBeLessThan(0.01);
  });

  it('lets the near books stand before the far ones', () => {
    const s = createRow(6, 3);
    run(s, 1, 0.18);
    expect(s.arrived[4]!).toBeGreaterThan(s.arrived[5]!);
    expect(s.arrived[2]!).toBeGreaterThan(s.arrived[0]!);
    run(s, 1, 3);
    for (let i = 0; i < 6; i++) expect(placeAt(s, widths, i).rise).toBeGreaterThan(0.999);
  });

  it('turns the chosen book to the front and slides it to the middle', () => {
    const s = createRow(6, 3);
    run(s, 1, 2);
    expect(rowSettled(s, 1)).toBe(true);
    expect(placeAt(s, widths, 3).x).toBeCloseTo(0, 3);
    expect(placeAt(s, widths, 3).turn).toBeCloseTo(1, 3);
    expect(choose(s, 5)).toBe(true);
    run(s, 1, 2.5);
    expect(placeAt(s, widths, 5).x).toBeCloseTo(0, 2);
    expect(placeAt(s, widths, 5).turn).toBeCloseTo(1, 3);
    expect(placeAt(s, widths, 3).turn).toBeCloseTo(0, 3);
    // The open cover stands forward, the spines step back.
    expect(placeAt(s, widths, 5).z).toBeCloseTo(ROW_DEFAULT.forward, 2);
    expect(placeAt(s, widths, 3).z).toBeCloseTo(-ROW_DEFAULT.back, 2);
  });

  it('refuses a second step within the pause and takes it after', () => {
    const s = createRow(6, 3);
    run(s, 1, 2);
    expect(stepChoice(s, 1)).toBe(true);
    expect(stepChoice(s, 1)).toBe(false);
    run(s, 1, 0.2);
    expect(stepChoice(s, 1)).toBe(true);
    expect(s.selected).toBe(5);
    run(s, 1, 0.2);
    expect(stepChoice(s, 1)).toBe(false);
  });

  it('pops the spine under the pointer forward, never the chosen book', () => {
    const s = createRow(6, 3);
    run(s, 1, 2, 60, 1);
    expect(s.pop[1]!).toBeCloseTo(ROW_DEFAULT.hoverPop, 1);
    run(s, 1, 1, 60, 3);
    expect(s.pop[3]!).toBe(0);
    expect(s.pop[1]!).toBeLessThan(0.01);
  });

  it('moves the last featured book into the row as the scroll goes on', () => {
    const s = createRow(6, 3);
    expect(joinOf(s, 0)).toBe(0);
    run(s, 0.4, 2);
    expect(joinOf(s, 0.4)).toBeGreaterThan(0.9);
    expect(joinOf(s, 1)).toBe(1);
  });

  it('gives the same row at 30 and 120 frames per second', () => {
    const a = createRow(6, 3);
    const b = createRow(6, 3);
    run(a, 1, 0.5, 30);
    run(b, 1, 0.5, 120);
    expect(a.assemble).toBeCloseTo(b.assemble, 1);
    expect(a.arrived[5]!).toBeCloseTo(b.arrived[5]!, 1);
  });
});
