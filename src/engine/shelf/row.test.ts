import { describe, expect, it } from 'vitest';
import { ROW_DEFAULT, choose, createRow, joinOf, placeAt, placeUnder, pushAt, releaseRow, restX, rowCall, rowOrder, rowSettled, stepChoice, stepRow } from './row';

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

  it('finds the place under a point of the row, with its fraction', () => {
    const x = restX(widths, 3, ROW_DEFAULT.gap);
    expect(placeUnder(x, x[2]!)).toBe(2);
    expect(placeUnder(x, (x[2]! + x[3]!) / 2)).toBeCloseTo(2.5, 9);
    expect(placeUnder(x, x[0]! - 5)).toBe(0);
    expect(placeUnder(x, x[5]! + 5)).toBe(5);
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

  it('follows a hand that drags it, turns the covers as they pass, and takes the book brought to the middle', () => {
    const s = createRow(6, 3);
    run(s, 1, 2);
    s.dragging = true;
    s.drag = 1.2;
    run(s, 1, 0.5);
    expect(s.offset).toBeCloseTo(1.2, 1);
    // Measured: the choice follows the hand during the pull. A third of a place on, the old cover has begun to
    // turn away and the next one to show.
    expect(s.yaw[3]!).toBeLessThan(0.95);
    expect(s.yaw[3]!).toBeGreaterThan(0.5);
    expect(s.yaw[2]!).toBeGreaterThan(0.05);
    // A small pull lets the row fall back.
    expect(releaseRow(s, widths, 0, false)).toBe(false);
    expect(s.selected).toBe(3);
    // A pull to the right brings the book on the left to the middle.
    s.dragging = true;
    s.drag = 4;
    expect(releaseRow(s, widths, 0, false)).toBe(true);
    expect(s.selected).toBe(2);
    expect(s.drag).toBe(0);
    // Places are counted in the resting distance of the spines: 7.7 units are two books, as measured.
    run(s, 1, 2);
    s.dragging = true;
    s.drag = -7.7;
    expect(releaseRow(s, widths, 0, false)).toBe(true);
    expect(s.selected).toBe(4);
    // A flick carries on, but never past the end of the row.
    run(s, 1, 2);
    s.dragging = true;
    s.drag = -3;
    expect(releaseRow(s, widths, -400, true)).toBe(true);
    expect(s.selected).toBe(5);
  });

  it('reaches a far choice by a timed glide, and the cover turn travels with it', () => {
    const s = createRow(6, 0);
    run(s, 1, 3);
    const x0 = restX(widths, 0, ROW_DEFAULT.gap);
    choose(s, 3);
    expect(s.glide).not.toBeNull();
    // Three places: 0.4 s. Measured on the reference: 10, 50 and 90 percent of the way about 100, 200 and 310 ms
    // after the release.
    expect(s.glide!.seconds).toBeCloseTo(0.4, 6);
    const share = (): number => -s.offset / x0[3]!;
    run(s, 1, 0.1);
    expect(share()).toBeGreaterThan(0.05);
    expect(share()).toBeLessThan(0.16);
    run(s, 1, 0.1);
    expect(share()).toBeCloseTo(0.5, 1);
    // On the way the books in between show part of their covers; the new one has only begun.
    expect(s.yaw[1]! + s.yaw[2]!).toBeGreaterThan(0.3);
    expect(s.yaw[3]!).toBeLessThan(0.2);
    run(s, 1, 0.12);
    expect(share()).toBeGreaterThan(0.88);
    run(s, 1, 2);
    expect(s.glide).toBeNull();
    expect(-s.offset).toBeCloseTo(x0[3]!, 2);
    expect(s.yaw[3]!).toBeCloseTo(1, 2);
    expect(s.yaw[1]!).toBeCloseTo(0, 2);
    // A step to the neighbour stays with the damper.
    choose(s, 4);
    expect(s.glide).toBeNull();
  });

  it('closes up behind a book that has left the row to be read', () => {
    const s = createRow(6, 3);
    run(s, 1, 3);
    const gap = (): number => placeAt(s, widths, 4).x - placeAt(s, widths, 2).x;
    const open = gap();
    s.away = 1;
    // Measured: the neighbours of an open cover stand 9.95 units from it, behind a book that is out 3.81.
    expect(open - gap()).toBeCloseTo(ROW_DEFAULT.slot - widths[3]!, 6);
    s.away = 0.5;
    expect(open - gap()).toBeCloseTo((ROW_DEFAULT.slot - widths[3]!) / 2, 6);
  });

  it('centres a row that fits the window and does not slide it', () => {
    const s = createRow(6, 3);
    s.window = 27;
    run(s, 1, 3);
    const centre = (): number => {
      const first = placeAt(s, widths, 0).x - widths[0]! / 2;
      const last = placeAt(s, widths, 5).x + widths[5]! / 2;
      return (first + last) / 2;
    };
    expect(centre()).toBeCloseTo(0, 1);
    choose(s, 0);
    run(s, 1, 3);
    // The chosen book shows its cover where it stands; the row as a whole stays in the middle.
    expect(s.yaw[0]!).toBeCloseTo(1, 2);
    const first = placeAt(s, widths, 0).x - ROW_DEFAULT.slot / 2;
    const last = placeAt(s, widths, 5).x + widths[5]! / 2;
    expect((first + last) / 2).toBeCloseTo(0, 1);
  });

  it('keeps the ends of a long row inside the window', () => {
    const many = Array.from({ length: 21 }, (_, i) => 2.2 + (i % 4) * 0.25);
    const s = createRow(21, 10);
    s.window = 27;
    const go = (seconds: number): void => {
      for (let i = 0; i < seconds * 60; i++) stepRow(s, many, 1, -1, 1 / 60);
    };
    go(3);
    // In the middle of the row the chosen book stands in the middle of the window.
    expect(placeAt(s, many, 10).x).toBeCloseTo(0, 1);
    choose(s, 0);
    go(4);
    // Measured: the first book, chosen, is not brought to the middle. Its outer edge keeps a spine and two units
    // from the edge of the window.
    const x = placeAt(s, many, 0).x;
    expect(x).toBeLessThan(-10);
    expect(x - ROW_DEFAULT.slot / 2).toBeCloseTo(-27 + many[0]! + ROW_DEFAULT.endRoom, 1);
    choose(s, 20);
    go(5);
    expect(placeAt(s, many, 20).x + ROW_DEFAULT.slot / 2).toBeCloseTo(27 - many[20]! - ROW_DEFAULT.endRoom, 1);
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
