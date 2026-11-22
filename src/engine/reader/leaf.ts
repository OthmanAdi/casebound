/**
 * One turning leaf: a sheet with a page on each side. Its shape comes from the same cross-section model as the
 * page blocks, so at rest it lies exactly on the stack it belongs to.
 */
import { Mesh, type Texture } from 'three';
import type { Book } from '../book/book';
import { GRAIN_PER_UNIT, grainTexture } from '../book/painter';
import { PROFILE_STRIDE, sampleDistance, sampleLeaf } from '../book/profile';
import { CLOTH, createSurfaceMaterial, type SurfaceFx } from '../book/surface';
import { Surface } from '../book/volume';
import { lerp } from '../core/math';
import { createLeafMotion, type LeafMotion } from './leaf-physics';

const SAMPLES = 40;

export class Leaf {
  readonly mesh: Mesh;
  readonly motion: LeafMotion = createLeafMotion(0);
  /** Index of this leaf in the book: its front is page 2j + 1, its back page 2j + 2. */
  index = -1;
  active = false;

  private readonly surface = new Surface((SAMPLES + 1) * 4);
  private readonly profile = new Float32Array((SAMPLES + 1) * PROFILE_STRIDE);
  private readonly front;
  private readonly back;

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
      });
    this.front = make();
    this.back = make();
    this.mesh = new Mesh(this.surface.geometry, [this.front, this.back]);
    this.mesh.name = 'leaf';
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    book.volume.group.add(this.mesh);
  }

  setPages(front: Texture, back: Texture): void {
    for (const [mat, own, other] of [[this.front, front, back], [this.back, back, front]] as const) {
      mat.map = own;
      (mat.userData.uniforms as Record<string, { value: unknown }>).tBack!.value = other;
      mat.needsUpdate = true;
    }
  }

  /** Rebuilds the sheet for the current angle. */
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
        z: right.z + 0.012,
        heading: lerp(right.heading, left.heading, turn),
        turnLength: lerp(right.turnLength, left.turnLength, turn) + 0.25 * air,
        length: dims.pageW,
        bow: -0.42 * air * dir,
        tip: -0.3 * air * dir,
      },
      SAMPLES,
      this.profile,
    );
    const s = this.surface;
    const y0 = -dims.pageH / 2;
    const y1 = dims.pageH / 2;
    const P = this.profile;
    s.begin();
    const f: number[] = [];
    const b: number[] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const o = i * PROFILE_STRIDE;
      const x = P[o]!, z = P[o + 1]!, tx = P[o + 2]!, tz = P[o + 3]!;
      const u = sampleDistance(dims.pageW, SAMPLES, i) / dims.pageW;
      f.push(s.vert(x, y0, z, -tz, 0, tx, u, 0), s.vert(x, y1, z, -tz, 0, tx, u, 1));
    }
    for (let i = 0; i <= SAMPLES; i++) {
      const o = i * PROFILE_STRIDE;
      const x = P[o]!, z = P[o + 1]!, tx = P[o + 2]!, tz = P[o + 3]!;
      const u = 1 - sampleDistance(dims.pageW, SAMPLES, i) / dims.pageW;
      b.push(s.vert(x, y0, z, tz, 0, -tx, u, 0), s.vert(x, y1, z, tz, 0, -tx, u, 1));
    }
    for (let i = 0; i < SAMPLES; i++) {
      s.quad(f[i * 2]!, f[(i + 1) * 2]!, f[(i + 1) * 2 + 1]!, f[i * 2 + 1]!, 0);
      s.quad(b[i * 2]!, b[(i + 1) * 2]!, b[(i + 1) * 2 + 1]!, b[i * 2 + 1]!, 1);
    }
    s.end();
    // Print shows through most at mid-turn (SPEC S-RD-9).
    const bleed = 0.3 * air;
    (this.front.userData.uniforms as Record<string, { value: number }>).uBleed!.value = bleed;
    (this.back.userData.uniforms as Record<string, { value: number }>).uBleed!.value = bleed;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.surface.geometry.dispose();
    this.front.dispose();
    this.back.dispose();
  }
}
