/**
 * The corner curl of a leaf (SPEC S-RD-11): the page under the pointer lifts its corner a little, a page held by
 * a hand folds its grabbed region over, and a leaf let go carries a curl that relaxes as it lands.
 *
 * The curl is a roll of the sheet past a slanted line across the page. This module holds the two pure parts:
 * how strong the curl is from frame to frame (`stepCurl`), and the shape of the roll (`fillRoll`, `rollAt`).
 * The leaf applies the roll to its vertices.
 */
import { DEG, clamp, smoothDamp, smoothstep, type Velocity } from '../core/math';

export interface CurlTuning {
  /** Base strength in radians of roll over one span. 0 turns the curl off. */
  amount: number;
  /** Share of the base strength under a resting pointer. */
  hover: number;
  /** Share while a hand holds the page. */
  drag: number;
  /** Share a leaf carries in the air after it is let go. */
  flight: number;
  /** Exponent of the roll: below 1 the sheet turns up early past the fold line. */
  power: number;
  /** Slant of the fold line in degrees with the pointer at the top or bottom edge of the page. */
  tilt: number;
  /** Least slant of the fold line on a leaf in the air, in degrees. */
  flightTilt: number;
  /** Where the fold line crosses the middle of the page, as a share of its width from the spine. */
  pivot: number;
  /** Length over which the roll builds up, in page widths. */
  span: number;
  /** How much longer the span gets for a grab at the spine: span x (1 + inner). */
  inner: number;
  /** Share of the strength lost for a grab at the spine. */
  innerLoss: number;
  /** Approach per 60 Hz frame of the strength while held, hovered, in the air and relaxing. */
  dragRate: number;
  hoverRate: number;
  flightRate: number;
  relaxRate: number;
  /** Relaxing rate of a sheet another leaf is about to cover. */
  handoffRate: number;
  /** Approach per 60 Hz frame of the slant, while held and otherwise. */
  dragTiltRate: number;
  tiltRate: number;
  /** Seconds for the drawn curl to rise to a higher strength, and to fall to a lower one. */
  rise: number;
  fall: number;
  /** A leaf in the air relaxes its curl between these shares of its turn. */
  fadeFrom: number;
  fadeTo: number;
  /** Extra strength early in the turn, gone between these shares of the turn. */
  boost: number;
  boostFrom: number;
  boostTo: number;
  /** Near edge-on the curl fades: it is whole once |cos| of the leaf angle passes this. */
  edge: number;
  /** How far the outer half of a held leaf falls over when it stands near upright, radians at the free edge. 0 turns it off. */
  flop: number;
  /** Approach per 60 Hz frame of that fall. */
  flopRate: number;
  /** The fall acts within this share of the turn around upright. */
  flopZone: number;
  /** Seconds for it to go once the leaf is let go. */
  flopFade: number;
}

/** Measured on the reference (S-RD-11). The span was 32.4 on a page 15.6 wide. */
export const CURL_DEFAULT: CurlTuning = {
  amount: 7.02,
  hover: 0.28,
  drag: 1.82,
  flight: 0.84,
  power: 0.86,
  tilt: 31.5,
  flightTilt: 30,
  pivot: 0.74,
  span: 32.4 / 15.6,
  inner: 1.2,
  innerLoss: 0.55,
  dragRate: 0.04,
  hoverRate: 0.06,
  flightRate: 0.1,
  relaxRate: 0.05,
  handoffRate: 0.18,
  dragTiltRate: 0.15,
  tiltRate: 0.3,
  rise: 0.1,
  fall: 0.06,
  fadeFrom: 0.6,
  fadeTo: 0.9,
  boost: 0.5,
  boostFrom: 0.35,
  boostTo: 0.5,
  edge: 0.17,
  flop: 1.6,
  flopRate: 0.18,
  flopZone: 0.28,
  flopFade: 0.14,
};

/** A leaf counts as in the air once it has been this far from both sides, in radians, at this speed per 60 Hz frame. */
const AIR_ANGLE = 0.15;
const AIR_SPEED = 0.02;
/** Below this strength a relaxing curl is flat. */
const FLAT = 0.01;

/** What the leaf needs to draw the roll. */
export interface CurlShape {
  /** Radians of roll reached one span past the fold line. The roll itself stops at a half turn. */
  amount: number;
  /** Slant of the fold line in radians. Positive lifts the upper corner. */
  tilt: number;
  /** Span in page widths. */
  span: number;
  power: number;
  pivot: number;
  /** Which face the corner lifts toward: 1 = the front of the leaf, -1 = its back. Always the side of the reader. */
  lift: 1 | -1;
}

export interface CurlState {
  /** Strength the curl is heading for, before the grab position and the turn weigh in. */
  raw: number;
  /** Strength that is drawn, before the edge-on fade. */
  shown: number;
  readonly speed: Velocity;
  /** Slant of the fold line in radians. */
  tilt: number;
  /** How near the spine the page is held, 0 (fore-edge) to 1. */
  inner: number;
  /** True from the moment the leaf moves by itself in the air until it is nearly down. */
  flying: boolean;
  /** True while the flight started from a hand. */
  thrown: boolean;
  readonly shape: CurlShape;
}

export const createCurl = (): CurlState => ({
  raw: 0,
  shown: 0,
  speed: { v: 0 },
  tilt: 0,
  inner: 0,
  flying: false,
  thrown: false,
  shape: { amount: 0, tilt: 0, span: CURL_DEFAULT.span, power: CURL_DEFAULT.power, pivot: CURL_DEFAULT.pivot, lift: 1 },
});

export function resetCurl(c: CurlState): void {
  c.raw = c.shown = c.speed.v = c.tilt = c.inner = 0;
  c.flying = c.thrown = false;
  c.shape.amount = 0;
}

export interface CurlInput {
  /** Page progress of the opening, 0..1. The curl grows with the book lying open. */
  pages: number;
  /** A hand holds the leaf. */
  held: boolean;
  /** The pointer rests over the leaf. */
  hovered: boolean;
  /** Another leaf is about to lie on this one. */
  covered: boolean;
  /** Where the pointer is on the page: 0 at the spine to 1 at the fore-edge, and 0 at the foot to 1 at the head. */
  grabU: number;
  grabV: number;
  /** Pointer height in the window, -1 at the bottom to 1 at the top. */
  pointerY: number;
  /** Simulated angle of the leaf in radians, its speed in radians per 60 Hz frame, and the side it heads for. */
  angle: number;
  velocity: number;
  target: 0 | 1 | null;
  /** Angle that is drawn. */
  shown: number;
}

/** Advances the curl of one leaf by `dt` seconds and writes the roll to draw into `c.shape`. */
export function stepCurl(c: CurlState, i: CurlInput, dt: number, t: CurlTuning = CURL_DEFAULT): void {
  const n = 60 * Math.min(dt, 0.05);
  const toward = (rate: number): number => 1 - Math.pow(1 - clamp(rate, 0, 1), n);
  const base = t.amount * i.pages;
  const turn = clamp(i.shown / Math.PI, 0, 1);
  /** Share of the way to the side the leaf heads for. */
  const done = i.target === 0 ? 1 - turn : turn;
  const up = i.angle > AIR_ANGLE && i.angle < Math.PI - AIR_ANGLE;

  if (i.held) {
    c.flying = false;
    c.thrown = true;
  } else if (i.hovered && up) {
    // Measured: a leaf the pointer rests on is not a leaf in the air, however it got there. It shows the lift of
    // a resting pointer; let alone again while still up, it takes its flight back.
    c.flying = false;
  } else if (!c.flying) {
    // Let go in the air, or moving fast enough by itself.
    if (i.pages > 0.98 && i.target !== null && up && (c.thrown || Math.abs(i.velocity) > AIR_SPEED) && done < t.fadeTo) c.flying = true;
    else c.thrown = false;
  } else if (done >= t.fadeTo || i.target === null) {
    // Nearly down: the curl has relaxed, and the pointer may lift the corner again.
    c.flying = c.thrown = false;
    c.raw = 0;
  }

  // While the sheet is flat the fold line can be anywhere: it starts where the pointer is.
  const flat = c.shown < FLAT;
  const turnTo = (rate: number): number => (flat ? 1 : toward(rate));
  let goal: number;
  if (i.held) {
    c.raw += (base * t.drag - c.raw) * toward(t.dragRate);
    c.tilt += ((i.grabV - 0.5) * 2 * t.tilt * DEG - c.tilt) * turnTo(t.dragTiltRate);
    c.inner += (1 - i.grabU - c.inner) * turnTo(t.dragTiltRate);
    goal = c.raw * (1 - t.innerLoss * c.inner);
  } else if (c.flying) {
    c.raw += (base * t.drag - c.raw) * toward(t.flightRate);
    const slant = (i.pointerY < 0 ? -1 : 1) * Math.max(t.flightTilt, Math.abs(i.pointerY * t.tilt)) * DEG;
    c.tilt += (slant - c.tilt) * turnTo(t.tiltRate);
    c.inner += (0 - c.inner) * turnTo(t.tiltRate);
    goal = c.raw * t.flight * (1 - smoothstep(t.fadeFrom, t.fadeTo, done)) * (1 + t.boost * (1 - smoothstep(t.boostFrom, t.boostTo, done)));
  } else if (i.hovered) {
    const top = base * t.hover;
    c.raw = c.raw > top ? top : c.raw + (top - c.raw) * toward(t.hoverRate);
    c.tilt += ((i.grabV - 0.5) * 2 * t.tilt * DEG - c.tilt) * turnTo(t.tiltRate);
    c.inner += (1 - i.grabU - c.inner) * turnTo(t.tiltRate);
    goal = c.raw * (1 - t.innerLoss * c.inner);
  } else {
    c.raw -= c.raw * toward(i.covered ? t.handoffRate : t.relaxRate);
    if (c.raw < FLAT) c.raw = 0;
    goal = c.raw * (1 - t.innerLoss * c.inner);
  }

  // Measured: only a leaf in the air eases up to a stronger curl. Under a resting pointer or a hand the strength
  // itself is already a slow approach, and easing it again made the corner lift a tenth of a second late.
  // A weaker curl is eased to in every case, so the fold does not jump when the leaf changes hands.
  const step = Math.min(dt, 1 / 30);
  if (goal > c.shown && !c.flying) {
    c.shown = goal;
    c.speed.v = 0;
  } else c.shown = goal === c.shown ? goal : smoothDamp(c.shown, goal, c.speed, goal > c.shown ? t.rise : t.fall, step);
  if (goal === 0 && c.shown < FLAT) c.shown = c.speed.v = 0;

  // Edge-on the roll would flip from one face to the other, so it fades out there.
  const facing = Math.abs(Math.cos(i.shown));
  const fade = c.flying && !c.thrown ? facing : smoothstep(0, t.edge, facing);
  const s = c.shape;
  s.amount = c.shown * fade;
  s.tilt = c.tilt;
  s.span = t.span * (1 + t.inner * c.inner);
  s.power = t.power;
  s.pivot = t.pivot;
  s.lift = Math.cos(i.shown) >= 0 ? 1 : -1;
}

/** True when the leaf shows no curl and is heading for none. */
export const curlFlat = (c: CurlState): boolean => c.raw === 0 && c.shown === 0;

// ---------------------------------------------------------------- the flop of a held leaf (SPEC S-RD-10)

export interface FlopState {
  /** Which way the outer half has fallen: -1 = back toward the right, 1 = over to the left. */
  value: number;
  /** The value when the leaf was let go, and the seconds since. */
  from: number;
  age: number;
  /** What the sheet shows: radians at the free edge, positive toward the left. */
  bend: number;
}

export const createFlop = (): FlopState => ({ value: 0, from: 0, age: 0, bend: 0 });

export function resetFlop(f: FlopState): void {
  f.value = f.from = f.age = f.bend = 0;
}

/**
 * A leaf held near upright is limp: its outer half falls to the side the hand has pulled it to, and flops over
 * as the hand crosses the middle. `turn` is the drawn turn of the leaf, 0..1, and `pulled` the angle the hand
 * asks for in radians, or null once the leaf is let go. Then the fall goes within a few frames.
 */
export function stepFlop(f: FlopState, turn: number, pulled: number | null, dt: number, t: CurlTuning = CURL_DEFAULT): void {
  if (pulled !== null) {
    const goal = (1 - smoothstep(0, 1, Math.abs(turn - 0.5) / Math.max(1e-3, t.flopZone))) * Math.tanh(6 * (pulled - Math.PI / 2));
    f.value += (goal - f.value) * (1 - Math.pow(1 - clamp(t.flopRate, 0, 1), 60 * Math.min(dt, 0.05)));
    f.from = f.value;
    f.age = 0;
  } else if (f.from !== 0) {
    f.age += dt;
    f.value = t.flopFade > 0 ? f.from * (1 - smoothstep(0, t.flopFade, f.age)) : 0;
    if (f.age >= t.flopFade) f.value = f.from = 0;
  }
  // Lying near a stack the sheet has nowhere to fall.
  f.bend = f.value * t.flop * smoothstep(0.08, 0.3, Math.min(turn, 1 - turn));
}

// ---------------------------------------------------------------- the roll

/** Values stored per node of a roll table: distance along the fold direction, lift, angle. */
export const ROLL_STRIDE = 3;

/** Angle the sheet has turned through at a distance past the fold line. It stops at a half turn, folded flat back. */
export const rollAngle = (distance: number, amount: number, power: number, span: number): number =>
  distance <= 0 || span <= 0 ? 0 : Math.min(amount * Math.pow(Math.min(distance / span, 1), power), Math.PI);

/**
 * Integrates the roll from the fold line out to `reach` in `steps` equal steps and writes `steps + 1` nodes into
 * `out` (stride 3). A point of the flat page at distance d past the fold line ends up `x` along the fold direction
 * and `y` above the page. The path has the length of the page it rolls up: paper does not stretch.
 */
export function fillRoll(out: Float32Array, steps: number, reach: number, amount: number, power: number, span: number): void {
  const h = reach / steps;
  let x = 0;
  let y = 0;
  out[0] = out[1] = out[2] = 0;
  for (let k = 1; k <= steps; k++) {
    const a = rollAngle((k - 0.5) * h, amount, power, span);
    x += Math.cos(a) * h;
    y += Math.sin(a) * h;
    const o = k * ROLL_STRIDE;
    out[o] = x;
    out[o + 1] = y;
    out[o + 2] = rollAngle(k * h, amount, power, span);
  }
}

/** The roll at one distance, integrated directly. For tests and single lookups. */
export function rollAt(distance: number, amount: number, power: number, span: number, steps = 256): { x: number; y: number; angle: number } {
  if (distance <= 0) return { x: distance, y: 0, angle: 0 };
  const table = new Float32Array((steps + 1) * ROLL_STRIDE);
  fillRoll(table, steps, distance, amount, power, span);
  const o = steps * ROLL_STRIDE;
  return { x: table[o]!, y: table[o + 1]!, angle: table[o + 2]! };
}
