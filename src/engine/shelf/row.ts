/**
 * The row of spines (SPEC section 6): past the last featured book every book of the library stands side by
 * side, spine to the reader. The chosen one turns its cover to the front and the others make room for it,
 * like a coverflow. Only numbers are kept here; the shelf owns the books and the pointer.
 */
import { clamp, easeInOutQuad, expFactor, smoothDamp, smoothstep, type Velocity } from '../core/math';

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
  /** A row that stood fully starts to sink as soon as the eased scroll falls below this, in step with the scroll. */
  leaveAt: number;
  /** How much deeper the far books start than the near ones, in units of the near books' way up. */
  farDrop: number;
  /** Seconds for the last featured book to turn its cover when the choice changes. */
  anchorYawTime: number;
  /** A choice more than one place away is reached by a timed glide: seconds for the first place and for every further one, and the longest. */
  glideBase: number;
  glidePerPlace: number;
  glideMax: number;
  /** Seconds for a cover to follow the hand while the row is pulled or glides. */
  followYawTime: number;
  /** Each end of the row keeps one spine and this much inside the window, world units. */
  endRoom: number;
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
  spine: 0.96,
  depth: 15.75,
  forward: 8,
  back: 2,
  yawPower: 1.6,
  yawTime: 0.2,
  offsetTime: 0.26,
  span: 1,
  assembleAt: 0.28,
  releaseAt: 0.18,
  leaveAt: 0.96,
  farDrop: 4.38,
  anchorYawTime: 0.14,
  glideBase: 0.25,
  glidePerPlace: 0.05,
  glideMax: 0.9,
  followYawTime: 0.12,
  endRoom: 2,
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
  /** True from the moment the row stands until the scroll has all but left it: the choice shows its cover and takes keys. */
  settled: boolean;
  /** The row stood fully at least once since it was called. */
  activated: boolean;
  /** The row sinks in step with the scroll. */
  leaving: boolean;
  /** Eased scroll at which the sinking began, and the gate value it began from. */
  leaveAt: number;
  leaveFrom: number;
  /** Largest eased scroll since the row was called. */
  peak: number;
  yawVel: Velocity[];
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
  /** While a hand drags the row: how far it has pulled it sideways, world units. */
  drag: number;
  dragging: boolean;
  /** A timed glide to a choice more than one place away: where it started, how long it runs, how long it has run. */
  glide: { from: number; seconds: number; age: number } | null;
  /** Half the width of the window at the depth of the row, world units. 0 while unknown: then the row is not held at its ends. */
  window: number;
}

export function createRow(count: number, anchor: number): RowState {
  const zeros = (): number[] => Array.from({ length: count }, () => 0);
  return {
    selected: anchor,
    anchor,
    yaw: zeros(),
    yawVel: zeros().map(() => ({ v: 0 })),
    arrived: zeros(),
    arrivedVel: zeros().map(() => ({ v: 0 })),
    pop: zeros(),
    offset: 0,
    offsetVel: { v: 0 },
    called: false,
    settled: false,
    activated: false,
    leaving: false,
    leaveAt: 0,
    leaveFrom: 0,
    peak: 0,
    gate: 0,
    gateVel: { v: 0 },
    assemble: 0,
    assembleVel: { v: 0 },
    seat: 0,
    seatVel: { v: 0 },
    sinceStep: 1,
    drag: 0,
    dragging: false,
    glide: null,
    window: 0,
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
export const rowSettled = (s: RowState, _past?: number, _t: RowTuning = ROW_DEFAULT): boolean => s.settled;

/** Moves the choice by a number of books. Refused when the last step was a moment ago. */
export function stepChoice(s: RowState, delta: number, t: RowTuning = ROW_DEFAULT): boolean {
  if (s.sinceStep < t.stepPause) return false;
  return choose(s, s.selected + delta, t);
}

export function choose(s: RowState, index: number, t: RowTuning = ROW_DEFAULT): boolean {
  const next = clamp(Math.round(index), 0, s.yaw.length - 1);
  if (next === s.selected) return false;
  const places = Math.abs(next - s.selected);
  // Measured: a choice three places away is reached in about 0.4 s on a timed curve, not by the damper of a step.
  s.glide = places > 1 && s.settled ? { from: s.selected, seconds: clamp(t.glideBase + t.glidePerPlace * places, 0.3, t.glideMax), age: 0 } : null;
  s.selected = next;
  s.sinceStep = 0;
  return true;
}

/** The place in the row, with its fraction, that the resting coordinate `x` falls on. */
export function placeUnder(x0: number[], x: number): number {
  const last = x0.length - 1;
  if (last < 1 || x <= x0[0]!) return 0;
  if (x >= x0[last]!) return last;
  let i = 0;
  while (i < last - 1 && x > x0[i + 1]!) i++;
  return i + (x - x0[i]!) / (x0[i + 1]! - x0[i]!);
}

/** Zero slope and zero bend at both ends: a move that starts and ends without a jolt. */
const smootherstep = (u: number): number => {
  const k = clamp(u, 0, 1);
  return k * k * k * (k * (k * 6 - 15) + 10);
};

/**
 * How far the row may slide: each end keeps one spine and `endRoom` inside the window. Returns the largest and
 * the smallest offset. When the largest is the smaller of the two, the whole row fits and is centred instead.
 */
export function rowLimits(s: RowState, widths: number[], x0: number[], t: RowTuning = ROW_DEFAULT): { left: number; right: number } {
  const last = widths.length - 1;
  const half = (i: number): number => widths[i]! / 2 + (t.slot / 2 - widths[i]! / 2) * s.yaw[i]!;
  return {
    left: -s.window + widths[0]! + t.endRoom - (x0[0]! + pushAt(0, widths, s.yaw, t.slot) - half(0)),
    right: s.window - widths[last]! - t.endRoom - (x0[last]! + pushAt(last, widths, s.yaw, t.slot) + half(last)),
  };
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
  // Measured: the row is called at `assembleAt`. Once it stood fully (`leaveAt`) it starts to sink as soon as the
  // scroll turns back, in step with the scroll, and is let go below `releaseAt`.
  if (s.settled && call >= t.leaveAt) s.activated = true;
  if (s.called) s.peak = Math.max(s.peak, call);
  const edge = s.activated ? t.leaveAt : Math.min(t.leaveAt, s.peak - 0.1);
  if (s.called && call < edge && call >= t.releaseAt) {
    s.called = false;
    s.activated = false;
    s.leaving = true;
    s.leaveAt = call;
    s.leaveFrom = s.gate;
  } else if (call < t.releaseAt) {
    if (s.called) {
      s.leaveAt = Math.max(0.001, call);
      s.leaveFrom = s.gate;
    }
    s.called = false;
    s.activated = false;
    s.leaving = false;
    s.peak = 0;
  } else if (!s.called && call >= t.assembleAt && (!s.leaving || call >= Math.min(t.leaveAt + 0.02, s.leaveAt + 0.1))) {
    s.called = true;
    s.leaving = false;
    s.peak = call;
  }
  s.sinceStep += dt;
  /** Share of the row that still stands while it sinks with the scroll. */
  const ramp = s.called ? 1 : s.leaveAt > 0.001 ? clamp(call / s.leaveAt, 0, 1) : 0;

  const before = s.assemble + s.offset + s.seat;
  if (still) {
    s.gate = s.assemble = s.called ? 1 : 0;
    s.settled = s.called;
    s.seat = s.settled ? 1 : 0;
  } else {
    if (s.called) s.gate = smoothDamp(s.gate, 1, s.gateVel, t.gateTime, dt);
    else {
      s.gate = Math.min(s.gate, s.leaveFrom * ramp);
      // Below the lower threshold the row falls away by itself, so a scroll that rests there leaves no row hanging.
      if (call < t.releaseAt) s.gate = smoothDamp(s.gate, 0, s.gateVel, t.gateTime, dt);
      else s.gateVel.v = 0;
    }
    s.assemble = smoothDamp(s.assemble, s.gate, s.assembleVel, t.assembleTime, dt);
    if (!s.called) s.assemble = Math.min(s.assemble, ramp);
    if (s.assemble > 0.6 && call >= t.assembleAt) s.settled = true;
    else if (call < t.releaseAt) s.settled = false;
    s.seat = smoothDamp(s.seat, s.settled ? 1 : 0, s.seatVel, s.settled ? 0.175 : 0.35, dt);
  }

  let moving = false;
  const x0 = restX(widths, s.anchor, t.gap);
  // Where the row is asked to be: on the chosen book, moved by the hand that pulls it, or on its way in a glide.
  if (s.glide && (still || !s.settled)) s.glide = null;
  if (s.glide) {
    s.glide.age += dt;
    if (s.glide.age >= s.glide.seconds) s.glide = null;
    else moving = true;
  }
  const aim = !s.settled ? 0 : s.glide ? -(x0[s.glide.from]! + (x0[s.selected]! - x0[s.glide.from]!) * smootherstep(s.glide.age / s.glide.seconds)) : -x0[s.selected]! + s.drag;
  // Measured: while the row is pulled or glides, the cover turn travels with it. The book that passes the middle
  // shows its cover, its neighbours part of theirs.
  const follow = s.settled && !still && (s.dragging || s.glide !== null);
  const under = follow ? placeUnder(x0, -aim) : 0;
  for (let i = 0; i < widths.length; i++) {
    // The cover turn: the chosen book shows its cover only while the row stands. Measured: the last featured
    // book has a damper of its own, the others follow an exponential.
    const turn = follow ? smoothstep(0, 1, 1 - Math.abs(under - i)) : s.settled && i === s.selected ? 1 : 0;
    const y = still
      ? turn
      : follow
        ? smoothDamp(s.yaw[i]!, turn, s.yawVel[i]!, t.followYawTime, dt)
        : i === s.anchor
          ? smoothDamp(s.yaw[i]!, turn, s.yawVel[i]!, t.anchorYawTime, dt)
          : s.yaw[i]! + (turn - s.yaw[i]!) * expFactor(1 / t.yawTime, dt);
    if (Math.abs(y - s.yaw[i]!) > 1e-5) moving = true;
    s.yaw[i] = Math.abs(turn - y) < 1e-4 ? turn : clamp(y, 0, 1);

    // Arrival: books near the anchor stand first, the far ones follow.
    const away = Math.min(Math.abs(i - s.anchor), 12) / 12;
    const time = Math.max(0.011, (0.025 + away * 0.425) * 0.7 * 0.4);
    let a = still ? s.gate : smoothDamp(s.arrived[i]!, s.gate, s.arrivedVel[i]!, time, dt);
    if (!s.called) a = Math.min(a, ramp);
    if (Math.abs(a - s.arrived[i]!) > 1e-5) moving = true;
    s.arrived[i] = a;

    const pop = i === hovered && i !== s.selected && s.settled ? t.hoverPop : 0;
    const p = still ? pop : s.pop[i]! + (pop - s.pop[i]!) * expFactor(t.hoverRate, dt);
    if (Math.abs(p - s.pop[i]!) > 1e-4) moving = true;
    s.pop[i] = Math.abs(pop - p) < 1e-3 ? pop : p;
  }

  // The row slides so the chosen book stands in the middle. Measured: the aim is the resting place of the chosen
  // book alone; the push of the turning covers is not part of it, or the slide overshoots.
  // A hand that drags the row is followed closely.
  let want = aim;
  if (s.settled && s.window > 0 && widths.length > 1) {
    // Measured: each end of the row keeps a spine and a little more inside the window, so the first and the last
    // book are not brought to the middle. A row that fits the window is centred as a whole and does not slide.
    const { left, right } = rowLimits(s, widths, x0, t);
    want = right > left ? (left + right) / 2 : clamp(want, right, left);
  }
  if (s.glide && !still && want === aim) {
    // A glide is timed: the row is where the curve puts it.
    s.offset = want;
    s.offsetVel.v = 0;
  } else s.offset = still ? want : smoothDamp(s.offset, want, s.offsetVel, s.dragging ? 0.06 : t.offsetTime, dt);
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
export function placeAt(s: RowState, widths: number[], i: number, t: RowTuning = ROW_DEFAULT, blend = 1): RowPlace {
  const x0 = restX(widths, s.anchor, t.gap);
  const yaw = s.yaw[i]!;
  const d = Math.abs(i - s.anchor);
  const near = 1 - Math.exp(-d / 2.5);
  const a = s.arrived[i]!;
  // Measured: every book starts one screen below its place, the far ones deeper still, and the near ones come up first.
  const drop = 1 - a + t.farDrop * (1 - Math.exp(-d / 8)) * smoothstep(0.12 - (0.04 * Math.min(d, 12)) / 12, 1, 1 - a);
  const rise = 1 - drop * (near + (1 - near) * (1 - a) * (1 - a));
  return {
    x: x0[i]! + pushAt(i, widths, s.yaw, t.slot) + s.offset,
    rise: i === s.anchor ? 1 : rise,
    z: t.forward * yaw - t.back * (1 - yaw) * blend + s.pop[i]!,
    turn: Math.pow(yaw, t.yawPower),
  };
}

/**
 * The hand lets the row go. Measured: the book next to the chosen one is taken once the row was pulled past 55
 * percent of the way to it, or a quarter of the way in the direction of the pull; a flick above 250 px/s
 * carries the row on by 0.15 s of its speed, three books at most.
 * @param velocity sideways speed of the hand in world units per second
 * @param flick true when the hand was faster than the flick threshold
 * @returns true when the choice changed
 */
export function releaseRow(s: RowState, widths: number[], velocity: number, flick: boolean, t: RowTuning = ROW_DEFAULT): boolean {
  const pulled = s.drag + (flick ? velocity * 0.15 : 0);
  s.drag = 0;
  s.dragging = false;
  // Measured: the book the hand has brought to the middle is the choice, counted in the resting places of the
  // spines. Pulling the row to the right brings the books on the left to the middle.
  const x0 = restX(widths, s.anchor, t.gap);
  const pick = clamp(Math.round(placeUnder(x0, x0[s.selected]! - pulled)), 0, widths.length - 1);
  if (pick === s.selected) return false;
  // The row is there already: no glide, the damper settles the rest.
  s.selected = pick;
  s.glide = null;
  s.sinceStep = 0;
  return true;
}

/** How far the last featured book has moved from its featured pose into the row, 0..1. */
export function joinOf(s: RowState, past: number, t: RowTuning = ROW_DEFAULT): number {
  const T = clamp(past / t.span, 0, 1);
  const call = easeInOutQuad(T);
  return easeInOutQuad(clamp(T + (1 - T) * s.seat * Math.min(1, call / t.releaseAt), 0, 1));
}
