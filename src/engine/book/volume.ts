/**
 * The physical book: a hardcover case (two boards and a spine joined by hinges) and two page blocks.
 * All geometry is generated here and re-posed on the CPU when the book opens. No model file is loaded.
 *
 * Frame: the open-book frame (see profile.ts). The spine lies along Y at the origin. Closed, both boards
 * point toward +Z and the fore-edge is at z = coverW. Open flat, the front board lies toward -X and the back
 * board toward +X, pages facing +Z.
 */
import { BufferAttribute, BufferGeometry, Group, Mesh, type Material } from 'three';
import type { BookDims } from './dims';
import { LEAF_THICKNESS } from './dims';
import { PROFILE_STRIDE, sampleDistance, sampleLeaf, turnLengthForOffset, type LeafShape } from './profile';

export interface VolumePose {
  /** Opening angle of the front (left) board in radians. 0 = closed, pi/2 = flat. */
  front: number;
  /** Opening angle of the back (right) board. */
  back: number;
  /** Share of the leaves resting on the front board, 0..1. Reading progress through the book. */
  split: number;
  /**
   * How far the leaves of the front board have come over from the back board, 0..1. A book opens at a page by
   * turning everything before that page over in one wad: at 0 the wad still lies on the other leaves, first
   * page up, at 1 it lies on the front board. Default 1.
   */
  turn?: number;
}

export interface VolumeMaterials {
  cover: Material;
  endpaper: Material;
  /** Top of the left page block: the left page of the spread. */
  pageLeft: Material;
  pageRight: Material;
  edge: Material;
}

/** Segments per side of the case strip: half spine, hinge arc, board. */
const NS = 2;
const NH = 4;
const NB = 4;
const SIDE = NS + NH + NB;
const COLS = SIDE * 2 + 1;

/**
 * Page block resolution: samples along the page, layers through the stack. A leaf of the reader uses the same
 * samples along the page, so a sheet that lies on a stack has the very shape of the top of that stack.
 */
export const BLOCK_S = 56;
const BLOCK_K = 5;

/** Air between a board and the first leaf on it. */
const SEAT = 0.02;

/** Leaf stripes across the full width of the edge texture. */
export const EDGE_TEXTURE_LEAVES = 256;

/** A small dynamic mesh: vertices are rewritten in place each time the shape changes. */
export class Surface {
  readonly pos: Float32Array;
  readonly nor: Float32Array;
  readonly uv: Float32Array;
  readonly geometry = new BufferGeometry();
  private n = 0;
  private quads: number[][] = [];
  private indexed = false;

  constructor(maxVerts: number) {
    this.pos = new Float32Array(maxVerts * 3);
    this.nor = new Float32Array(maxVerts * 3);
    this.uv = new Float32Array(maxVerts * 2);
    this.geometry.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geometry.setAttribute('normal', new BufferAttribute(this.nor, 3));
    this.geometry.setAttribute('uv', new BufferAttribute(this.uv, 2));
  }

  begin(): void {
    this.n = 0;
    if (!this.indexed) this.quads = [];
  }

  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number): number {
    const i = this.n++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.nor[i * 3] = nx;
    this.nor[i * 3 + 1] = ny;
    this.nor[i * 3 + 2] = nz;
    this.uv[i * 2] = u;
    this.uv[i * 2 + 1] = v;
    return i;
  }

  /** Registers a quad. Winding is fixed on the first build by comparing the face normal with the vertex normals. */
  quad(a: number, b: number, c: number, d: number, group: number): void {
    if (!this.indexed) this.quads.push([a, b, c, d, group]);
  }

  end(): void {
    if (!this.indexed) {
      const groups = new Map<number, number[]>();
      for (const [a, b, c, d, g] of this.quads as [number, number, number, number, number][]) {
        const p = this.pos;
        const ux = p[b * 3]! - p[a * 3]!, uy = p[b * 3 + 1]! - p[a * 3 + 1]!, uz = p[b * 3 + 2]! - p[a * 3 + 2]!;
        const vx = p[d * 3]! - p[a * 3]!, vy = p[d * 3 + 1]! - p[a * 3 + 1]!, vz = p[d * 3 + 2]! - p[a * 3 + 2]!;
        const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
        const n = this.nor;
        const dot = fx * (n[a * 3]! + n[c * 3]!) + fy * (n[a * 3 + 1]! + n[c * 3 + 1]!) + fz * (n[a * 3 + 2]! + n[c * 3 + 2]!);
        const list = groups.get(g) ?? [];
        if (dot >= 0) list.push(a, b, c, a, c, d);
        else list.push(a, c, b, a, d, c);
        groups.set(g, list);
      }
      const index: number[] = [];
      for (const g of [...groups.keys()].sort((x, y) => x - y)) {
        const list = groups.get(g)!;
        this.geometry.addGroup(index.length, list.length, g);
        index.push(...list);
      }
      this.geometry.setIndex(index);
      this.indexed = true;
      this.quads = [];
    }
    this.geometry.setDrawRange(0, Infinity);
    this.geometry.attributes.position!.needsUpdate = true;
    this.geometry.attributes.normal!.needsUpdate = true;
    this.geometry.attributes.uv!.needsUpdate = true;
  }
}

export class Volume {
  readonly group = new Group();
  readonly caseMesh: Mesh;
  readonly leftBlock: Mesh;
  readonly rightBlock: Mesh;
  /** Horizontal ranges of the cover atlas, for the painter: back cover, spine, front cover. */
  readonly atlas: { back: [number, number]; spine: [number, number]; front: [number, number]; aspect: number };
  pose: VolumePose = { front: 0, back: 0, split: 0.5 };

  private readonly caseSurface = new Surface(COLS * 8 + 8);
  private readonly blockSurfaces: [Surface, Surface];
  private readonly cx = new Float32Array(COLS);
  private readonly cz = new Float32Array(COLS);
  private readonly nx = new Float32Array(COLS);
  private readonly nz = new Float32Array(COLS);
  private readonly cs = new Float32Array(COLS);
  private readonly layer = new Float32Array((BLOCK_K + 1) * (BLOCK_S + 1) * PROFILE_STRIDE);

  constructor(readonly dims: BookDims, materials: VolumeMaterials) {
    const blockVerts = (BLOCK_S + 1) * 4 + (BLOCK_K + 1) * 2 + (BLOCK_S + 1) * (BLOCK_K + 1) * 2;
    this.blockSurfaces = [new Surface(blockVerts), new Surface(blockVerts)];
    this.caseMesh = new Mesh(this.caseSurface.geometry, [materials.cover, materials.endpaper]);
    // The left stack has a third face: its underside, the first leaf of the book, seen while the stack turns over.
    this.leftBlock = new Mesh(this.blockSurfaces[0].geometry, [materials.pageLeft, materials.edge, materials.endpaper]);
    this.rightBlock = new Mesh(this.blockSurfaces[1].geometry, [materials.pageRight, materials.edge]);
    this.caseMesh.name = 'case';
    this.leftBlock.name = 'pages.left';
    this.rightBlock.name = 'pages.right';
    for (const m of [this.caseMesh, this.leftBlock, this.rightBlock]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      this.group.add(m);
    }

    const d = dims;
    const spineHalf = (d.thickness - d.board) / 2 - d.hinge;
    const arc = (d.hinge * Math.PI) / 2;
    const boardLen = d.coverW - d.hinge - d.board / 2;
    const total = 2 * (spineHalf + arc + boardLen);
    const boardShare = (boardLen + arc / 2) / total;
    this.atlas = { back: [0, boardShare], spine: [boardShare, 1 - boardShare], front: [1 - boardShare, 1], aspect: total / d.coverH };
    this.setPose(this.pose);
  }

  setPose(pose: VolumePose): void {
    this.pose = { ...pose };
    this.buildCase(pose);
    this.buildBlock(0, pose);
    this.buildBlock(1, pose);
  }

  /** z of the middle of the closed book, used to spin the closed book about its centre. */
  get closedCentreZ(): number {
    return this.dims.coverW / 2 - this.dims.board / 2;
  }

  private buildCase(pose: VolumePose): void {
    const d = this.dims;
    const spineHalf = (d.thickness - d.board) / 2 - d.hinge;
    const arcSeg = (d.hinge * Math.PI) / 2 / NH;
    const boardSeg = (d.coverW - d.hinge - d.board / 2) / NB;
    const segLen = (j: number): number => (j < NS ? spineHalf / NS : j < NS + NH ? arcSeg : boardSeg);

    // Walk outward from the spine centre, once to the left (front board) and once to the right (back board).
    for (const side of [-1, 1] as const) {
      const open = side < 0 ? pose.front : pose.back;
      const start = side < 0 ? Math.PI : 0;
      const end = side < 0 ? Math.PI / 2 + open : Math.PI / 2 - open;
      const heading = (j: number): number => {
        if (j < NS) return start;
        if (j < NS + NH) return start + ((end - start) * (j - NS + 1)) / NH;
        return end;
      };
      let x = 0;
      let z = 0;
      for (let j = 0; j <= SIDE; j++) {
        const c = SIDE + side * j;
        const before = heading(Math.max(0, j - 1));
        const after = heading(Math.min(SIDE - 1, j));
        const a = j === 0 ? start : (before + after) / 2;
        this.cx[c] = x;
        this.cz[c] = z;
        // Inner normal: the side the pages are on.
        this.nx[c] = side < 0 ? Math.sin(a) : -Math.sin(a);
        this.nz[c] = side < 0 ? -Math.cos(a) : Math.cos(a);
        if (j < SIDE) {
          const h = heading(j);
          x += Math.cos(h) * segLen(j);
          z += Math.sin(h) * segLen(j);
        }
      }
    }
    let length = 0;
    this.cs[0] = 0;
    for (let c = 1; c < COLS; c++) {
      const j = c <= SIDE ? SIDE - c : c - SIDE - 1;
      length += segLen(j);
      this.cs[c] = length;
    }

    const s = this.caseSurface;
    const hb = d.board / 2;
    const y0 = -d.coverH / 2;
    const y1 = d.coverH / 2;
    s.begin();
    const outer: number[] = [];
    const inner: number[] = [];
    const top: number[] = [];
    const bottom: number[] = [];
    for (let c = 0; c < COLS; c++) {
      const x = this.cx[c]!, z = this.cz[c]!, nx = this.nx[c]!, nz = this.nz[c]!;
      const u = 1 - this.cs[c]! / length;
      const ox = x - nx * hb, oz = z - nz * hb, ix = x + nx * hb, iz = z + nz * hb;
      outer.push(s.vert(ox, y0, oz, -nx, 0, -nz, u, 0), s.vert(ox, y1, oz, -nx, 0, -nz, u, 1));
      inner.push(s.vert(ix, y0, iz, nx, 0, nz, 1 - u, 0), s.vert(ix, y1, iz, nx, 0, nz, 1 - u, 1));
      top.push(s.vert(ox, y1, oz, 0, 1, 0, u, 0.997), s.vert(ix, y1, iz, 0, 1, 0, u, 0.997));
      bottom.push(s.vert(ox, y0, oz, 0, -1, 0, u, 0.003), s.vert(ix, y0, iz, 0, -1, 0, u, 0.003));
    }
    for (let c = 0; c < COLS - 1; c++) {
      const a = c * 2, b = (c + 1) * 2;
      s.quad(outer[a]!, outer[b]!, outer[b + 1]!, outer[a + 1]!, 0);
      s.quad(inner[a]!, inner[b]!, inner[b + 1]!, inner[a + 1]!, 1);
      s.quad(top[a]!, top[b]!, top[b + 1]!, top[a + 1]!, 0);
      s.quad(bottom[a]!, bottom[b]!, bottom[b + 1]!, bottom[a + 1]!, 0);
    }
    // Fore-edge caps of the two boards.
    for (const c of [0, COLS - 1]) {
      const x = this.cx[c]!, z = this.cz[c]!, nx = this.nx[c]!, nz = this.nz[c]!;
      // Outward along the board: perpendicular to the inner normal, pointing away from the spine.
      const side = c === 0 ? -1 : 1;
      const tx = side < 0 ? -nz : nz;
      const tz = side < 0 ? nx : -nx;
      const u = c === 0 ? 0.999 : 0.001;
      const a = s.vert(x - nx * hb, y0, z - nz * hb, tx, 0, tz, u, 0);
      const b = s.vert(x + nx * hb, y0, z + nz * hb, tx, 0, tz, u, 0);
      const cc = s.vert(x + nx * hb, y1, z + nz * hb, tx, 0, tz, u, 1);
      const dd = s.vert(x - nx * hb, y1, z - nz * hb, tx, 0, tz, u, 1);
      s.quad(a, b, cc, dd, 0);
    }
    s.end();
  }

  /** A point on the inner face of a board, past the hinge, and the direction that face looks in. */
  private boardFace(left: boolean, open: number): { x: number; z: number; nx: number; nz: number } {
    const d = this.dims;
    const arcSeg = (d.hinge * Math.PI) / 2 / NH;
    const start = left ? Math.PI : 0;
    const end = left ? Math.PI / 2 + open : Math.PI / 2 - open;
    // The same walk as the case: half the spine, then the hinge arc.
    let x = Math.cos(start) * ((d.thickness - d.board) / 2 - d.hinge);
    let z = 0;
    for (let j = 1; j <= NH; j++) {
      const h = start + ((end - start) * j) / NH;
      x += Math.cos(h) * arcSeg;
      z += Math.sin(h) * arcSeg;
    }
    const nx = left ? Math.sin(end) : -Math.sin(end);
    const nz = left ? -Math.cos(end) : Math.cos(end);
    return { x: x + (nx * d.board) / 2, z: z + (nz * d.board) / 2, nx, nz };
  }

  /** Shape of layer k (0 = on the board, 1 = top of the stack) of one page block. */
  layerShape(which: 0 | 1, k: number, pose: VolumePose = this.pose): LeafShape {
    const d = this.dims;
    const left = which === 0;
    const t = d.blockT * (left ? pose.split : 1 - pose.split);
    const open = left ? pose.front : pose.back;
    const heading = left ? Math.PI / 2 + open : Math.PI / 2 - open;
    const x = left ? -d.blockT / 2 + k * t : d.blockT / 2 - k * t;
    const z = d.board / 2 + SEAT;
    // Away from the spine the layer runs k x t above the inner face of its board, wherever that board points:
    // lying flat, standing, or folded right back while the book is open near its first or last page.
    const face = this.boardFace(left, open);
    const offset = (face.x - x) * face.nx + (face.z - z) * face.nz + k * t + SEAT;
    const shape: LeafShape = { x, z, heading, turnLength: turnLengthForOffset(offset, heading - Math.PI / 2), length: d.pageW };
    const turn = pose.turn ?? 1;
    if (!left || turn >= 1) return shape;
    // The wad on its way over. Before it turns, its leaves are simply the upper leaves of one undivided stack on
    // the back board, bound at the same places, the other way up. In between, each leaf sweeps over the spine.
    const all = d.blockT;
    const upper = 1 - pose.split * k;
    const there = Math.PI / 2 - pose.back;
    const back = this.boardFace(false, pose.back);
    const lift = (back.x - x) * back.nx + (back.z - z) * back.nz + upper * all + SEAT;
    const lying = turnLengthForOffset(lift, there - Math.PI / 2);
    const s = Math.min(Math.max(turn, 0), 1);
    return { x, z, heading: there + (heading - there) * s, turnLength: lying + (shape.turnLength - lying) * s, length: d.pageW };
  }

  private buildBlock(which: 0 | 1, pose: VolumePose): void {
    const d = this.dims;
    const left = which === 0;
    const mesh = left ? this.leftBlock : this.rightBlock;
    const t = d.blockT * (left ? pose.split : 1 - pose.split);
    mesh.visible = t > 1e-3;
    const s = this.blockSurfaces[which];
    const stride = (BLOCK_S + 1) * PROFILE_STRIDE;
    for (let k = 0; k <= BLOCK_K; k++) {
      sampleLeaf(this.layerShape(which, k / BLOCK_K, pose), BLOCK_S, this.layer.subarray(k * stride, (k + 1) * stride));
    }
    const at = (k: number, i: number): number => k * stride + i * PROFILE_STRIDE;
    const y0 = -d.pageH / 2;
    const y1 = d.pageH / 2;
    const L = this.layer;
    const leavesHere = t / LEAF_THICKNESS;

    s.begin();
    // Top of the stack: the page that faces the reader.
    const top: number[] = [];
    for (let i = 0; i <= BLOCK_S; i++) {
      const o = at(BLOCK_K, i);
      const x = L[o]!, z = L[o + 1]!, tx = L[o + 2]!, tz = L[o + 3]!;
      const nx = left ? tz : -tz;
      const nz = left ? -tx : tx;
      const along = sampleDistance(d.pageW, BLOCK_S, i) / d.pageW;
      const u = left ? 1 - along : along;
      top.push(s.vert(x, y0, z, nx, 0, nz, u, 0), s.vert(x, y1, z, nx, 0, nz, u, 1));
    }
    for (let i = 0; i < BLOCK_S; i++) s.quad(top[i * 2]!, top[(i + 1) * 2]!, top[(i + 1) * 2 + 1]!, top[i * 2 + 1]!, 0);

    // Underside of the left stack: the outer face of the book's first leaf. It rests on the board once the
    // stack has come over, and is what the reader sees before that.
    if (left) {
      const under: number[] = [];
      for (let i = 0; i <= BLOCK_S; i++) {
        const o = at(0, i);
        const x = L[o]!, z = L[o + 1]!, tx = L[o + 2]!, tz = L[o + 3]!;
        const along = sampleDistance(d.pageW, BLOCK_S, i) / d.pageW;
        under.push(s.vert(x, y0, z, -tz, 0, tx, along, 0), s.vert(x, y1, z, -tz, 0, tx, along, 1));
      }
      for (let i = 0; i < BLOCK_S; i++) s.quad(under[i * 2]!, under[(i + 1) * 2]!, under[(i + 1) * 2 + 1]!, under[i * 2 + 1]!, 2);
    }

    // Fore-edge: the free ends of every layer.
    const fore: number[] = [];
    for (let k = 0; k <= BLOCK_K; k++) {
      const o = at(k, BLOCK_S);
      const u = ((k / BLOCK_K) * leavesHere) / EDGE_TEXTURE_LEAVES;
      fore.push(s.vert(L[o]!, y0, L[o + 1]!, L[o + 2]!, 0, L[o + 3]!, u, 0), s.vert(L[o]!, y1, L[o + 1]!, L[o + 2]!, 0, L[o + 3]!, u, 1));
    }
    for (let k = 0; k < BLOCK_K; k++) s.quad(fore[k * 2]!, fore[(k + 1) * 2]!, fore[(k + 1) * 2 + 1]!, fore[k * 2 + 1]!, 1);

    // Head and tail: the stack seen from above and below.
    for (const [y, ny] of [[y1, 1], [y0, -1]] as const) {
      const grid: number[] = [];
      for (let k = 0; k <= BLOCK_K; k++) {
        for (let i = 0; i <= BLOCK_S; i++) {
          const o = at(k, i);
          const u = ((k / BLOCK_K) * leavesHere) / EDGE_TEXTURE_LEAVES;
          grid.push(s.vert(L[o]!, y, L[o + 1]!, 0, ny, 0, u, sampleDistance(d.pageW, BLOCK_S, i) / d.pageW));
        }
      }
      const w = BLOCK_S + 1;
      for (let k = 0; k < BLOCK_K; k++) {
        for (let i = 0; i < BLOCK_S; i++) s.quad(grid[k * w + i]!, grid[k * w + i + 1]!, grid[(k + 1) * w + i + 1]!, grid[(k + 1) * w + i]!, 1);
      }
    }
    s.end();
  }
}
