/**
 * The numbers behind the page of stills (stills.ts), kept apart so they can be tested without a browser.
 */

/** Where the tab remembers that the stills were asked for. */
export const STILLS_KEY = 'casebound.nowebgl';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Whether the address or the tab asks for the page of stills. Measured: `?nowebgl` shows it and is remembered
 * for the tab, so links inside the page keep it; `?webgl` forgets it again.
 */
export function stillsAsked(query: URLSearchParams, store: Store | null): boolean {
  try {
    if (query.has('webgl')) {
      store?.removeItem(STILLS_KEY);
      return false;
    }
    if (query.has('nowebgl')) {
      store?.setItem(STILLS_KEY, '1');
      return true;
    }
    return store?.getItem(STILLS_KEY) === '1';
  } catch {
    // Storage that refuses: the address alone decides.
    return query.has('nowebgl') && !query.has('webgl');
  }
}

/**
 * How a still rides the scroll. Measured on five positions between two books: it lingers for 0.215 of the way
 * around each book and creeps at 0.2 of the scroll's pace throughout (the dwell curve of the shelf, with its own
 * two values).
 */
export const STILL_DWELL = { plateau: 0.215, creep: 0.2 } as const;

/** The pose of a still in degrees: leaning to the right, its head tipped back, its spine turned to the front. */
export const STILL_POSE = { roll: 8, pitch: 12, yaw: 26 } as const;

export type Face = 'front' | 'back' | 'spine' | 'fore' | 'head' | 'tail';

/** Outward directions of the six faces of a closed book, in the page's axes: x to the right, y down, z to the viewer. */
const NORMALS: Record<Face, [number, number, number]> = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  spine: [-1, 0, 0],
  fore: [1, 0, 0],
  head: [0, -1, 0],
  tail: [0, 1, 0],
};

/** Toward the light: above, a little to the left, in front. */
const LIGHT = ((): [number, number, number] => {
  const v: [number, number, number] = [-0.2, -0.45, 0.87];
  const n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n];
})();

const RAD = Math.PI / 180;

/**
 * How bright each face of a still stands, 1 being its painted colour, for a book turned by `turn` degrees about
 * its own upright axis. A face turned away from the light keeps 0.55 of its colour.
 */
export function faceLight(turn: number, pose: { roll: number; pitch: number; yaw: number } = STILL_POSE): Record<Face, number> {
  const yaw = (pose.yaw + turn) * RAD;
  const pitch = pose.pitch * RAD;
  const roll = pose.roll * RAD;
  const out = {} as Record<Face, number>;
  for (const face of Object.keys(NORMALS) as Face[]) {
    let [x, y, z] = NORMALS[face];
    // The order of the page's transform, last written first: about the upright axis, then tipped, then leaned.
    [x, z] = [x * Math.cos(yaw) + z * Math.sin(yaw), -x * Math.sin(yaw) + z * Math.cos(yaw)];
    [y, z] = [y * Math.cos(pitch) - z * Math.sin(pitch), y * Math.sin(pitch) + z * Math.cos(pitch)];
    [x, y] = [x * Math.cos(roll) - y * Math.sin(roll), x * Math.sin(roll) + y * Math.cos(roll)];
    const lit = Math.max(0, x * LIGHT[0] + y * LIGHT[1] + z * LIGHT[2]);
    out[face] = Math.min(1.12, 0.55 + 0.62 * lit);
  }
  return out;
}

/**
 * The way back to the front for a book that was turned by hand, in turns. Measured: it takes the shorter way
 * round, in 600 ms plus up to 300 ms more for half a turn, quick at first.
 */
export function wayBack(turns: number): { delta: number; ms: number } {
  const part = ((turns % 1) + 1) % 1;
  const delta = part <= 0.5 ? -part : 1 - part;
  return { delta, ms: 600 + 300 * Math.min(1, Math.abs(delta) / 0.5) };
}

/** Measured: a sideways pull of one and a half widths of the still turns the book once round. */
export const turnsFor = (dx: number, width: number): number => dx / (1.5 * Math.max(1, width));
