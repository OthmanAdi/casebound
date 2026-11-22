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
  /** Multiplier for the key light's shadow radius this frame. */
  radiusScale = 1;

  private readonly tune;
  private opacity = 0.855;
  private readonly blur = { value: 6 };

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
        softness: { value: 6, min: 0.2, max: 30, help: 'Widens the wall shadow beyond the light radius. 16 samples on a rotated disk' },
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
      shader.fragmentShader = shader.fragmentShader.replace('void main() {', `${WALL_SHADOW}\nvoid main() {`).replace('getShadowMask()', 'bWallShadow()');
    };
    material.customProgramCacheKey = () => 'bindery-wall';
    this.mesh = new Mesh(new PlaneGeometry(t.size, t.size), material);
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
    this.blur.value = t.softness;
    return Math.abs(this.opacity - prev) > 1e-4;
  }
}
