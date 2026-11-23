import { describe, expect, it } from 'vitest';
import { ROW_DEFAULT, choose, createRow, joinOf, placeAt, pushAt, releaseRow, restX, rowCall, rowOrder, rowSettled, stepChoice, stepRow } from './row';

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

  it('follows a hand that drags it and takes the next book past a quarter of the way', () => {
    const s = createRow(6, 3);
    run(s, 1, 2);
    s.dragging = true;
    s.drag = 1.2;
    run(s, 1, 0.5);
    expect(placeAt(s, widths, 3).x).toBeCloseTo(1.2, 1);
    // A small pull lets the row fall back.
    expect(releaseRow(s, widths, 0, false)).toBe(false);
    expect(s.selected).toBe(3);
    // A pull to the right brings the book on the left to the middle.
    s.dragging = true;
    s.drag = 4;
    expect(releaseRow(s, widths, 0, false)).toBe(true);
    expect(s.selected).toBe(2);
    expect(s.drag).toBe(0);
    // A flick to the left carries on over more than one book, three at most.
    run(s, 1, 2);
    s.dragging = true;
    s.drag = -3;
    expect(releaseRow(s, widths, -400, true)).toBe(true);
    expect(s.selected).toBe(5);
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

  it('keeps the last featured book a spine until the row stands, then turns its cover', () => {
    // Captured: spine to the front by half way, the cover only once the row is settled.
    const s = createRow(6, 3);
    expect(s.yaw[3]).toBe(0);
    run(s, 0.2, 1);
    expect(s.settled).toBe(false);
    expect(s.yaw[3]).toBe(0);
    run(s, 1, 2);
    expect(s.settled).toBe(true);
    expect(s.yaw[3]).toBeCloseTo(1, 3);
  });

  it('slides to the chosen book without running past it', () => {
    const s = createRow(6, 3);
    run(s, 1, 3);
    const from = s.offset;
    choose(s, 5);
    const goal = -restX(widths, 3, ROW_DEFAULT.gap)[5]!;
    let furthest = from;
    for (let i = 0; i < 240; i++) {
      stepRow(s, widths, 1, -1, 1 / 60);
      furthest = Math.min(furthest, s.offset);
    }
    expect(s.offset).toBeCloseTo(goal, 2);
    // The covers push their neighbours while they turn; the slide itself never overshoots its aim.
    expect(furthest).toBeGreaterThan(goal - 0.02);
  });

  it('sinks in step with the scroll once it stood fully, and is back when the scroll returns', () => {
    const s = createRow(6, 3);
    run(s, 1, 3);
    expect(s.activated).toBe(true);
    // A scroll that turns back takes the row with it at once: no waiting for a lower threshold.
    run(s, 0.7, 0.05);
    expect(s.called).toBe(false);
    expect(s.leaving).toBe(true);
    const part = s.assemble;
    expect(part).toBeLessThan(1);
    run(s, 0.5, 0.05);
    expect(s.assemble).toBeLessThan(part);
    run(s, 0, 1);
    expect(s.assemble).toBeLessThan(0.01);
    expect(s.settled).toBe(false);
    run(s, 1, 3);
    expect(s.settled).toBe(true);
    expect(s.assemble).toBeGreaterThan(0.99);
  });

  it('comes and goes the same at 30 and 120 frames a second', () => {
    const at = (fps: number): number[] => {
      const s = createRow(6, 3);
      run(s, 1, 0.5, fps);
      const up = s.assemble;
      run(s, 1, 2.5, fps);
      run(s, 0.6, 0.1, fps);
      return [up, s.assemble];
    };
    const slow = at(30);
    const fast = at(120);
    expect(slow[0]!).toBeCloseTo(fast[0]!, 1);
    expect(slow[1]!).toBeCloseTo(fast[1]!, 1);
  });
});
