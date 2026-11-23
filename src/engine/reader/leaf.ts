/**
 * One turning leaf: a sheet with a page on each side. Its shape comes from the same cross-section model as the
 * page blocks, so at rest it lies exactly on the stack it belongs to. A corner curl rolls the sheet up past a
 * slanted line across the page (SPEC S-RD-11).
 */
import { Mesh, MeshDepthMaterial, type Texture } from 'three';
import type { Book } from '../book/book';
import { LEAF_THICKNESS } from '../book/dims';
import { GRAIN_PER_UNIT, grainTexture } from '../book/painter';
import { PROFILE_STRIDE, sampleDistance, sampleIndex, sampleLeaf } from '../book/profile';
import { CLOTH, createSurfaceMaterial, type SurfaceFx } from '../book/surface';
import { BLOCK_S, Surface } from '../book/volume';
import { clamp, lerp, smoothstep } from '../core/math';
import { ROLL_STRIDE, createCurl, fillRoll, type CurlState } from './curl';
import { createLeafMotion, type LeafMotion } from './leaf-physics';
import type { RifflePart } from './riffle';

/** Samples across the page, crowded toward the binding: the same as the top of a page block, so the two coincide. */
const COLS = BLOCK_S;
/** Rows up the page. The fold line of a curl runs at a slant, so the sheet is not a plain extrusion. */
const ROWS = 24;
const ROLL_STEPS = 96;
/** Diffuse wrap of a sheet in the air, and the share of light from behind that passes through it. */
const WRAP_ALOFT = 0.55;
const TRANSMIT = 0.9;
/** The sheet counts as fully in the air once the sine of its turn passes this: about 17 degrees off the stack. */
const ALOFT_AT = 0.3;
/** Air between a resting sheet and the page below it. */
const REST_GAP = 0.012;
/** The sheet throws a shadow once the sine of its turn passes this: about a degree off the stack. */
const CAST_FROM = 0.02;
/**
 * Depth slope added to the sheet in the shadow map, in texels: a little more than the widest soft shadow reads
 * (a radius of 10.4 texels in the dark themes, widened by up to a third by the wall).
 */
const SHADOW_SLOPE = 16;

export class Leaf {
  readonly mesh: Mesh;
  readonly motion: LeafMotion = createLeafMotion(0);
  readonly curl: CurlState = createCurl();
  /** Index of this leaf in the book: its front is page 2j + 1, its back page 2j + 2. */
  index = -1;
  active = false;
  /** The stack this leaf is counted on while it is in the air: 0 = right, 1 = left. */
  side: 0 | 1 = 0;
  /** While a hand holds the leaf: the angle it is pulled toward. Null when it moves by itself. */
  dragTarget: number | null = null;
  /** While the opening riffle moves the leaf: its part in it. */
  script: RifflePart | null = null;
  /** How limp the sheet is in the air, 0 (stiff) to 1: how far it bows and lets its free edge trail. */
  limp = 1;
  /** How many live sheets lie between this one and its stack when it rests on the right, and on the left. */
  readonly below: [number, number] = [0, 0];

  private readonly surface = new Surface((COLS + 1) * (ROWS + 1) * 2);
  private readonly profile = new Float32Array((COLS + 1) * PROFILE_STRIDE);
  private readonly roll = new Float32Array((ROLL_STEPS + 1) * ROLL_STRIDE);
  /** Distance of each column from the binding. */
  private readonly dist = new Float32Array(COLS + 1);
  private readonly front;
  private readonly back;
  private readonly depth = new MeshDepthMaterial({ polygonOffset: true, polygonOffsetFactor: SHADOW_SLOPE, polygonOffsetUnits: SHADOW_SLOPE });

  constructor(private readonly book: Book, fx: SurfaceFx, blank: Texture) {
    const d = book.dims;
    const paper = grainTexture('paper');
    const make = (): ReturnType<typeof createSurfaceMaterial> =>
      createSurfaceMaterial({
        map: blank,
        grain: paper,
        grainRepeat: [d.pageW * GRAIN_PER_UNIT.paper, d.pageH * GRAIN_PER_UNIT.paper],
        cloth: { ...CLOTH.paper, weave: 0.03, fibre: 0.012, sheen: 0.05 },
        shininess: 12.5,
        reflectiveness: 0.39 * 0.6,
        bumpGrain: 0.05,
        fx,
        polygonOffset: -1.5,
        bleed: true,
        transmit: TRANSMIT,
        sheet: true,
      });
    this.front = make();
    this.back = make();
    this.mesh = new Mesh(this.surface.geometry, [this.front, this.back]);
    this.mesh.name = 'leaf';
    this.mesh.castShadow = true;
    // A single sheet is lit from both sides. The surface takes shadows only where it faces the light.
    this.mesh.receiveShadow = true;
    // A sheet has no thickness, so in the shadow map it lies exactly where it is lit. Soft shadows read the map
    // some texels to each side, where a slanted sheet is nearer the light: it would shade itself. Its depth is
    // written a little further from the light, by more the steeper it stands.
    this.mesh.customDepthMaterial = this.depth;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    for (let i = 0; i <= COLS; i++) this.dist[i] = sampleDistance(d.pageW, COLS, i);
    book.volume.group.add(this.mesh);
  }

  setPages(front: Texture, back: Texture): void {
    for (const [mat, own, other] of [[this.front, front, back], [this.back, back, front]] as const) {
      const behind = (mat.userData.uniforms as Record<string, { value: unknown }>).tBack!;
      if (mat.map === own && behind.value === other) continue;
      mat.map = own;
      behind.value = other;
      mat.needsUpdate = true;
    }
  }

  /** Rebuilds the sheet for the current angle and curl. */
  update(): void {
    const { volume, dims } = this.book;
    const turn = this.motion.shown / Math.PI;
    const right = volume.layerShape(1, 1);
    const left = volume.layerShape(0, 1);
    // In the air the sheet bows back against the air and its free edge trails.
    const air = Math.sin(Math.PI * turn);
    const dir = this.motion.velocity >= 0 ? 1 : -1;
    sampleLeaf(
      {
        x: right.x,
        z: right.z,
        heading: lerp(right.heading, left.heading, turn),
        turnLength: lerp(right.turnLength, left.turnLength, turn) + 0.25 * air,
        length: dims.pageW,
        bow: -0.42 * air * dir * this.limp,
        tip: -0.3 * air * dir * this.limp,
      },
      COLS,
      this.profile,
    );
    // A sheet that lies on its stack is part of it: like the top of the stack, it throws no shadow of its own.
    // At rest it is not a leaf in the air either, and tools that count those go by the name.
    this.mesh.castShadow = air > CAST_FROM;
    this.mesh.name = this.motion.resting ? 'leaf.rest' : 'leaf';
    const P = this.profile;
    const R = this.roll;
    const D = this.dist;
    const L = dims.pageW;
    const H = dims.pageH;

    // The curl: past a slanted line across the page the sheet rolls up toward the reader.
    const c = this.curl.shape;
    const curled = c.amount > 1e-4;
    const ct = Math.cos(c.tilt);
    const st = Math.sin(c.tilt);
    const pivot = c.pivot * L;
    const reach = Math.max(1e-3, (L - pivot) * ct + (H / 2) * Math.abs(st));
    if (curled) fillRoll(R, ROLL_STEPS, reach, c.amount, c.power, c.span * L);

    // Lying on a stack the sheet keeps a little air under it, measured off the page it lies on, so its print
    // sits exactly over the print of that page. Live sheets under it raise it by their thickness. The side
    // that faces the stack swaps half way over.
    const facing = Math.cos(Math.PI * turn);
    const gap = (REST_GAP + LEAF_THICKNESS * this.below[facing >= 0 ? 0 : 1]) * facing;
    const s = this.surface;
    const count = (COLS + 1) * (ROWS + 1);
    s.begin();
    for (let i = 0; i <= COLS; i++) {
      const o = i * PROFILE_STRIDE;
      const X = D[i]!;
      const u = X / L;
      for (let r = 0; r <= ROWS; r++) {
        const v = r / ROWS;
        const Y = (v - 0.5) * H;
        const past = curled ? (X - pivot) * ct + Y * st : 0;
        if (past <= 0) {
          const tx = P[o + 2]!, tz = P[o + 3]!;
          s.vert(P[o]! - tz * gap, Y, P[o + 1]! + tx * gap, -tz, 0, tx, u, v);
          continue;
        }
        // Where this point of the page ends up: back along the fold direction and up off the sheet.
        const f = Math.min(past / reach, 1) * ROLL_STEPS;
        const k = Math.min(ROLL_STEPS - 1, Math.floor(f));
        const w = f - k;
        const a = k * ROLL_STRIDE;
        const along = lerp(R[a]!, R[a + 3]!, w) - past;
        const up = Math.max(0, lerp(R[a + 1]!, R[a + 4]!, w)) * c.lift + gap;
        const angle = lerp(R[a + 2]!, R[a + 5]!, w);
        // The flat sheet under that place, read from the cross-section.
        const land = clamp(X + along * ct, 0, L);
        const j = Math.min(COLS - 1, Math.floor(sampleIndex(L, COLS, land)));
        const d0 = D[j]!, d1 = D[j + 1]!;
        const q = d1 > d0 ? clamp((land - d0) / (d1 - d0), 0, 1) : 0;
        const b = j * PROFILE_STRIDE;
        let tx = lerp(P[b + 2]!, P[b + 6]!, q);
        let tz = lerp(P[b + 3]!, P[b + 7]!, q);
        const len = Math.hypot(tx, tz) || 1;
        tx /= len;
        tz /= len;
        const cs = Math.cos(angle);
        const sn = Math.sin(angle) * c.lift;
        s.vert(
          lerp(P[b]!, P[b + 4]!, q) - tz * up,
          Y + along * st,
          lerp(P[b + 1]!, P[b + 5]!, q) + tx * up,
          -tz * cs - tx * ct * sn,
          -st * sn,
          tx * cs - tz * ct * sn,
          u,
          v,
        );
      }
    }
    // The back of the sheet: the same points, facing the other way.
    const pos = s.pos;
    const nor = s.nor;
    const uv = s.uv;
    for (let i = 0; i < count; i++) {
      s.vert(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!, -nor[i * 3]!, -nor[i * 3 + 1]!, -nor[i * 3 + 2]!, 1 - uv[i * 2]!, uv[i * 2 + 1]!);
    }
    for (let i = 0; i < COLS; i++) {
      for (let r = 0; r < ROWS; r++) {
        const a = i * (ROWS + 1) + r;
        const b = a + ROWS + 1;
        s.quad(a, b, b + 1, a + 1, 0);
        s.quad(count + a, count + b, count + b + 1, count + a + 1, 1);
      }
    }
    s.end();
    // Lying on its stack the sheet is lit like the page below it. Lifted, it is a single sheet: it scatters light
    // inside itself and lets light through from behind, so it stays pale where a thick stack would fall dark.
    const aloft = smoothstep(0, ALOFT_AT, air);
    for (const mat of [this.front, this.back]) {
      const uniforms = mat.userData.uniforms as Record<string, { value: number }>;
      // Print shows through most at mid-turn (SPEC S-RD-9). The shader derives it from the turn progress.
      uniforms.uTurn!.value = turn;
      uniforms.uAloft!.value = aloft;
      uniforms.uWrap!.value = lerp(CLOTH.paper.wrap, WRAP_ALOFT, aloft);
      uniforms.uTransmit!.value = TRANSMIT * aloft;
    }
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.surface.geometry.dispose();
    this.front.dispose();
    this.back.dispose();
    this.depth.dispose();
  }
}
