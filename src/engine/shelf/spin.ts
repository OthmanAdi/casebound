/**
 * Turning a closed book by hand (SPEC section 6). The book follows the pointer through a spring, coasts after
 * it is let go, levels its pitch when it was left more than a quarter turn off, and its trailing cover lifts
 * while it turns. Only numbers are kept here; the shelf owns the pointer and the book.
 */
import { DEG, clamp } from '../core/math';

export interface SpinTuning {
  /** Radians per pixel of mouse travel. */
  gain: number;
  /** Radians per pixel of touch travel. */
  touchGain: number;
  /** Largest coasting step, radians per 60 Hz frame. */
  inertiaCap: number;
  /** Share of the coasting speed kept per 60 Hz frame. */
  friction: number;
  /** Spring that pulls the drawn book to where the hand put it, while nothing presses. */
  stiffness: number;
  damping: number;
  /** Cover lift per unit of turning speed (radians per radian per second). */
  flap: number;
  /** Largest lift the turning speed can ask for, radians. */
  flapLimit: number;
  /** How fast a cover follows its lift, per second. */
  flapRate: number;
  /** Stop of a cover, radians. */
  coverMax: number;
  /** Seconds after a mouse release before the pitch may level. */
  levelDelay: number;
  /** Seconds the levelling takes. */
  levelSeconds: number;
}

/**
 * A cover of the reference is a chain of five bones, each turning 0.8 of the one before it, and its controller
 * works in the angle of the first: the board ends up 3.36 times as far open as that number says. Our board is one
 * piece, so the lift is asked for in the angle of the board. Measured at 3 rad/s: the board of the reference
 * stands 15 degrees open; with the plain number ours stood 4.6.
 */
const COVER_CHAIN = 1 + 0.8 + 0.8 ** 2 + 0.8 ** 3 + 0.8 ** 4;

export const SPIN_DEFAULT: SpinTuning = {
  gain: 0.0084375,
  touchGain: 0.01125,
  inertiaCap: 0.42,
  friction: 0.95,
  stiffness: 480,
  damping: 42,
  flap: 0.0592 * COVER_CHAIN,
  // 28 degrees on the first bone are 94 on the board, past its stop: the stop is the limit.
  flapLimit: 80 * DEG,
  flapRate: 40,
  coverMax: 80 * DEG,
  levelDelay: 2,
  levelSeconds: 5,
};

export interface SpinState {
  /** Where the hand, or the coasting, has put the book: pitch about X and yaw about Y, from rest. */
  pitch: number;
  yaw: number;
  /** What is drawn. It follows through the spring. */
  shownPitch: number;
  shownYaw: number;
  velPitch: number;
  velYaw: number;
  /** Coasting step per 60 Hz frame. */
  coastPitch: number;
  coastYaw: number;
  /** Smoothed turning speed of the drawn book, radians per second. */
  ratePitch: number;
  rateYaw: number;
  /** Smoothed speed of the hand, radians per second. Stiffens the spring while pressed. */
  hand: number;
  pressed: boolean;
  touch: boolean;
  /** Seconds until the pitch may start to level. Negative: not armed. */
  levelIn: number;
  /** Seconds the levelling has run. Negative: not levelling. */
  levelFor: number;
  /** Lift of the front and back cover, radians, and their speeds. */
  front: number;
  frontVel: number;
  back: number;
  backVel: number;
  lastPitch: number;
  lastYaw: number;
}

export const createSpin = (pitch = 0, yaw = 0): SpinState => ({
  pitch,
  yaw,
  shownPitch: pitch,
  shownYaw: yaw,
  velPitch: 0,
  velYaw: 0,
  coastPitch: 0,
  coastYaw: 0,
  ratePitch: 0,
  rateYaw: 0,
  hand: 0,
  pressed: false,
  touch: false,
  levelIn: -1,
  levelFor: -1,
  front: 0,
  frontVel: 0,
  back: 0,
  backVel: 0,
  lastPitch: pitch,
  lastYaw: yaw,
});

/** An angle brought into -pi..pi. */
export const wrapAngle = (a: number): number => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

export interface SpinGrab {
  pitch: number;
  yaw: number;
  /** -1 when the book was grabbed upside down, so that it still turns with the hand. */
  flip: 1 | -1;
}

/** The pointer takes hold of the book. */
export function grabSpin(s: SpinState, touch: boolean): SpinGrab {
  s.pressed = true;
  s.touch = touch;
  s.coastPitch = s.coastYaw = 0;
  s.levelIn = s.levelFor = -1;
  return { pitch: s.pitch, yaw: s.yaw, flip: Math.abs(wrapAngle(s.pitch)) > Math.PI / 2 ? -1 : 1 };
}

/** The pointer has moved `dx`, `dy` pixels since it took hold. A finger turns the book only sideways. */
export function dragSpin(s: SpinState, grab: SpinGrab, dx: number, dy: number, t: SpinTuning = SPIN_DEFAULT): void {
  const g = s.touch ? t.touchGain : t.gain;
  s.yaw = grab.yaw + dx * g * grab.flip;
  if (!s.touch) s.pitch = grab.pitch + dy * g;
}

/** The pointer lets go with a speed in pixels per second. The book coasts on from there. */
export function releaseSpin(s: SpinState, grab: SpinGrab, vx: number, vy: number, t: SpinTuning = SPIN_DEFAULT): void {
  const g = s.touch ? t.touchGain : t.gain;
  s.pressed = false;
  s.coastYaw = (vx * g * grab.flip) / 60;
  s.coastPitch = s.touch ? 0 : (vy * g) / 60;
  const size = Math.hypot(s.coastYaw, s.coastPitch);
  if (size > t.inertiaCap) {
    s.coastYaw *= t.inertiaCap / size;
    s.coastPitch *= t.inertiaCap / size;
  } else if (size <= 0.001) s.coastYaw = s.coastPitch = 0;
  s.levelIn = s.touch ? 0.6 : t.levelDelay;
  s.levelFor = -1;
}

/** One critically damped step of a cover toward its lift. */
function follow(angle: number, vel: number, target: number, rate: number, dt: number, max: number): [number, number] {
  const err = angle - target;
  const n = vel + rate * err;
  const decay = Math.exp(-rate * dt);
  let a = target + (err + n * dt) * decay;
  let v = (vel - rate * n * dt) * decay;
  if (a <= 0) {
    a = 0;
    v = Math.max(0, v);
  } else if (a >= max) {
    a = max;
    v = Math.min(0, v);
  }
  return [a, v];
}

/**
 * Advances the spin by `dt` seconds.
 * @returns true while something still moves and another frame is needed
 */
export function stepSpin(s: SpinState, dtIn: number, t: SpinTuning = SPIN_DEFAULT): boolean {
  const dt = clamp(dtIn, 1e-4, 0.1);
  const frames = 60 * dt;

  // Coasting: a step per frame that shrinks by the friction, written so the frame rate does not change it.
  let coasting = !s.pressed && Math.abs(s.coastPitch) + Math.abs(s.coastYaw) > 0.001;
  if (coasting) {
    const kept = Math.pow(t.friction, frames);
    const steps = (1 - kept) / (1 - t.friction);
    s.pitch += s.coastPitch * steps;
    s.yaw += s.coastYaw * steps;
    s.coastPitch *= kept;
    s.coastYaw *= kept;
  } else if (!s.pressed) s.coastPitch = s.coastYaw = 0;

  // Levelling: a book left more than a quarter turn off level (any amount, after a finger) comes back by itself.
  if (!s.pressed && s.levelIn >= 0) {
    s.levelIn -= dt;
    if (s.levelIn < 0) {
      s.levelIn = -1;
      if (Math.abs(wrapAngle(s.pitch)) > (s.touch ? 0.01 : Math.PI / 2)) s.levelFor = 0;
    }
  }
  if (!s.pressed && s.levelFor >= 0) {
    s.levelFor += dt;
    const e = Math.min(1, s.levelFor / (s.touch ? t.levelSeconds / 2 : t.levelSeconds));
    s.pitch -= wrapAngle(s.pitch) * (1 - Math.pow(1 - Math.pow(e, 5), frames));
    if (e >= 1) {
      s.pitch -= wrapAngle(s.pitch);
      s.levelFor = -1;
      s.coastPitch = 0;
    }
  }

  // The drawn book follows through a spring. A fast hand stiffens it, so the book does not trail far behind.
  let k = t.stiffness;
  let c = t.damping;
  if (s.pressed) {
    const moved = Math.hypot(s.pitch - s.lastPitch, s.yaw - s.lastYaw) / dt;
    s.hand += (moved - s.hand) * (1 - Math.exp(-10 * dt));
    const r = Math.min(1, s.hand / 8);
    k = 900 + 2700 * r * r * (3 - 2 * r);
    c = 2.2 * Math.sqrt(k);
  } else s.hand = 0;
  s.lastPitch = s.pitch;
  s.lastYaw = s.yaw;
  const beforePitch = s.shownPitch;
  const beforeYaw = s.shownYaw;
  const steps = Math.min(64, Math.ceil(dt / (s.pressed ? 1 / 240 : 1 / 120)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    s.velPitch = clamp(s.velPitch + (k * (s.pitch - s.shownPitch) - c * s.velPitch) * h, -16, 16);
    s.velYaw = clamp(s.velYaw + (k * (s.yaw - s.shownYaw) - c * s.velYaw) * h, -16, 16);
    s.shownPitch += s.velPitch * h;
    s.shownYaw += s.velYaw * h;
  }

  // Turning speed, smoothed, for the covers.
  const blend = 1 - Math.exp(-11 * dt);
  s.ratePitch += ((s.shownPitch - beforePitch) / dt - s.ratePitch) * blend;
  s.rateYaw += ((s.shownYaw - beforeYaw) / dt - s.rateYaw) * blend;
  let rate = Math.hypot(s.ratePitch, s.rateYaw);
  if (!s.pressed && rate < 0.042) {
    s.ratePitch = s.rateYaw = 0;
    rate = 0;
  }

  // Covers: the one that trails the turn lifts off the pages. The other stays shut.
  coasting = !s.pressed && Math.abs(s.coastPitch) + Math.abs(s.coastYaw) > 0.001;
  const lively = s.pressed || coasting || rate > 0.028;
  const mean = (s.ratePitch + s.rateYaw) / 2;
  const frontGoal = lively ? clamp(t.flap * mean, -t.flapLimit, t.flapLimit) : 0;
  const backGoal = lively ? clamp(t.flap * -mean * 1.5, -t.flapLimit, t.flapLimit) : 0;
  [s.front, s.frontVel] = follow(s.front, s.frontVel, frontGoal, t.flapRate, dt, t.coverMax);
  [s.back, s.backVel] = follow(s.back, s.backVel, backGoal, t.flapRate, dt, t.coverMax);
  if (!lively && s.front < 1e-4 && s.back < 1e-4) s.front = s.back = s.frontVel = s.backVel = 0;

  const settled = Math.abs(s.pitch - s.shownPitch) < 1e-4 && Math.abs(s.yaw - s.shownYaw) < 1e-4 && Math.abs(s.velPitch) < 1e-3 && Math.abs(s.velYaw) < 1e-3;
  if (settled && !s.pressed) {
    s.shownPitch = s.pitch;
    s.shownYaw = s.yaw;
    s.velPitch = s.velYaw = 0;
  }
  return s.pressed || coasting || s.levelIn >= 0 || s.levelFor >= 0 || !settled || s.front > 0 || s.back > 0 || rate > 0;
}
