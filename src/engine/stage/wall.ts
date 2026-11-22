/**
 * The shadow wall. Books do not stand on a floor: they float in front of an invisible wall that only shows
 * their shadow. The shadow softens and fades as the book comes forward (SPEC section 4).
 */
import { Mesh, PlaneGeometry, ShadowMaterial, Vector3 } from 'three';
import { approach, smoothstep } from '../core/math';
import type { Registry } from '../core/registry';
import { tunable } from '../core/tune';

export class ShadowWall {
  readonly mesh: Mesh<PlaneGeometry, ShadowMaterial>;
  readonly centre = new Vector3(0, -1.482, -54.5);
  /** Multiplier for the key light's shadow radius this frame. */
  radiusScale = 1;

  private readonly tune;
  private opacity = 0.855;

  constructor(registry: Registry) {
    this.tune = tunable(registry, {
      id: 'stage.wall',
      label: 'Shadow wall',
      kind: 'shadow-catcher',
      tags: ['shadow', 'environment'],
      describe: 'An invisible plane behind the books that receives the key light shadow.',
      source: 'src/engine/stage/wall.ts',
      params: {
        size: { value: 172.74, min: 10, max: 400, help: 'Edge length of the wall, world units' },
        z: { value: -54.5, min: -200, max: 0, help: 'Depth of the wall. The shelf plane is at -36' },
        y: { value: -1.482, min: -40, max: 40 },
        color: { value: '#0a0a12', help: 'Shadow colour' },
        opacity: { value: 0.855, min: 0, max: 1, help: 'Shadow darkness with the book at the shelf plane' },
        fadeNear: { value: 2, min: 0, max: 100, help: 'Book distance from the wall where the shadow starts to fade' },
        fadeFar: { value: 36, min: 1, max: 200, help: 'Book distance from the wall where the fade is complete' },
        fadeAmount: { value: 0.875, min: 0, max: 1, help: 'Share of the opacity lost at full distance' },
        blurBase: { value: 0.1014, min: 0, max: 2, help: 'Base widening of the shadow blur (0.06 x 1.69)' },
        blurGrow: { value: 2.25, min: 0, max: 10, help: 'Extra blur at full distance, as a multiple of the base' },
        insideDim: { value: 0.5, min: 0, max: 1, help: 'Opacity multiplier while the reader is open' },
        followRate: { value: 8, min: 0.1, max: 60, unit: '1/s' },
      },
      onChange: (key) => {
        if (key === 'size') {
          this.mesh.geometry.dispose();
          this.mesh.geometry = new PlaneGeometry(this.tune.size, this.tune.size);
        }
      },
    });
    const t = this.tune;
    this.mesh = new Mesh(new PlaneGeometry(t.size, t.size), new ShadowMaterial({ color: t.color, opacity: t.opacity, transparent: true }));
    this.mesh.name = 'stage.wall';
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.position.copy(this.centre);
    this.mesh.renderOrder = -10;
  }

  /**
   * @param bookZ depth of the active book
   * @param inside 0..1 reader openness
   * @returns true while the wall is still settling
   */
  update(dt: number, bookZ: number, inside: number, still: boolean): boolean {
    const t = this.tune;
    this.centre.set(0, t.y, t.z);
    this.mesh.position.copy(this.centre);
    this.mesh.material.color.set(t.color);
    const distT = smoothstep(t.fadeNear, t.fadeFar, bookZ - t.z);
    const goal = t.opacity * (1 - t.fadeAmount * distT) * (1 - (1 - t.insideDim) * inside);
    const prev = this.opacity;
    this.opacity = still ? goal : approach(this.opacity, goal, t.followRate, dt);
    this.mesh.material.opacity = this.opacity;
    this.radiusScale = 1 + t.blurBase * (1 + t.blurGrow * distT);
    return Math.abs(this.opacity - prev) > 1e-4;
  }
}
