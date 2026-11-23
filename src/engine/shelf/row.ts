/**
 * The row of spines (SPEC section 6): past the last featured book every book of the library stands side by
 * side, spine to the reader. The chosen one turns its cover to the front and the others make room for it,
 * like a coverflow. Only numbers are kept here; the shelf owns the books and the pointer.
 */
import { clamp, easeInOutQuad, expFactor, smoothDamp, type Velocity } from '../core/math';

export interface RowTuning {
  /** Air between two spines, world units. */
  gap: number;
  /** Width a book takes when its cover faces the front. */
  slot: number;
  /** Spine width as a share of the book's thickness. */
  spine: number;
  /** How far behind the shelf plane the row stands. */
  depth: number;
  /** A book that shows its cover comes this far forward; the others step this far back. */
  forward: number;
  back: number;
  /** Shapes the turn of a book from spine to cover. Above 1 the turn starts late. */
  yawPower: number;
  /** Seconds for a book to turn when the choice changes. */
  yawTime: number;
  /** Seconds for the row to slide so the chosen book is in the middle. */
  offsetTime: number;
  /** Share of the row slot scrolled after which the row is fully called for. */
  span: number;
  /** The row assembles above this value of the eased scroll and leaves again below `releaseAt`. */
  assembleAt: number;
  releaseAt: number;
  gateTime: number;
  assembleTime: number;
  /** How far a spine under the pointer steps forward, and how fast. */
  hoverPop: number;
  hoverRate: number;
  /** Least time between two steps of the choice, seconds. */
  stepPause: number;
}

export const ROW_DEFAULT: RowTuning = {
  gap: 0.9375,
  slot: 15.13,
  spine: 0.85,
  depth: 15.75,
  forward: 8,
  back: 2,
  yawPower: 1.6,
  yawTime: 0.2,
  offsetTime: 0.26,
  span: 0.68,
  assembleAt: 0.28,
  releaseAt: 0.18,
  gateTime: 0.22,
  assembleTime: 0.238,
  hoverPop: 3.78,
  hoverRate: 10,
  stepPause: 0.15,
};

export interface RowState {
  /** Position in the row of the book that shows its cover. */
  selected: number;
  /** Position of the last featured book: the one the row grows from. */
  anchor: number;
  /** Per book: 0 = spine to the front, 1 = cover to the front. */
  yaw: number[];
  /** Per book: 0 = still below the picture, 1 = standing in its place. */
  arrived: number[];
  arrivedVel: Velocity[];
  /** Per book: how far it has stepped forward under the pointer. */
  pop: number[];
  /** Sideways slide of the whole row. */
  offset: number;
  offsetVel: Velocity;
  /** True while the row is called for. It has two thresholds, so it does not flicker at the edge. */
  called: boolean;
  gate: number;
  gateVel: Velocity;
  /** 0 = no row, 1 = the row stands. */
  assemble: number;
  assembleVel: Velocity;
  /** How firmly the last featured book sits in its place in the row. */
  seat: number;
  seatVel: Velocity;
  /** Seconds since the choice last moved. */
  sinceStep: number;
}

export function createRow(count: number, anchor: number): RowState {
  const zeros = (): number[] => Array.from({ length: count }, () => 0);
  return {
    selected: anchor,
    anchor,
    yaw: zeros().map((_, i) => (i === anchor ? 1 : 0)),
    arrived: zeros(),
    arrivedVel: zeros().map(() => ({ v: 0 })),
    pop: zeros(),
    offset: 0,
    offsetVel: { v: 0 },
    called: false,
    gate: 0,
    gateVel: { v: 0 },
    assemble: 0,
    assembleVel: { v: 0 },
    seat: 0,
    seatVel: { v: 0 },
    sinceStep: 1,
  };
}

/**
 * Display order (SPEC S-LAY-4): with N books and the last featured at position J, the last
 * floor((N - 2J - 1) / 2) books move to the front, so the featured ones stand near the middle.
 */
export function rowOrder(count: number, lastFeatured: number): number[] {
  const all = Array.from({ length: count }, (_, i) => i);
  const moved = Math.max(0, Math.floor((count - 2 * lastFeatured - 1) / 2));
  return moved ? [...all.slice(count - moved), ...all.slice(0, count - moved)] : all;
}

/** Resting x of every spine: packed with a gap, measured from the anchor book. */
export function restX(widths: number[], anchor: number, gap: number): number[] {
  const centres: number[] = [];
  let x = 0;
  for (const w of widths) {
    centres.push(x + w / 2);
    x += w + gap;
  }
  const origin = centres[anchor] ?? 0;
  return centres.map((c) => c - origin);
}

/** How far book i is pushed aside by the books that show their cover. */
export function pushAt(i: number, widths: number[], yaw: number[], slot: number): number {
  let push = 0;
  for (let n = 0; n < widths.length; n++) {
    if (n === i) continue;
    push += (i > n ? 1 : -1) * ((slot - widths[n]!) / 2) * yaw[n]!;
  }
  return push;
}

/** Eased share of the row slot that has been scrolled: 0 at the last featured book, 1 when the row is fully called for. */
export const rowCall = (past: number, t: RowTuning = ROW_DEFAULT): number => easeInOutQuad(clamp(past / t.span, 0, 1));

/** True when the row stands and takes the keys and the pointer. */
export const rowSettled = (s: RowState, past: number, t: RowTuning = ROW_DEFAULT): boolean => s.called && s.assemble > 0.6 && rowCall(past, t) >= t.assembleAt;

/** Moves the choice by a number of books. Refused when the last step was a moment ago. */
export function stepChoice(s: RowState, delta: number, t: RowTuning = ROW_DEFAULT): boolean {
  if (s.sinceStep < t.stepPause) return false;
  return choose(s, s.selected + delta);
}

export function choose(s: RowState, index: number): boolean {
  const next = clamp(Math.round(index), 0, s.yaw.length - 1);
  if (next === s.selected) return false;
  s.selected = next;
  s.sinceStep = 0;
  return true;
}

/**
 * Advances the row.
 * @param past scroll progress beyond the last featured book, 0..1
 * @param hovered position of the spine under the pointer, or -1
 * @returns true while something still moves
 */
export function stepRow(s: RowState, widths: number[], past: number, hovered: number, dtIn: number, t: RowTuning = ROW_DEFAULT, still = false): boolean {
  const dt = clamp(dtIn, 1e-4, 0.05);
  const call = rowCall(past, t);
  if (!s.called && call >= t.assembleAt) s.called = true;
  else if (s.called && call < t.releaseAt) s.called = false;
  s.sinceStep += dt;

  const before = s.assemble + s.offset + s.seat;
  const goal = s.called ? 1 : 0;
  if (still) {
    s.gate = s.assemble = s.seat = goal;
  } else {
    s.gate = smoothDamp(s.gate, goal, s.gateVel, t.gateTime, dt);
    s.assemble = smoothDamp(s.assemble, s.gate, s.assembleVel, t.assembleTime, dt);
    s.seat = smoothDamp(s.seat, goal, s.seatVel, goal ? 0.175 : 0.35, dt);
  }

  let moving = false;
  const x0 = restX(widths, s.anchor, t.gap);
  for (let i = 0; i < widths.length; i++) {
    // The cover turn: the chosen book only shows its cover while the row stands.
    const turn = i === s.selected ? 1 : 0;
    const y = still ? turn : s.yaw[i]! + (turn - s.yaw[i]!) * expFactor(1 / t.yawTime, dt);
    if (Math.abs(y - s.yaw[i]!) > 1e-5) moving = true;
    s.yaw[i] = Math.abs(turn - y) < 1e-4 ? turn : y;

    // Arrival: books near the anchor stand first, the far ones follow.
    const away = Math.min(Math.abs(i - s.anchor), 12) / 12;
    const time = Math.max(0.011, (0.025 + away * 0.425) * 0.7 * 0.4);
    const a = still ? s.gate : smoothDamp(s.arrived[i]!, s.gate, s.arrivedVel[i]!, time + 0.06 * Math.abs(i - s.anchor), dt);
    if (Math.abs(a - s.arrived[i]!) > 1e-5) moving = true;
    s.arrived[i] = a;

    const pop = i === hovered && i !== s.selected && s.called ? t.hoverPop : 0;
    const p = still ? pop : s.pop[i]! + (pop - s.pop[i]!) * expFactor(t.hoverRate, dt);
    if (Math.abs(p - s.pop[i]!) > 1e-4) moving = true;
    s.pop[i] = Math.abs(pop - p) < 1e-3 ? pop : p;
  }

  // The row slides so the chosen book stands in the middle.
  const want = s.called ? -(x0[s.selected]! + pushAt(s.selected, widths, s.yaw, t.slot)) : 0;
  s.offset = still ? want : smoothDamp(s.offset, want, s.offsetVel, t.offsetTime, dt);
  return moving || Math.abs(s.assemble + s.offset + s.seat - before) > 1e-5;
}

export interface RowPlace {
  x: number;
  /** 0 = below the picture, 1 = in its place. */
  rise: number;
  /** Forward of the row's own depth. */
  z: number;
  /** 0 = spine to the front, 1 = cover to the front, already shaped by `yawPower`. */
  turn: number;
}

/** Where book i stands this frame, in the row's own frame. */
export function placeAt(s: RowState, widths: number[], i: number, t: RowTuning = ROW_DEFAULT): RowPlace {
  const x0 = restX(widths, s.anchor, t.gap);
  const yaw = s.yaw[i]!;
  const near = 1 - Math.exp(-Math.abs(i - s.anchor) / 2.5);
  const a = s.arrived[i]!;
  // Far books come up late and fast, near ones early: the same curve the reference uses for the fall.
  const rise = 1 - (1 - a) * (near + (1 - near) * (1 - a) * (1 - a));
  return {
    x: x0[i]! + pushAt(i, widths, s.yaw, t.slot) + s.offset,
    rise: i === s.anchor ? 1 : rise,
    z: t.forward * yaw - t.back * (1 - yaw) * s.assemble + s.pop[i]!,
    turn: Math.pow(yaw, t.yawPower),
  };
}

/** How far the last featured book has moved from its featured pose into the row, 0..1. */
export function joinOf(s: RowState, past: number, t: RowTuning = ROW_DEFAULT): number {
  const T = clamp(past / t.span, 0, 1);
  const call = easeInOutQuad(T);
  return easeInOutQuad(clamp(T + (1 - T) * s.seat * Math.min(1, call / t.releaseAt), 0, 1));
}
