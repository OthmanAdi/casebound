/**
 * The shape of the pen: a highlighter generated from a short table of numbers. No model file.
 *
 * Model units, the axis along +y. The lowest edge of the nib is y = 0; the pen is 5.62 from there to the rim of
 * its cap, and that length is what its size on the page is given by. Every part is returned with its origin at
 * the pivot: the point on the axis half way up the slanted face of the nib, which is what sits on the pointer.
 *
 * Read on the reference (SPEC S-RD-13): a chisel nib, a short cone, a barrel, and a cap one twelfth wider than
 * the barrel with a low dome. No bevels.
 */

export interface PenShape {
  /** Half width of the nib across the page (x) and half its thickness (z). */
  nibHalfWidth: number;
  nibHalfThick: number;
  /** Height of the nib, and how high the back edge of its slanted underside stands. */
  nibHeight: number;
  nibSlant: number;
  /** The cone between nib and barrel: radius below and above, and its height. */
  collarLow: number;
  collarHigh: number;
  collarHeight: number;
  /** The barrel: radius, and the height at which it ends. */
  barrel: number;
  barrelTop: number;
  /** Height of the rounded end of the barrel, hidden in the cap, as a share of its radius. */
  shoulder: number;
  /** The cap: radius, where it starts and where its rim is. */
  cap: number;
  capFrom: number;
  capTo: number;
  /** Height of the dome on the cap as a share of its radius. */
  dome: number;
}

export const PEN_SHAPE: PenShape = {
  nibHalfWidth: 0.1292,
  nibHalfThick: 0.0612,
  nibHeight: 0.5,
  nibSlant: 0.275,
  collarLow: 0.2448,
  collarHigh: 0.2788,
  collarHeight: 0.22,
  barrel: 0.34,
  barrelTop: 4.92,
  shoulder: 0.55,
  cap: 0.3672,
  capFrom: 4.52,
  capTo: 5.62,
  dome: 0.6,
};

/** A mesh as plain arrays: positions and normals three by three, triangles as indices. */
export interface PartMesh {
  position: number[];
  normal: number[];
  index: number[];
}

export interface PenMeshes {
  nib: PartMesh;
  collar: PartMesh;
  /** Barrel, its rounded end and the cap. */
  body: PartMesh;
  dome: PartMesh;
  /** The eight corners of the nib, x y z each: what must stay clear of the paper. */
  corners: number[];
  /** From the lowest edge of the nib to the rim of the cap. */
  length: number;
  /** Height of the pivot above the lowest edge of the nib. All positions are given from the pivot. */
  pivot: number;
  /** Top of the dome above the lowest edge of the nib. */
  total: number;
}

const empty = (): PartMesh => ({ position: [], normal: [], index: [] });

/** Adds a surface of revolution about the y axis: rings of `sides` points along a profile of [radius, y, normal r, normal y]. */
function lathe(mesh: PartMesh, profile: [number, number, number, number][], sides: number): void {
  const base = mesh.position.length / 3;
  for (const [r, y, nr, ny] of profile) {
    const len = Math.hypot(nr, ny) || 1;
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      mesh.position.push(r * c, y, r * s);
      mesh.normal.push((nr / len) * c, ny / len, (nr / len) * s);
    }
  }
  const ring = sides + 1;
  for (let j = 0; j < profile.length - 1; j++) {
    for (let i = 0; i < sides; i++) {
      const a = base + j * ring + i;
      const b = a + ring;
      mesh.index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
}

/** Half an ellipsoid of revolution standing on y = `from`, as a lathe profile from its rim to its top. */
function halfEllipsoid(radius: number, height: number, from: number, steps: number): [number, number, number, number][] {
  const profile: [number, number, number, number][] = [];
  for (let k = 0; k <= steps; k++) {
    const a = (k / steps) * (Math.PI / 2);
    // The normal of an ellipse (r cos a, h sin a) is (h cos a, r sin a).
    profile.push([radius * Math.cos(a), from + height * Math.sin(a), height * Math.cos(a), radius * Math.sin(a)]);
  }
  return profile;
}

/** Adds a flat face of three or four corners with its own normal, so its edges stay sharp. */
function face(mesh: PartMesh, corners: number[][]): void {
  const base = mesh.position.length / 3;
  const [a, b, c] = corners as [number[], number[], number[]];
  const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!;
  const vx = c[0]! - a[0]!, vy = c[1]! - a[1]!, vz = c[2]! - a[2]!;
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;
  for (const p of corners) {
    mesh.position.push(p[0]!, p[1]!, p[2]!);
    mesh.normal.push(nx, ny, nz);
  }
  for (let i = 1; i < corners.length - 1; i++) mesh.index.push(base, base + i, base + i + 1);
}

/** Builds the pen from its numbers. */
export function penMeshes(s: PenShape = PEN_SHAPE, sides = 32): PenMeshes {
  const pivot = s.nibSlant / 2;
  const y = (h: number): number => h - pivot;
  const w = s.nibHalfWidth;
  const d = s.nibHalfThick;

  // The nib: a wedge. Its underside is one slanted face from the front edge down at 0 to the back edge up at `nibSlant`.
  const f0 = [-w, y(0), d], f1 = [w, y(0), d];
  const b0 = [-w, y(s.nibSlant), -d], b1 = [w, y(s.nibSlant), -d];
  const t0 = [-w, y(s.nibHeight), d], t1 = [w, y(s.nibHeight), d];
  const t2 = [-w, y(s.nibHeight), -d], t3 = [w, y(s.nibHeight), -d];
  const nib = empty();
  face(nib, [f0, f1, t1, t0]); // front
  face(nib, [b1, b0, t2, t3]); // back
  face(nib, [b0, b1, f1, f0]); // the slanted underside
  face(nib, [t0, t1, t3, t2]); // top, hidden in the collar
  face(nib, [f0, t0, t2, b0]); // left
  face(nib, [f1, b1, t3, t1]); // right

  const collarFrom = s.nibHeight;
  const collarTo = s.nibHeight + s.collarHeight;
  const collar = empty();
  const slope = (s.collarHigh - s.collarLow) / s.collarHeight;
  lathe(collar, [[0, y(collarFrom), 0, -1], [s.collarLow, y(collarFrom), 0, -1]], Math.round(sides * 0.875));
  lathe(collar, [[s.collarLow, y(collarFrom), 1, -slope], [s.collarHigh, y(collarTo), 1, -slope]], Math.round(sides * 0.875));

  const body = empty();
  // The step from the collar out to the barrel, the barrel, and its rounded end inside the cap.
  lathe(body, [[s.collarHigh, y(collarTo), 0, -1], [s.barrel, y(collarTo), 0, -1]], sides);
  lathe(body, [[s.barrel, y(collarTo), 1, 0], [s.barrel, y(s.barrelTop), 1, 0]], sides);
  lathe(body, halfEllipsoid(s.barrel, s.barrel * s.shoulder, y(s.barrelTop), 8), sides);
  // The cap, sleeved over the end of the barrel, with the ring that closes it below.
  lathe(body, [[s.barrel, y(s.capFrom), 0, -1], [s.cap, y(s.capFrom), 0, -1]], sides);
  lathe(body, [[s.cap, y(s.capFrom), 1, 0], [s.cap, y(s.capTo), 1, 0]], sides);

  const dome = empty();
  lathe(dome, halfEllipsoid(s.cap, s.cap * s.dome, y(s.capTo), 14), sides);

  return {
    nib,
    collar,
    body,
    dome,
    corners: [f0, f1, b0, b1, t0, t1, t2, t3].flat(),
    length: s.capTo,
    pivot,
    total: s.capTo + s.cap * s.dome,
  };
}
