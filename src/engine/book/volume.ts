/**
 * The physical book: a hardcover case (two boards and a spine joined by hinges) and two page blocks. A third
 * block is a bundle of leaves on its way from one stack to the other.
 * All geometry is generated here and re-posed on the CPU when the book opens. No model file is loaded.
 *
 * Frame: the open-book frame (see profile.ts). The spine lies along Y at the origin. Closed, both boards
 * point toward +Z and the fore-edge is at z = coverW. Open flat, the front board lies toward -X and the back
 * board toward +X, pages facing +Z.
 */
import { BufferAttribute, BufferGeometry, Group, Mesh, type Material } from 'three';
import type { BookDims } from './dims';
import { LEAF_THICKNESS, atlasOf, type CaseAtlas } from './dims';
import { PROFILE_STRIDE, sampleDistance, sampleLeaf, turnLengthForOffset, type LeafShape } from './profile';

export interface VolumePose {
  /** Opening angle of the front (left) board in radians. 0 = closed, pi/2 = flat. */
  front: number;
  /** Opening angle of the back (right) board. */
  back: number;
  /** Share of the leaves resting on the front board, 0..1. Reading progress through the book. */
  split: number;
  /**
   * How far the pages have parted, 0..1. A book opens at a page by turning everything before that page over in
   * one wad. At 0 both stacks stand together along the closed book, the wad on top with its first leaf up. They
   * swing out to their boards by the square of this value, so both trail the boards, which move in step with
   * it: the back stack lifts off its board on the way and the wad comes over late. Default 1.
   */
  turn?: number;
  /** A bundle of leaves in the air between the two stacks. */
  chunk?: ChunkPose;
}

/**
 * A bundle of leaves that turns as one block. While there is one, `split` counts only the leaves that lie under
 * it on the front board: the back stack has what is left of the book.
 */
export interface ChunkPose {
  /** Its share of the leaves of the book. */
  share: number;
  /** 0 = it lies on the back (right) stack, 1 = on the front (left) one. */
  turn: number;
  /** How far it is lifted off the stack it lies on, radians. */
  lift?: number;
  /** The foot of the page leads the lift by this share and the head trails by it. */
  twist?: number;
  /** How far it bows against the air at mid-turn, radians at mid-length. Positive bows toward the left. */
  bow?: number;
}

export interface VolumeMaterials {
  cover: Material;
  endpaper: Material;
  /** Top of the left page block: the left page of the spread. */
  pageLeft: Material;
  pageRight: Material;
  edge: Material;
  /** The two faces of a bundle of leaves in the air: the one it shows lying right, and the one it shows lying left. Default: the page materials. */
  chunkTop?: Material;
  chunkUnder?: Material;
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
/** Rows up the page that faces the reader, so an effect can ripple it in both directions. */
const BLOCK_R = 24;

/** Air between a board and the first leaf on it. */
const SEAT = 0.02;

/**
 * The belly of the pages. `height` is that of the top page of a thick stack and `fall` the stack height at which
 * a page has about two thirds of it, both as shares of the page width: a few leaves on a board lie flat, a
 * hundred bulge. Measured on a resting spread of the reference: about 1.1 units on a page 13.2 wide, half the
 * book on each side.
 */
export interface PageArch {
  height: number;
  fall: number;
}
export const PAGE_ARCH: PageArch = { height: 0.1, fall: 0.09 };

/** Leaf stripes across the full width of the edge texture. */
export const EDGE_TEXTURE_LEAVES = 256;

/** A small dynamic mesh: vertices are rewritten in place each time the shape changes. */
export class Surface {
  readonly pos: Float32Array;
  readonly nor: Float32Array;
  readonly uv: Float32Array;
  /**
   * Per vertex, for page edges: how far it is from what it touches. Distance to the board the stack lies on, to
   * the board that closes over it, to the tail and to the head, world units. Large where nothing is near.
   */
  readonly contact: Float32Array;
  readonly geometry = new BufferGeometry();
  private n = 0;
  private quads: number[][] = [];
  private indexed = false;

  constructor(maxVerts: number) {
    this.pos = new Float32Array(maxVerts * 3);
    this.nor = new Float32Array(maxVerts * 3);
    this.uv = new Float32Array(maxVerts * 2);
    this.contact = new Float32Array(maxVerts * 4).fill(99);
    this.geometry.setAttribute('aContact', new BufferAttribute(this.contact, 4));
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
    this.contact.fill(99, i * 4, i * 4 + 4);
    return i;
  }

  /** Says how near vertex `i` is to the two boards and to the two ends of the page. Returns `i`. */
  touch(i: number, own: number, other: number, tail: number, head: number): number {
    this.contact[i * 4] = own;
    this.contact[i * 4 + 1] = other;
    this.contact[i * 4 + 2] = tail;
    this.contact[i * 4 + 3] = head;
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
    this.geometry.attributes.aContact!.needsUpdate = true;
  }
}

export class Volume {
  readonly group = new Group();
  readonly caseMesh: Mesh;
  readonly leftBlock: Mesh;
  readonly rightBlock: Mesh;
  /** A bundle of leaves in the air. Hidden unless the pose has one. */
  readonly chunkBlock: Mesh;
  /**
   * Horizontal ranges of the cover atlas, for the painter: back cover, spine, front cover. A hinge lies half in the
   * spine's range and half in its board's; `hinge` is that half as a share of the strip.
   */
  readonly atlas: CaseAtlas;
  pose: VolumePose = { front: 0, back: 0, split: 0.5 };
  /** The belly of the pages. Call `setPose` after changing it. */
  arch: PageArch = { ...PAGE_ARCH };

  private readonly caseSurface = new Surface(COLS * 8 + 8);
  private readonly blockSurfaces: [Surface, Surface];
  private readonly chunkSurface: Surface;
  private readonly cx = new Float32Array(COLS);
  private readonly cz = new Float32Array(COLS);
  private readonly nx = new Float32Array(COLS);
  private readonly nz = new Float32Array(COLS);
  private readonly cs = new Float32Array(COLS);
  private readonly layer = new Float32Array((BLOCK_K + 1) * (BLOCK_S + 1) * PROFILE_STRIDE);
  private readonly scratch = new Float32Array((BLOCK_S + 1) * PROFILE_STRIDE);
  /** The layers of a bundle at the head of the page. `layer` holds them at the foot. */
  private readonly layerHead = new Float32Array((BLOCK_K + 1) * (BLOCK_S + 1) * PROFILE_STRIDE);

  constructor(readonly dims: BookDims, materials: VolumeMaterials) {
    const blockVerts = (BLOCK_S + 1) * (BLOCK_R + 3) + (BLOCK_K + 1) * 2 + (BLOCK_S + 1) * (BLOCK_K + 1) * 2;
    this.blockSurfaces = [new Surface(blockVerts), new Surface(blockVerts)];
    this.caseMesh = new Mesh(this.caseSurface.geometry, [materials.cover, materials.endpaper]);
    // The left stack has a third face: its underside, the first leaf of the book, seen while the stack turns over.
    this.leftBlock = new Mesh(this.blockSurfaces[0].geometry, [materials.pageLeft, materials.edge, materials.endpaper]);
    this.rightBlock = new Mesh(this.blockSurfaces[1].geometry, [materials.pageRight, materials.edge]);
    this.chunkSurface = new Surface((BLOCK_S + 1) * (BLOCK_R + 1) * 2 + (BLOCK_K + 1) * 2 + (BLOCK_S + 1) * (BLOCK_K + 1) * 2);
    this.chunkBlock = new Mesh(this.chunkSurface.geometry, [materials.chunkTop ?? materials.pageRight, materials.edge, materials.chunkUnder ?? materials.pageLeft]);
    this.caseMesh.name = 'case';
    this.leftBlock.name = 'pages.left';
    this.rightBlock.name = 'pages.right';
    this.chunkBlock.name = 'pages.bundle';
    this.chunkBlock.visible = false;
    for (const m of [this.caseMesh, this.leftBlock, this.rightBlock, this.chunkBlock]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      this.group.add(m);
    }

    this.atlas = atlasOf(dims);
    this.setPose(this.pose);
  }

  setPose(pose: VolumePose): void {
    this.pose = { ...pose };
    this.buildCase(pose);
    this.buildBlock(0, pose);
    this.buildBlock(1, pose);
    this.buildChunk(pose);
  }

  /** Thickness of one of the two stacks. A bundle in the air belongs to neither. */
  stackThickness(which: 0 | 1, pose: VolumePose = this.pose): number {
    const share = which === 0 ? pose.split : 1 - pose.split - (pose.chunk?.share ?? 0);
    return this.dims.blockT * Math.min(Math.max(share, 0), 1);
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

  /**
   * The angle from the closed book at which a stack lies: on its board once the pages have parted, and on the
   * way there measured on the reference as its final angle times the square of the page progress.
   */
  private lie(left: boolean, pose: VolumePose): number {
    const turn = Math.min(Math.max(pose.turn ?? 1, 0), 1);
    if (turn >= 1) return left ? pose.front : pose.back;
    // The two boards always span the same angle, so the share of it that belongs to the front stack is known.
    return left ? (pose.front + pose.back) * (1 - pose.split) * turn * turn : pose.back * turn;
  }

  /** Shape of layer k (0 = on the board, 1 = top of the stack) of one page block. */
  layerShape(which: 0 | 1, k: number, pose: VolumePose = this.pose): LeafShape {
    return this.shapeAt(which === 0, k * this.stackThickness(which, pose), pose);
  }

  /**
   * Where the free edge of a leaf is that lies `h` above a board, front (0) or back (1), in the frame of `group`.
   * Run over the height of a stack it traces that stack's fore-edge as it lies, whether or not a bundle has been
   * lifted off it.
   */
  edgeAt(which: 0 | 1, h: number, pose: VolumePose = this.pose): { x: number; z: number } {
    sampleLeaf(this.shapeAt(which === 0, h, pose), BLOCK_S, this.scratch);
    const o = BLOCK_S * PROFILE_STRIDE;
    return { x: this.scratch[o]!, z: this.scratch[o + 1]! };
  }

  /** Shape of a leaf that lies `h` above a board, on the front (left) or the back one. */
  private shapeAt(left: boolean, h: number, pose: VolumePose): LeafShape {
    const d = this.dims;
    const open = this.lie(left, pose);
    const heading = left ? Math.PI / 2 + open : Math.PI / 2 - open;
    const x = left ? -d.blockT / 2 + h : d.blockT / 2 - h;
    const z = d.board / 2 + SEAT;
    // Away from the spine the layer runs h above the inner face of its board, wherever that board points:
    // lying flat, standing, or folded right back while the book is open near its first or last page. A stack on
    // its way out is shaped as if a board stood where the stack is now.
    const face = this.boardFace(left, open);
    const offset = (face.x - x) * face.nx + (face.z - z) * face.nz + h + SEAT;
    // The higher a page lies in its stack, the more it bulges: the board under the lowest one is flat.
    const fall = Math.max(1e-4, this.arch.fall * d.pageW);
    const arch = this.arch.height * d.pageW * (1 - Math.exp(-h / fall));
    return { x, z, heading, turnLength: turnLengthForOffset(offset, heading - Math.PI / 2), length: d.pageW, arch };
  }

  /**
   * Shape of layer j of a bundle in the air: 0 = the leaf that lies lowest while the bundle is on the back stack,
   * 1 = the one on top there. Lying on either stack a layer has the very shape that stack would have at its
   * height, so the bundle leaves and joins a stack without a seam. `lead` scales the lift: the foot of the page
   * rises first.
   */
  chunkShape(j: number, pose: VolumePose = this.pose, lead = 1): LeafShape {
    const c = pose.chunk ?? { share: 0, turn: 0 };
    const tc = this.dims.blockT * Math.max(0, c.share);
    const right = this.shapeAt(false, this.stackThickness(1, pose) + j * tc, pose);
    const left = this.shapeAt(true, this.stackThickness(0, pose) + (1 - j) * tc, pose);
    const a = Math.min(Math.max(c.turn, 0), 1);
    const air = Math.sin(Math.PI * a);
    const mix = (p: number, q: number): number => p + (q - p) * a;
    return {
      x: right.x,
      z: right.z,
      // The lift raises the bundle off whichever stack it is nearer to.
      heading: mix(right.heading, left.heading) + (c.lift ?? 0) * (1 - 2 * a) * lead,
      turnLength: mix(right.turnLength, left.turnLength) + 0.25 * air,
      length: this.dims.pageW,
      arch: mix(right.arch ?? 0, left.arch ?? 0),
      bow: (c.bow ?? 0) * air,
    };
  }

  private buildBlock(which: 0 | 1, pose: VolumePose): void {
    const d = this.dims;
    const left = which === 0;
    const mesh = left ? this.leftBlock : this.rightBlock;
    const t = this.stackThickness(which, pose);
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
      for (let r = 0; r <= BLOCK_R; r++) top.push(s.vert(x, y0 + ((y1 - y0) * r) / BLOCK_R, z, nx, 0, nz, u, r / BLOCK_R));
    }
    const rows = BLOCK_R + 1;
    for (let i = 0; i < BLOCK_S; i++) {
      for (let r = 0; r < BLOCK_R; r++) s.quad(top[i * rows + r]!, top[(i + 1) * rows + r]!, top[(i + 1) * rows + r + 1]!, top[i * rows + r + 1]!, 0);
    }

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

    // Where page edges meet a board they lie in its shade. The stack lies on its own board; the other board is
    // near only while the book is shut.
    const shut = Math.max(0, 1 - (pose.front + pose.back) / 0.6);
    const own = (k: number): number => (k / BLOCK_K) * t;
    const other = (k: number): number => (1 - k / BLOCK_K) * t + (1 - shut) * 9;

    // Fore-edge: the free ends of every layer.
    const fore: number[] = [];
    for (let k = 0; k <= BLOCK_K; k++) {
      const o = at(k, BLOCK_S);
      const u = ((k / BLOCK_K) * leavesHere) / EDGE_TEXTURE_LEAVES;
      fore.push(
        s.touch(s.vert(L[o]!, y0, L[o + 1]!, L[o + 2]!, 0, L[o + 3]!, u, 0), own(k), other(k), 0, d.pageH),
        s.touch(s.vert(L[o]!, y1, L[o + 1]!, L[o + 2]!, 0, L[o + 3]!, u, 1), own(k), other(k), d.pageH, 0),
      );
    }
    for (let k = 0; k < BLOCK_K; k++) s.quad(fore[k * 2]!, fore[(k + 1) * 2]!, fore[(k + 1) * 2 + 1]!, fore[k * 2 + 1]!, 1);

    // Head and tail: the stack seen from above and below.
    for (const [y, ny] of [[y1, 1], [y0, -1]] as const) {
      const grid: number[] = [];
      for (let k = 0; k <= BLOCK_K; k++) {
        for (let i = 0; i <= BLOCK_S; i++) {
          const o = at(k, i);
          const u = ((k / BLOCK_K) * leavesHere) / EDGE_TEXTURE_LEAVES;
          grid.push(s.touch(s.vert(L[o]!, y, L[o + 1]!, 0, ny, 0, u, sampleDistance(d.pageW, BLOCK_S, i) / d.pageW), own(k), other(k), 99, 99));
        }
      }
      const w = BLOCK_S + 1;
      for (let k = 0; k < BLOCK_K; k++) {
        for (let i = 0; i < BLOCK_S; i++) s.quad(grid[k * w + i]!, grid[k * w + i + 1]!, grid[(k + 1) * w + i + 1]!, grid[(k + 1) * w + i]!, 1);
      }
    }
    s.end();
  }

  /**
   * The bundle in the air: a block with a printed page on both faces. Its foot and its head are shaped apart, so
   * it can twist as it lifts; in between the faces run straight from one to the other.
   */
  private buildChunk(pose: VolumePose): void {
    const d = this.dims;
    const c = pose.chunk;
    const tc = c ? d.blockT * Math.max(0, c.share) : 0;
    this.chunkBlock.visible = tc > 1e-4;
    if (!c || !this.chunkBlock.visible) return;
    const s = this.chunkSurface;
    const stride = (BLOCK_S + 1) * PROFILE_STRIDE;
    const twist = c.twist ?? 0;
    const F = this.layer;
    const H = this.layerHead;
    for (let k = 0; k <= BLOCK_K; k++) {
      sampleLeaf(this.chunkShape(k / BLOCK_K, pose, 1 + twist), BLOCK_S, F.subarray(k * stride, (k + 1) * stride));
      sampleLeaf(this.chunkShape(k / BLOCK_K, pose, 1 - twist), BLOCK_S, H.subarray(k * stride, (k + 1) * stride));
    }
    const at = (k: number, i: number): number => k * stride + i * PROFILE_STRIDE;
    const y0 = -d.pageH / 2;
    const y1 = d.pageH / 2;
    const a = Math.min(Math.max(c.turn, 0), 1);
    const tr = this.stackThickness(1, pose);
    const tl = this.stackThickness(0, pose);
    // Height of a layer above the board it lies toward, for the stripes and the shade of the page edges.
    const height = (k: number): number => (a < 0.5 ? tr + (k / BLOCK_K) * tc : tl + (1 - k / BLOCK_K) * tc);
    const stripe = (k: number): number => (tr + (k / BLOCK_K) * tc) / LEAF_THICKNESS / EDGE_TEXTURE_LEAVES;
    const aloft = Math.sin(Math.PI * a) * 9;

    s.begin();
    // The two printed faces: the page on top while the bundle lies on the back stack, and the one underneath,
    // which is on top once it has come over.
    const rows = BLOCK_R + 1;
    for (const [k, sign, group] of [[BLOCK_K, 1, 0], [0, -1, 2]] as const) {
      const face: number[] = [];
      for (let i = 0; i <= BLOCK_S; i++) {
        const o = at(k, i);
        const along = sampleDistance(d.pageW, BLOCK_S, i) / d.pageW;
        const u = sign > 0 ? along : 1 - along;
        for (let r = 0; r <= BLOCK_R; r++) {
          const v = r / BLOCK_R;
          const x = F[o]! + (H[o]! - F[o]!) * v;
          const z = F[o + 1]! + (H[o + 1]! - F[o + 1]!) * v;
          const tx = F[o + 2]! + (H[o + 2]! - F[o + 2]!) * v;
          const tz = F[o + 3]! + (H[o + 3]! - F[o + 3]!) * v;
          face.push(s.vert(x, y0 + (y1 - y0) * v, z, -tz * sign, 0, tx * sign, u, v));
        }
      }
      for (let i = 0; i < BLOCK_S; i++) {
        for (let r = 0; r < BLOCK_R; r++) s.quad(face[i * rows + r]!, face[(i + 1) * rows + r]!, face[(i + 1) * rows + r + 1]!, face[i * rows + r + 1]!, group);
      }
    }

    // Fore-edge.
    const fore: number[] = [];
    for (let k = 0; k <= BLOCK_K; k++) {
      const o = at(k, BLOCK_S);
      const near = height(k) + aloft;
      fore.push(
        s.touch(s.vert(F[o]!, y0, F[o + 1]!, F[o + 2]!, 0, F[o + 3]!, stripe(k), 0), near, 99, 0, d.pageH),
        s.touch(s.vert(H[o]!, y1, H[o + 1]!, H[o + 2]!, 0, H[o + 3]!, stripe(k), 1), near, 99, d.pageH, 0),
      );
    }
    for (let k = 0; k < BLOCK_K; k++) s.quad(fore[k * 2]!, fore[(k + 1) * 2]!, fore[(k + 1) * 2 + 1]!, fore[k * 2 + 1]!, 1);

    // Head and tail.
    for (const [L, y, ny] of [[H, y1, 1], [F, y0, -1]] as const) {
      const grid: number[] = [];
      for (let k = 0; k <= BLOCK_K; k++) {
        for (let i = 0; i <= BLOCK_S; i++) {
          const o = at(k, i);
          grid.push(s.touch(s.vert(L[o]!, y, L[o + 1]!, 0, ny, 0, stripe(k), sampleDistance(d.pageW, BLOCK_S, i) / d.pageW), height(k) + aloft, 99, 99, 99));
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
