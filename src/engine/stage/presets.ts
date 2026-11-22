/**
 * Light presets. A preset is a complete description of the four-light rig; the rig blends between presets
 * field by field. Extensions add their own with `engine.stage.rig.definePreset(name, preset)`.
 * Values: research/SPEC.md S-LIGHT-1..5.
 */
import { lerp } from '../core/math';

export type Vec3 = [number, number, number];

export interface LightPreset {
  ambient: { color: string; intensity: number };
  /** Directional key light. The only light that casts onto the wall. */
  key: { color: string; intensity: number; position: Vec3 };
  /** Directional fill and rim. Never casts. */
  sun: { color: string; intensity: number; position: Vec3 };
  /** Spot that follows the pointer. `base` is its rest position in x and y; z is fixed. */
  spot: { color: string; intensity: number; angle: number; base: [number, number] };
  shadow: { frustumHalf: number; near: number; far: number; bias: number; normalBias: number; radius: number; mapSize: number };
}

export const BROWSE: LightPreset = {
  ambient: { color: '#ffffff', intensity: 0.83 },
  key: { color: '#b3aba2', intensity: 3.61, position: [-2.4, 3.5, 9.9] },
  sun: { color: '#aea7a7', intensity: 2.63, position: [22.5, 33.5, 6.8] },
  spot: { color: '#fffadb', intensity: 0.5, angle: 0.36, base: [24, 5.4] },
  shadow: { frustumHalf: 62.1, near: 0.001, far: 256.8, bias: -0.00253, normalBias: 0.0165, radius: 6, mapSize: 2048 },
};

export const DARK: LightPreset = {
  ambient: { color: '#ddcbb4', intensity: 0.58 },
  key: { color: '#fdb958', intensity: 1.77, position: [-35.8, 26, 41.4] },
  sun: { color: '#d6fffc', intensity: 2.33, position: [-4.5, -4.5, 7.5] },
  spot: { color: '#fffadb', intensity: 0.79, angle: 0.36, base: [24, 5.4] },
  shadow: { frustumHalf: 66.1, near: 0.001, far: 280, bias: -0.006, normalBias: 0.0387, radius: 10.44, mapSize: 2048 },
};

export const LOOK_INSIDE: LightPreset = {
  ambient: { color: '#7f7d7a', intensity: 1.4 },
  key: { color: '#f9f6f0', intensity: 1.41, position: [9.4, 4.6, 4.3] },
  sun: { color: '#f5f7ff', intensity: 1.4, position: [-15, -15, 39.7] },
  spot: { color: '#fffadb', intensity: 0.5, angle: 0.36, base: [24, 5.4] },
  shadow: { frustumHalf: 51.9, near: 0.001, far: 256.8, bias: -0.00118, normalBias: 0.0401, radius: 9.74, mapSize: 2048 },
};

export const DARK_LOOK_INSIDE: LightPreset = {
  ambient: { color: '#cfc4b4', intensity: 0.55 },
  key: { color: '#ffe8c8', intensity: 1.03, position: [-7.9, 25.4, 11.1] },
  sun: { color: '#d6fffc', intensity: 1.6, position: [5.9, -6.9, 6.7] },
  spot: { color: '#fffadb', intensity: 2.28, angle: 0.22, base: [0, 5.4] },
  shadow: { frustumHalf: 66.1, near: 0.001, far: 280, bias: -0.00123, normalBias: 0.0387, radius: 10.44, mapSize: 2048 },
};

export const BUILT_IN_PRESETS: Readonly<Record<string, LightPreset>> = {
  browse: BROWSE,
  dark: DARK,
  'look-inside': LOOK_INSIDE,
  'dark-look-inside': DARK_LOOK_INSIDE,
};

const hexToRgb = (hex: string): Vec3 => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbToHex = (r: number, g: number, b: number): string =>
  '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/** Colours blend per channel in their stored (display) values, as the measured rig does. */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(lerp(ar, br, t), lerp(ag, bg, t), lerp(ab, bb, t));
}

const mixVec3 = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Field-by-field blend. The shadow map size switches at the halfway point, everything else is linear. */
export function blendPresets(a: LightPreset, b: LightPreset, t: number): LightPreset {
  if (t <= 0) return a;
  if (t >= 1) return b;
  return {
    ambient: { color: mixHex(a.ambient.color, b.ambient.color, t), intensity: lerp(a.ambient.intensity, b.ambient.intensity, t) },
    key: { color: mixHex(a.key.color, b.key.color, t), intensity: lerp(a.key.intensity, b.key.intensity, t), position: mixVec3(a.key.position, b.key.position, t) },
    sun: { color: mixHex(a.sun.color, b.sun.color, t), intensity: lerp(a.sun.intensity, b.sun.intensity, t), position: mixVec3(a.sun.position, b.sun.position, t) },
    spot: {
      color: mixHex(a.spot.color, b.spot.color, t),
      intensity: lerp(a.spot.intensity, b.spot.intensity, t),
      angle: lerp(a.spot.angle, b.spot.angle, t),
      base: [lerp(a.spot.base[0], b.spot.base[0], t), lerp(a.spot.base[1], b.spot.base[1], t)],
    },
    shadow: {
      frustumHalf: lerp(a.shadow.frustumHalf, b.shadow.frustumHalf, t),
      near: lerp(a.shadow.near, b.shadow.near, t),
      far: lerp(a.shadow.far, b.shadow.far, t),
      bias: lerp(a.shadow.bias, b.shadow.bias, t),
      normalBias: lerp(a.shadow.normalBias, b.shadow.normalBias, t),
      radius: lerp(a.shadow.radius, b.shadow.radius, t),
      mapSize: t < 0.5 ? a.shadow.mapSize : b.shadow.mapSize,
    },
  };
}

export type ThemeName = 'light' | 'colour' | 'dark';

/** Theme by local hour: 8 to 15 light, 5 to 8 and 15 to 20 colour, otherwise dark (S-LIGHT-11). */
export function themeForHour(hour: number): ThemeName {
  if (hour >= 8 && hour < 15) return 'light';
  if ((hour >= 5 && hour < 8) || (hour >= 15 && hour < 20)) return 'colour';
  return 'dark';
}
