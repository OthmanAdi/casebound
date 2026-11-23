/**
 * The shadow wall. Books do not stand on a floor: they float in front of an invisible wall that only shows
 * their shadow. The shadow softens and fades as the book comes forward (SPEC section 4).
 */
import { Mesh, PlaneGeometry, ShadowMaterial, Vector3 } from 'three';
import { approach, smoothstep } from '../core/math';
import type { Registry } from '../core/registry';
import { tunable } from '../core/tune';

/**
 * Replaces the stock shadow lookup on the wall with 16 samples on a rotated disk, so the shadow can be several
 * times wider than the light's own radius without banding.
 */
const WALL_SHADOW = /* glsl */ `
uniform float uWallBlur;
float bWallShadow() {
	float shadow = 1.0;
	#if defined( USE_SHADOWMAP ) && defined( SHADOWMAP_TYPE_PCF ) && NUM_DIR_LIGHT_SHADOWS > 0
		DirectionalLightShadow wallLight = directionalLightShadows[ 0 ];
		vec4 coord = vDirectionalShadowCoord[ 0 ];
		coord.xyz /= coord.w;
		coord.z += wallLight.shadowBias;
		if ( coord.x >= 0.0 && coord.x <= 1.0 && coord.y >= 0.0 && coord.y <= 1.0 && coord.z <= 1.0 ) {
			vec2 radius = wallLight.shadowRadius * uWallBlur / wallLight.shadowMapSize;
			float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
			float sum = 0.0;
			for ( int i = 0; i < 16; i ++ ) {
				sum += texture( directionalShadowMap[ 0 ], vec3( coord.xy + vogelDiskSample( i, 16, phi ) * radius, coord.z ) );
			}
			shadow = mix( 1.0, sum / 16.0, wallLight.shadowIntensity );
		}
	#else
		shadow = getShadowMask();
	#endif
	return shadow;
}
`;

export class ShadowWall {
  readonly mesh: Mesh<PlaneGeometry, ShadowMaterial>;
  readonly centre = new Vector3(0, -1.482, -54.5);
  /** How much wider than the key light's radius the wall draws its shadow this frame. */
  radiusScale = 1;

  private readonly tune;
  private opacity = 0.855;
  /** How far the book is from the wall, 0..1 between `fadeNear` and `fadeFar`, eased. */
  private distance = -1;
  private readonly blur = { value: 1 };

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
        followRate: { value: 10, min: 0.1, max: 60, unit: '1/s', help: 'How fast the fade follows the book. Measured: 10' },
        reachBase: { value: 7.6, min: 0, max: 30, help: 'How far the box that the fade is measured on reaches out from the pivot of a book whatever its pose. The reference measures a box around a larger model than our case: at rest its far corner is 10.5 in front of the pivot and comes only 0.7 nearer while a book turns away' },
        reachScale: { value: 0.33, min: 0, max: 3, help: 'Share of the reach of our own case that is added to it. With 7.6 and 0.33 the resting book and the book that turns away both give their measured fade' },
        softness: { value: 1, min: 0.2, max: 30, help: 'Extra widening of the wall shadow on top of the measured blur. 16 samples on a rotated disk' },
      },
      onChange: (key) => {
        if (key === 'size') {
          this.mesh.geometry.dispose();
          this.mesh.geometry = new PlaneGeometry(this.tune.size, this.tune.size);
        }
      },
    });
    const t = this.tune;
    const material = new ShadowMaterial({ color: t.color, opacity: t.opacity, transparent: true });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uWallBlur = this.blur;
      // The call in main() first, then the function: the other way round, the call inside the function is the first match.
      shader.fragmentShader = shader.fragmentShader.replace('getShadowMask()', 'bWallShadow()').replace('void main() {', `${WALL_SHADOW}\nvoid main() {`);
    };
    material.customProgramCacheKey = () => 'casebound-wall';
    this.mesh = new Mesh(new PlaneGeometry(t.size, t.size), material);
    this.mesh.name = 'stage.wall';
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.position.copy(this.centre);
    this.mesh.renderOrder = -10;
  }

  /**
   * @param pivot distance from the wall to the pivot of the active book
   * @param reach distance from the wall to the point of the active book that is farthest from it
   * @param inside 0..1 reader openness
   * @returns true while the wall is still settling
   */
  update(dt: number, pivot: number, reach: number, inside: number, still: boolean): boolean {
    const t = this.tune;
    this.centre.set(0, t.y, t.z);
    this.mesh.position.copy(this.centre);
    this.mesh.material.color.set(t.color);
    // Measured (SPEC S-WALL-3): the fade follows the far corner of the book, not its pivot, and is eased.
    // Measured in the open reader: the fade is complete, whatever the open book's own extent.
    const goal = Math.max(smoothstep(t.fadeNear, t.fadeFar, pivot + t.reachBase + (reach - pivot) * t.reachScale), inside);
    const before = this.distance;
    this.distance = still || before < 0 ? goal : approach(before, goal, t.followRate, Math.min(dt, 0.05));
    const prev = this.opacity;
    this.opacity = t.opacity * (1 - t.fadeAmount * this.distance) * (1 - (1 - t.insideDim) * inside);
    this.mesh.material.opacity = this.opacity;
    // The wall alone widens its blur with distance. Shadows on the books keep the light's own radius.
    this.radiusScale = 1 + t.blurBase * (1 + t.blurGrow * this.distance);
    this.blur.value = this.radiusScale * t.softness;
    return Math.abs(this.opacity - prev) > 1e-4 || Math.abs(this.distance - before) > 1e-4;
  }
}
