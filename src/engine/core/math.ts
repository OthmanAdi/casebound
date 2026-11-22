/**
 * Motion primitives. Every animated value in the engine goes through one of these, so the feel of the whole
 * system is tuned in one place. All of them take delta time in seconds and are frame-rate independent.
 * SPEC ids refer to research/SPEC.md.
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const saturate = (x: number): number => clamp(x, 0, 1);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, x: number): number => (a === b ? 0 : (x - a) / (b - a));

/** Cubic smoothstep, clamped. */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = saturate(invLerp(e0, e1, x));
  return t * t * (3 - 2 * t);
}

export const easeInQuad = (t: number): number => t * t;
export const easeOutQuad = (t: number): number => 1 - (1 - t) * (1 - t);
export const easeInOutQuad = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const cosineInOut = (t: number): number => 0.5 - 0.5 * Math.cos(Math.PI * t);

/** Asymmetric S-curve used for the page reveal: slow start, long soft landing (S-RD-1). */
export const powerSigmoid = (t: number, a = 2.4, b = 1.1): number => {
  const s = saturate(t);
  const up = Math.pow(s, a);
  const down = Math.pow(1 - s, b);
  return up + down === 0 ? 0 : up / (up + down);
};

/** Fraction to move toward a target this frame for an exponential approach with the given rate per second. */
export const expFactor = (ratePerSecond: number, dt: number): number => 1 - Math.exp(-ratePerSecond * dt);

/** The same idea expressed as "k per frame at 60 fps", corrected for the real frame time. */
export const frameFactor = (kPer60HzFrame: number, dt: number): number => 1 - Math.pow(1 - kPer60HzFrame, dt * 60);

export const approach = (current: number, target: number, ratePerSecond: number, dt: number): number =>
  current + (target - current) * expFactor(ratePerSecond, dt);

export interface Velocity {
  v: number;
}

/**
 * Critically damped smoothing toward a target (the classic game-engine "smooth damp").
 * `smoothTime` is roughly the time to reach the target. Never overshoots.
 */
export function smoothDamp(current: number, target: number, vel: Velocity, smoothTime: number, dt: number): number {
  const st = Math.max(1e-4, smoothTime);
  const omega = 2 / st;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (vel.v + omega * change) * dt;
  vel.v = (vel.v - omega * temp) * exp;
  let out = target + (change + temp) * exp;
  // Overshoot guard: if we crossed the target, land on it.
  if (target - current > 0 === out > target) {
    out = target;
    vel.v = 0;
  }
  return out;
}

export interface SpringState {
  x: number;
  v: number;
}

/** Explicit damped spring, sub-stepped so stiff settings stay stable at low frame rates. */
export function springStep(s: SpringState, target: number, stiffness: number, damping: number, dt: number, maxStep = 1 / 120): void {
  let left = dt;
  while (left > 1e-6) {
    const h = Math.min(left, maxStep);
    s.v += (-stiffness * (s.x - target) - damping * s.v) * h;
    s.x += s.v * h;
    left -= h;
  }
}

/** Wraps an angle to [-pi, pi). */
export function wrapAngle(a: number): number {
  let x = (a + Math.PI) % TAU;
  if (x < 0) x += TAU;
  return x - Math.PI;
}

/** Small deterministic PRNG (mulberry32) for seeded textures and layouts. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
