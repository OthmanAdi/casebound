/**
 * The rules of reading by touch (SPEC S-RD-16), kept free of the browser so they can be tested on their own.
 *
 * The open book takes a zoom and a pan on top of the place the reader gives it: the zoom scales it about its spine,
 * the pan moves it in window pixels. On a narrow screen one page side is in view at a time and fills the width; a
 * finger pans between the sides, two fingers zoom, and a pull at the edge of the pan turns the page. Past their
 * limits the zoom and the pan give way like a rubber band and spring back when the fingers are lifted.
 */
import { clamp } from '../core/math';

/** Every number of reading by touch. Read in the reference's script and checked on a phone (`research/SPEC.md`). */
export interface TouchTuning {
  /** Smallest zoom. */
  zoomMin: number;
  /** Largest zoom; on a narrow screen at least `zoomFit` times the zoom that fits a page. */
  zoomMax: number;
  zoomFit: number;
  /** Share of a pinch past the limits that still moves the book. */
  zoomRubber: number;
  /** Share of a pan past the limits that still moves the book. */
  panRubber: number;
  /** Pixels a finger travels before it pans or pulls a page; less is a tap. */
  slop: number;
  /** Pixels from the limit of the pan that still count as its edge, where a pull takes the page. */
  edge: number;
  /** Seconds a finger rests on a page of a wide screen before it pans instead. */
  hold: number;
  /** Share of the window's width (or of the room's height) one page fills on a narrow screen. */
  fit: number;
  /** The zoom that fits a page is no larger than this. */
  fitCap: number;
  /** Seconds of the finger's speed that are added to the pan when the side is chosen. */
  lookahead: number;
  /** A spread narrower than the window times this is centred whole, with no sides to choose. */
  spreadSlack: number;
  /** The spring that brings zoom and pan back: stiffness, and damping as a share of the critical one. */
  stiffness: number;
  damping: number;
  /** Room of the page between the header and the bar, pixels: from this far below the top of the window. */
  areaTop: number;
  /** And this far above the top of the bar (or the foot of the window). */
  areaGap: number;
  /** Seconds in which the zoom and the pan reach the first page side while a book opens. */
  ramp: number;
  /** On a wide screen: share of the book's box that stays in the window, however it is panned. */
  onscreen: number;
}

/** Measured: `12s2:1196-1202` in the reference's script, held against a phone of 390 by 844 (`research/PARITY.md`). */
export const TOUCH_DEFAULT: TouchTuning = {
  zoomMin: 0.5,
  zoomMax: 2,
  zoomFit: 2,
  zoomRubber: 0.35,
  panRubber: 0.28,
  slop: 8,
  edge: 6,
  hold: 0.3,
  fit: 0.96,
  fitCap: 3,
  lookahead: 0.18,
  spreadSlack: 1.1,
  stiffness: 140,
  damping: 0.75,
  areaTop: 88,
  areaGap: 24,
  ramp: 0.25,
  onscreen: 0.25,
};

/** A value past `lo` or `hi` gives way by the share `k` of how far past it is. */
export const rubber = (v: number, lo: number, hi: number, k: number): number => (v < lo ? lo - (lo - v) * k : v > hi ? hi + (v - hi) * k : v);

/** Where the open book lies with no zoom and no pan, window pixels: its spine (the point it is scaled about) and one page. */
export interface ReadFrame {
  x: number;
  y: number;
  pageW: number;
  pageH: number;
}

/** The room the page may fill: the window's width, and from `top` to `bottom`. */
export interface ReadArea {
  width: number;
  top: number;
  bottom: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** The zoom at which one page fills its share of the width, or of the room's height if that is less. */
export const fitZoom = (frame: ReadFrame, area: ReadArea, t: TouchTuning): number =>
  Math.min(t.fitCap, t.fit * Math.min(area.width / Math.max(1, frame.pageW), Math.max(1, area.bottom - area.top) / Math.max(1, frame.pageH)));

/** The limits of the zoom. On a narrow screen the largest is at least twice the one that fits a page. */
export const zoomLimits = (fit: number | null, phone: boolean, t: TouchTuning): { lo: number; hi: number } => ({
  lo: t.zoomMin,
  hi: phone && fit !== null ? Math.max(t.zoomMax, fit * t.zoomFit) : t.zoomMax,
});

/**
 * The limits of the pan on a narrow screen, at a zoom. With one page in the width the two ends are its two sides
 * (`snap`): the pan rests on one or the other. A page wider than the window may be panned from one outer edge to the
 * other; a spread that fits is centred. A page as tall as the room or taller may be panned from its head to its foot.
 * `sides` says which pages there are: a zine at its first or last spread has one.
 */
export function phoneBounds(frame: ReadFrame, area: ReadArea, zoom: number, sides: { left: boolean; right: boolean }, t: TouchTuning): { snap: boolean; pageW: number; bounds: Bounds } {
  const page = frame.pageW * zoom;
  const w = area.width;
  // Where the spine stands with the left page in view, and with the right one.
  let left: number;
  let right: number;
  if (2 * page <= w * t.spreadSlack) left = right = w / 2;
  else if (page <= w) {
    left = w / 2 + page / 2;
    right = w / 2 - page / 2;
  } else {
    left = page;
    right = w - page;
  }
  if (sides.left !== sides.right) {
    if (sides.right) left = right;
    else right = left;
  }
  const half = (frame.pageH * zoom) / 2;
  const room = area.bottom - area.top;
  let minY: number;
  let maxY: number;
  if (2 * half > room) {
    maxY = area.top - (frame.y - half);
    minY = area.bottom - (frame.y + half);
  } else minY = maxY = clamp(0, area.top - (frame.y - half), area.bottom - (frame.y + half));
  return { snap: page <= w, pageW: page, bounds: { minX: right - frame.x, maxX: left - frame.x, minY, maxY } };
}

/** The limits of the pan on a wide screen: a share of the book's box at this zoom (without pan) stays in the window. */
export function boxBounds(box: { left: number; top: number; width: number; height: number }, view: { width: number; height: number }, t: TouchTuning): Bounds {
  const keepX = box.width * t.onscreen;
  const keepY = box.height * t.onscreen;
  return { minX: keepX - (box.left + box.width), maxX: view.width - keepX - box.left, minY: keepY - (box.top + box.height), maxY: view.height - keepY - box.top };
}

/**
 * The side to rest on when the finger lifts: the pan, carried on by the finger's speed for `lookahead` seconds when
 * the sides snap, against the middle of the limits. More pan is the left page.
 */
export const pickSide = (pan: number, speed: number, bounds: Bounds, snap: boolean, t: TouchTuning): 'left' | 'right' =>
  pan + (snap ? speed * t.lookahead : 0) > (bounds.minX + bounds.maxX) / 2 ? 'left' : 'right';

/**
 * Which way a sideways pull may take a page instead of panning: toward the right (`left`, the page on the left
 * turns back) only with the pan at its left end, toward the left (`right`) only at its right end. When the sides
 * snap, the side in view is that end.
 */
export function edgesFree(pan: number, bounds: Bounds | null, snap: boolean, side: 'left' | 'right', t: TouchTuning): { left: boolean; right: boolean } {
  if (!bounds || bounds.maxX - bounds.minX < 1) return { left: true, right: true };
  if (snap) return { left: side === 'left', right: side === 'right' };
  return { left: pan >= bounds.maxX - t.edge, right: pan <= bounds.minX + t.edge };
}

/** One step of the spring toward `goal`, semi-implicit: the speed first, then the value. `dt` in seconds. */
export function springStep(value: number, goal: number, speed: number, dt: number, t: TouchTuning): { value: number; speed: number } {
  const accel = -t.stiffness * (value - goal) - 2 * t.damping * Math.sqrt(t.stiffness) * speed;
  const next = speed + accel * dt;
  return { value: value + next * dt, speed: next };
}

/** The finger's speed in pixels a second, smoothed: 0.4 of the last value and 0.6 of the newest step. */
export function trackSpeed(speed: number, from: number, to: number, ms: number): number {
  return ms > 0 && ms < 200 ? 0.4 * speed + ((to - from) / ms) * 600 : speed;
}

/** Two fingers at the start of a pinch and now. */
export interface PinchStart {
  zoom: number;
  panX: number;
  panY: number;
  dist: number;
  cx: number;
  cy: number;
}

/**
 * A pinch: the zoom grows with the distance of the fingers, and the place of the book that was under their middle
 * stays under it. `about` is the point the book is scaled about with no pan. Returns the zoom as the fingers ask for
 * it (`zoom`) and as it is shown, with the rubber band past the limits (`shown`), and the pan.
 */
export function pinch(start: PinchStart, dist: number, cx: number, cy: number, about: { x: number; y: number }, limits: { lo: number; hi: number }, t: TouchTuning): { zoom: number; shown: number; panX: number; panY: number } {
  const zoom = (start.zoom * Math.max(1, dist)) / Math.max(1, start.dist);
  const shown = rubber(zoom, limits.lo, limits.hi, t.zoomRubber);
  const lx = (start.cx - about.x - start.panX) / Math.max(1e-4, start.zoom);
  const ly = (start.cy - about.y - start.panY) / Math.max(1e-4, start.zoom);
  return { zoom, shown, panX: cx - about.x - lx * shown, panY: cy - about.y - ly * shown };
}
