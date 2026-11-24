/**
 * How a released leaf moves. Only its angle is simulated: 0 = lying on the right, pi = lying on the left.
 * The leaf accelerates toward its target side, reaches a steady speed, then brakes as it lands (SPEC S-RD-8).
 * Measured on the reference: about 0.75 s for the visible turn, then a slow settle (S-RD-9).
 */

export interface LeafTuning {
  /** Push toward the target per normalised frame. */
  accel: number;
  /** Base damping share per normalised frame. */
  damping: number;
  /** Extra damping at the landing, added with the square of the closeness. */
  landing: number;
  /** Angle before the target where the landing brake starts, as a share of pi. */
  landingZone: number;
  /** How fast the drawn angle follows the simulated one: remaining share per normalised frame. */
  follow: number;
  /** Pull toward the nearer side when the leaf has no target. */
  gravity: number;
  /** Extra steady pull inside the landing zone. 0 matches the measured turn, which creeps down over seconds. */
  settle: number;
  /** Speed a button-triggered turn starts with, radians per normalised frame. */
  kick: number;
  restAngle: number;
  restSpeed: number;
}

export const LEAF_DEFAULT: LeafTuning = {
  accel: 0.008,
  damping: 0.4 * 0.328,
  landing: 0.55,
  landingZone: 0.3,
  follow: 0.15,
  gravity: 0.003,
  settle: 0,
  kick: 0.08,
  restAngle: 0.005,
  restSpeed: 5e-4,
};

export interface LeafMotion {
  /** Simulated angle in radians, 0..pi. */
  angle: number;
  /** Radians per normalised frame (1/60 s). */
  velocity: number;
  /** Angle that is drawn. Trails the simulated one slightly. */
  shown: number;
  /** Side the leaf is heading for, or null when it only falls under gravity. */
  target: 0 | 1 | null;
  resting: boolean;
}

export const createLeafMotion = (side: 0 | 1): LeafMotion => ({ angle: side * Math.PI, velocity: 0, shown: side * Math.PI, target: side, resting: true });

/** Advances the leaf by `dt` seconds. */
export function stepLeaf(m: LeafMotion, dt: number, t: LeafTuning = LEAF_DEFAULT): void {
  const n = 60 * Math.min(dt, 0.05);
  if (m.resting) return;
  if (m.target === null) {
    const toward = m.angle > Math.PI / 2 ? 1 : -1;
    m.velocity += t.gravity * Math.sin(Math.min(Math.PI - m.angle, m.angle) + 0.05) * toward * n;
    m.velocity *= Math.pow(0.985, n);
  } else {
    const goal = m.target * Math.PI;
    const dist = Math.abs(goal - m.angle);
    const sign = goal > m.angle ? 1 : -1;
    m.velocity += t.accel * sign * Math.sin(Math.min(dist, Math.PI / 2)) * n;
    const closeness = 1 - Math.min(dist / (t.landingZone * Math.PI), 1);
    m.velocity += t.settle * sign * closeness * n;
    const loss = Math.min(0.98, t.damping + closeness * closeness * t.landing);
    m.velocity *= Math.pow(1 - loss, n);
  }
  m.angle += m.velocity * n;
  if (m.angle <= 0) {
    m.angle = 0;
    m.velocity = Math.max(0, m.velocity) * 0.2;
  } else if (m.angle >= Math.PI) {
    m.angle = Math.PI;
    m.velocity = Math.min(0, m.velocity) * 0.2;
  }
  m.shown += (m.angle - m.shown) * (1 - Math.pow(t.follow, n));
  const goal = m.target === null ? (m.angle > Math.PI / 2 ? Math.PI : 0) : m.target * Math.PI;
  if (Math.abs(goal - m.angle) < t.restAngle && Math.abs(m.velocity) < t.restSpeed && Math.abs(m.shown - m.angle) < t.restAngle) {
    m.angle = m.shown = goal;
    m.velocity = 0;
    m.resting = true;
  }
}

/** Starts a turn toward a side. `kick` is the starting speed in radians per normalised frame. */
export function sendLeaf(m: LeafMotion, side: 0 | 1, kick = LEAF_DEFAULT.kick): void {
  m.target = side;
  m.resting = false;
  m.velocity += kick * (side === 1 ? 1 : -1);
}

/**
 * A leaf let go by a hand starts from rest, and is thrown on once it stands past upright on its way to the other
 * stack: measured on the reference, its speed is then set to the starting speed of a button turn, whatever it
 * was. Call after `stepLeaf` while the throw is still to come.
 * @returns true once the leaf has been thrown, or can no longer be
 */
export function throwLeaf(m: LeafMotion, side: 0 | 1, kick = LEAF_DEFAULT.kick): boolean {
  if (m.target !== side || m.resting) return true;
  if (side === 1 ? m.angle < Math.PI / 2 : m.angle > Math.PI / 2) return false;
  m.velocity = kick * (side === 1 ? 1 : -1);
  return true;
}

/** Share of a turn at which the sheet starts to leave its stack, and the share over which it travels to the other. */
const SHEET_FROM = 0.03;
const SHEET_SPAN = 0.87;

/**
 * Where the sheet of a turning leaf stands, 0 (on the right stack) to 1, for a drawn turn of 0..1. Measured on the
 * reference: the sheet eases off its stack, moves fastest near upright and lies down by nine tenths of the turn.
 * The angle creeps on for seconds after that; the sheet does not.
 */
export function sheetTurn(turn: number): number {
  const t = Math.min(Math.max((turn - SHEET_FROM) / SHEET_SPAN, 0), 1);
  return t * t * (3 - 2 * t);
}
