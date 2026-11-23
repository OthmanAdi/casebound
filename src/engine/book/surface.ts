/**
 * Book surface materials. Covers and pages share one shading model, built on three's Phong material:
 *
 *  - wrapped diffuse, softened Blinn-Phong highlight and a fabric sheen lobe (cloth, SPEC S-BOOK-5),
 *  - two height sources for bump: a tiled grain and the cover's own emboss,
 *  - a foil layer whose colour shifts with the surface and view angle (S-BOOK-8),
 *  - output written as authored colour: no tone mapping, no colour-space conversion (S-REN-3),
 *  - two effects every book surface can show: "hologram" and "radio" (SPEC section 11).
 *
 * The sheen distribution is the inverted-Gaussian form published by Estevez and Kulla (2017), with the
 * visibility term of Neubelt and Pettineo (2013). Bump uses Mikkelsen's unparametrised surface gradient.
 */
import { Color, DoubleSide, FrontSide, MeshPhongMaterial, MeshStandardMaterial, NoColorSpace, Vector2, type IUniform, type Side, type Texture } from 'three';

/** Uniforms shared by every book surface, driven by the effects module. */
export interface SurfaceFx {
  uFxTime: IUniform<number>;
  uHolo: IUniform<number>;
  uRadio: IUniform<number>;
  uFxPointer: IUniform<Vector2>;
}

export const createSurfaceFx = (): SurfaceFx => ({
  uFxTime: { value: 0 },
  uHolo: { value: 0 },
  uRadio: { value: 0 },
  uFxPointer: { value: new Vector2() },
});

/**
 * A look that every book surface (covers, pages, leaves) can take on, added from outside the engine.
 * The hologram and radio looks are built in; this is how an extension adds a third.
 */
export interface SurfaceEffect {
  /** Unique kebab-case name. */
  name: string;
  /** Uniforms the effect reads. One object, shared by every book surface. */
  uniforms: Record<string, IUniform>;
  /** GLSL declarations: the uniforms above and any helper functions. */
  pars?: string;
  /** GLSL that changes `gl_FragColor` at the end of the fragment shader. `vMapUv` is the surface UV, 0..1. */
  fragment: string;
}

const surfaceEffects: SurfaceEffect[] = [];
const liveMaterials = new Set<MeshPhongMaterial>();

/** Registers a surface effect. Existing materials are rebuilt on their next draw. */
export function defineSurfaceEffect(effect: SurfaceEffect): () => void {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(effect.name)) throw new Error(`bindery: surface effect name "${effect.name}" must be kebab-case`);
  if (surfaceEffects.some((e) => e.name === effect.name)) throw new Error(`bindery: surface effect "${effect.name}" is already defined`);
  surfaceEffects.push(effect);
  for (const m of liveMaterials) m.needsUpdate = true;
  return () => {
    const i = surfaceEffects.indexOf(effect);
    if (i >= 0) surfaceEffects.splice(i, 1);
    for (const m of liveMaterials) m.needsUpdate = true;
  };
}

export interface ClothParams {
  /** Diffuse wrap: how far light creeps past the terminator. */
  wrap: number;
  /** Highlight strength over cloth. */
  gloss: number;
  /** Fabric sheen strength. */
  sheen: number;
  /** Sheen lobe width: higher is broader. */
  sheenRough: number;
  /** Darkening of the gaps between threads. */
  weave: number;
  /** Fine fibre streaks. */
  fibre: number;
}

/** Defaults by grain (S-BOOK-7). */
export const CLOTH: Readonly<Record<'buckram' | 'paper' | 'cardboard' | 'none', ClothParams>> = {
  buckram: { gloss: 0.3, sheen: 0.6, weave: 0.3, fibre: 0.05, sheenRough: 0.55, wrap: 0.3 },
  cardboard: { gloss: 0.6, sheen: 0.2, weave: 0.18, fibre: 0.03, sheenRough: 0.75, wrap: 0.2 },
  paper: { gloss: 0.7, sheen: 0.15, weave: 0.12, fibre: 0.02, sheenRough: 0.8, wrap: 0.15 },
  none: { gloss: 1, sheen: 0, weave: 0, fibre: 0, sheenRough: 0.6, wrap: 0 },
};

export interface SurfaceOptions {
  /** Colour texture. Stored values are written out as they are. */
  map: Texture;
  /** Tiled grain height. */
  grain: Texture;
  /** How many times the grain repeats across the surface in u and v. */
  grainRepeat: [number, number];
  /** Emboss height for this surface, or null. */
  emboss?: Texture | null;
  /** Red channel: foil mask. */
  finish?: Texture | null;
  cloth: ClothParams;
  /** Blinn exponent before softening. */
  shininess: number;
  /** Highlight strength, 0..1. */
  reflectiveness: number;
  bumpGrain: number;
  bumpEmboss?: number;
  foilColor?: string;
  /** 0 = plain metal foil, 1 = fully iridescent. */
  foilRainbow?: number;
  foilOpacity?: number;
  foilSpecular?: number;
  foilDetail?: number;
  side?: Side;
  fx: SurfaceFx;
  /** Polygon offset for surfaces that lie on others (turning leaves). */
  polygonOffset?: number;
  /** Share of light from behind that passes through. 0 for boards, about 0.6 for a single leaf. */
  transmit?: number;
  /** Overall brightness of the surface. Calibrated against reference frames. */
  exposure?: number;
  /** A leaf in the air lets the print on its other side show through. Set `tBack` and `uBleed` on the uniforms. */
  bleed?: boolean;
}

const PARS = /* glsl */ `
varying vec3 vViewPosition;

struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};

uniform float uWrap;
uniform float uGloss;
uniform float uSheen;
uniform float uSheenRough;
uniform float uSpecSpread;
uniform float uWeave;
uniform float uFibre;
uniform float uBumpGrain;
uniform float uBumpEmboss;
uniform vec2 uGrainRepeat;
uniform sampler2D tGrain;
uniform sampler2D tEmboss;
uniform sampler2D tFinish;
uniform vec3 uFoilColor;
uniform float uFoilRainbow;
uniform float uFoilOpacity;
uniform float uFoilSpecular;
uniform float uFoilDetail;
uniform float uFxTime;
uniform float uHolo;
uniform float uRadio;
uniform vec2 uFxPointer;
uniform sampler2D tBack;
uniform float uBleed;
uniform float uTransmit;
uniform float uExposure;

float bCloth = 1.0;
float bFoil = 0.0;
float bLod = 1.0;

float bHash( vec2 p ) {
	p = fract( p * vec2( 123.34, 456.21 ) );
	p += dot( p, p + 45.32 );
	return fract( p.x * p.y );
}

float bNoise( vec2 p ) {
	vec2 i = floor( p );
	vec2 f = fract( p );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( bHash( i ), bHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( bHash( i + vec2( 0.0, 1.0 ) ), bHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}

float bSheenD( float roughness, float NoH ) {
	float inv = 1.0 / max( roughness, 0.05 );
	float sin2 = max( 1.0 - NoH * NoH, 0.0078125 );
	return ( 2.0 + inv ) * pow( sin2, inv * 0.5 ) / ( 2.0 * PI );
}

float bSheenV( float NoV, float NoL ) {
	return 1.0 / ( 4.0 * ( NoL + NoV - NoL * NoV ) + 1e-4 );
}

vec3 bPerturb( vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir ) {
	vec3 sx = normalize( dFdx( surfPos ) );
	vec3 sy = normalize( dFdy( surfPos ) );
	vec3 r1 = cross( sy, surfNorm );
	vec3 r2 = cross( surfNorm, sx );
	float det = dot( sx, r1 ) * faceDir;
	vec3 grad = sign( det ) * ( dHdxy.x * r1 + dHdxy.y * r2 );
	return normalize( abs( det ) * surfNorm - grad );
}

vec3 bFoilTone( float t ) {
	vec3 rainbow = 0.62 + 0.38 * cos( 6.28318 * ( t + vec3( 0.0, 0.33, 0.67 ) ) );
	float metal = 0.78 + 0.22 * cos( 6.28318 * t );
	return mix( uFoilColor * metal, rainbow, uFoilRainbow );
}

float bRing( vec2 uv ) {
	float d = distance( uv, vec2( 1.0, 0.0 ) );
	return sin( d * 69.8 - uFxTime * 1.53 * 6.28318 );
}

void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float wrap = uWrap * bCloth;
	float rawNL = dot( geometryNormal, directLight.direction );
	float dotNL = saturate( ( rawNL + wrap ) / ( 1.0 + wrap ) );
	vec3 irradiance = dotNL * directLight.color;
	// Thin paper also passes light that arrives from behind.
	vec3 through = saturate( - rawNL ) * directLight.color * uTransmit;
	reflectedLight.directDiffuse += ( irradiance + through ) * BRDF_Lambert( material.diffuseColor );

	float shininess = material.specularShininess / ( 1.0 + uSpecSpread );
	float gloss = mix( 1.0, uGloss, bCloth );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, shininess ) * material.specularStrength * gloss;

	vec3 halfDir = normalize( directLight.direction + geometryViewDir );
	float NoH = saturate( dot( geometryNormal, halfDir ) );
	float NoV = saturate( dot( geometryNormal, geometryViewDir ) );
	float NoL = saturate( rawNL );
	vec3 sheenColor = mix( material.diffuseColor, vec3( 1.0 ), 0.35 );
	reflectedLight.directSpecular += directLight.color * NoL * sheenColor * bSheenD( uSheenRough, NoH ) * bSheenV( NoV, NoL ) * uSheen * bCloth;
}

void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}

#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong
`;

/** Runs right after the colour map is read: hologram resampling, cloth weave and fibre, foil colour. */
const ALBEDO = /* glsl */ `
#include <map_fragment>
{
	vec2 gUv = vMapUv * uGrainRepeat;
	bLod = 1.0 - smoothstep( 1.0, 3.0, length( fwidth( gUv ) ) * 96.0 );
	#ifdef BINDERY_FINISH
		bFoil = texture2D( tFinish, vMapUv ).r * saturate( uFoilOpacity );
	#endif
	bCloth = 1.0 - bFoil;

	if ( uHolo > 0.001 ) {
		float wave = sin( vMapUv.y * 90.0 + uFxTime * 6.1 ) * 0.003 + sin( vMapUv.y * 23.0 - uFxTime * 2.3 ) * 0.006;
		float split = 0.0147 * ( 0.6 + 0.4 * sin( uFxTime * 1.3 + uFxPointer.x * 3.0 ) );
		vec2 base = vMapUv + vec2( wave, 0.0 ) * uHolo;
		vec3 shifted = vec3( texture2D( map, base + vec2( split, 0.0 ) ).r, texture2D( map, base ).g, texture2D( map, base - vec2( split, 0.0 ) ).b );
		diffuseColor.rgb = mix( diffuseColor.rgb, shifted, uHolo );
	}

	#ifdef BINDERY_BLEED
		vec3 behind = texture2D( tBack, vec2( 1.0 - vMapUv.x, vMapUv.y ) ).rgb;
		diffuseColor.rgb *= mix( vec3( 1.0 ), behind, uBleed );
	#endif

	float grain = texture2D( tGrain, gUv ).r;
	float gaps = smoothstep( 0.52, 0.18, grain );
	diffuseColor.rgb *= 1.0 - uWeave * bCloth * bLod * gaps;
	float streak = bNoise( vMapUv * vec2( 1100.0, 55.0 ) ) + bNoise( vMapUv * vec2( 55.0, 1100.0 ) ) - 1.0;
	diffuseColor.rgb *= 1.0 + uFibre * bCloth * bLod * streak;

	#ifdef BINDERY_FINISH
		vec3 fN = normalize( vNormal );
		float ft = dot( fN, vec3( 0.61, 0.33, 0.72 ) ) * uFoilDetail * 0.35 + dot( vViewPosition.xy, vec2( 0.07, 0.05 ) ) * uFoilDetail * 0.1;
		diffuseColor.rgb = mix( diffuseColor.rgb, bFoilTone( ft ), bFoil );
	#endif
}
`;

const SPECULAR = /* glsl */ `
#include <specularmap_fragment>
specularStrength *= 1.0 + bFoil * uFoilSpecular;
`;

const BUMP = /* glsl */ `
{
	vec2 gUv = vMapUv * uGrainRepeat;
	float g0 = texture2D( tGrain, gUv ).r;
	float gx = texture2D( tGrain, gUv + dFdx( gUv ) ).r;
	float gy = texture2D( tGrain, gUv + dFdy( gUv ) ).r;
	float gs = uBumpGrain * bCloth * bLod;
	vec2 dH = vec2( gx - g0, gy - g0 ) * gs;
	#ifdef BINDERY_EMBOSS
		float e0 = texture2D( tEmboss, vMapUv ).r;
		float ex = texture2D( tEmboss, vMapUv + dFdx( vMapUv ) ).r;
		float ey = texture2D( tEmboss, vMapUv + dFdy( vMapUv ) ).r;
		dH += vec2( ex - e0, ey - e0 ) * uBumpEmboss;
	#endif
	if ( uRadio > 0.001 ) {
		float r0 = bRing( vMapUv );
		dH += vec2( bRing( vMapUv + dFdx( vMapUv ) ) - r0, bRing( vMapUv + dFdy( vMapUv ) ) - r0 ) * 0.09 * uRadio;
	}
	normal = bPerturb( - vViewPosition, normal, dH, faceDirection );
}
`;

/** Runs last: scanlines, pulse, grain and tint of the hologram; ring brightness of the radio effect. */
const FINAL = /* glsl */ `
gl_FragColor.rgb *= uExposure;
if ( uHolo > 0.001 ) {
	float scan = sin( vMapUv.y * 817.0 - uFxTime * 10.0 ) * 0.055 + sin( vMapUv.y * 136.17 - uFxTime * 6.1 ) * 0.0385;
	float pulse = 0.3 * ( 0.5 * ( 0.5 * sin( 1.7 * uFxTime ) + 0.3 * sin( 2.9 * uFxTime ) + 0.2 * sin( 0.7 * uFxTime ) ) + 0.5 );
	float grainFx = ( bHash( floor( gl_FragCoord.xy / 4.0 ) + floor( uFxTime * 12.0 ) * 7.13 ) - 0.5 ) * 0.08;
	vec3 holo = gl_FragColor.rgb * ( 1.0 + pulse ) + scan + grainFx;
	holo = mix( holo, holo * vec3( 1.06, 0.9, 1.16 ) + vec3( 0.07, 0.015, 0.11 ), 0.85 );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, holo, uHolo );
}
if ( uRadio > 0.001 ) {
	float env = max( 0.0, 0.55 * sin( 3.1 * uFxTime ) + 0.45 * sin( 1.7 * uFxTime + 1.4 ) ) * ( 0.65 + 0.35 * sin( 9.0 * uFxTime ) );
	float ringFx = bRing( vMapUv ) * ( 0.35 + 0.65 * env );
	gl_FragColor.rgb *= 1.0 + 0.35 * ringFx * uRadio;
	gl_FragColor.rgb += vec3( 0.02, 0.06, 0.09 ) * uRadio * ( 0.5 + 0.5 * ringFx );
}
#include <dithering_fragment>
`;

const VERTEX_PARS = /* glsl */ `
uniform float uRadio;
uniform float uFxTime;
#include <uv_pars_vertex>
`;

const VERTEX_DISPLACE = /* glsl */ `
#include <begin_vertex>
if ( uRadio > 0.001 ) {
	float d = distance( uv, vec2( 1.0, 0.0 ) );
	transformed += objectNormal * sin( d * 69.8 - uFxTime * 1.53 * 6.28318 ) * 0.045 * uRadio;
}
`;

/** A cover or page surface. Returns a Phong material with the cloth model patched in. */
export function createSurfaceMaterial(o: SurfaceOptions): MeshPhongMaterial {
  o.map.colorSpace = NoColorSpace;
  const mat = new MeshPhongMaterial({
    map: o.map,
    color: 0xffffff,
    specular: new Color().setScalar(o.reflectiveness),
    shininess: o.shininess,
    side: o.side ?? FrontSide,
  });
  mat.toneMapped = false;
  if (o.polygonOffset) {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = o.polygonOffset;
    mat.polygonOffsetUnits = o.polygonOffset;
  }
  const uniforms: Record<string, IUniform> = {
    uWrap: { value: o.cloth.wrap },
    uGloss: { value: o.cloth.gloss },
    uSheen: { value: o.cloth.sheen },
    uSheenRough: { value: o.cloth.sheenRough },
    uSpecSpread: { value: 3.25 },
    uWeave: { value: o.cloth.weave },
    uFibre: { value: o.cloth.fibre },
    uBumpGrain: { value: o.bumpGrain },
    uBumpEmboss: { value: o.bumpEmboss ?? 0 },
    uGrainRepeat: { value: new Vector2(...o.grainRepeat) },
    tGrain: { value: o.grain },
    tEmboss: { value: o.emboss ?? null },
    tFinish: { value: o.finish ?? null },
    uFoilColor: { value: new Color(o.foilColor ?? '#d9b25a') },
    uFoilRainbow: { value: o.foilRainbow ?? 0 },
    uFoilOpacity: { value: o.foilOpacity ?? 1 },
    uFoilSpecular: { value: o.foilSpecular ?? 1.2 },
    uFoilDetail: { value: o.foilDetail ?? 2.6 },
    tBack: { value: null },
    uBleed: { value: 0 },
    uTransmit: { value: o.transmit ?? 0 },
    uExposure: { value: o.exposure ?? 0.9 },
    ...o.fx,
  };
  mat.userData.uniforms = uniforms;
  mat.defines = { ...(mat.defines ?? {}) };
  if (o.emboss) mat.defines.BINDERY_EMBOSS = '';
  if (o.finish) mat.defines.BINDERY_FINISH = '';
  if (o.bleed) mat.defines.BINDERY_BLEED = '';
  liveMaterials.add(mat);
  mat.addEventListener('dispose', () => liveMaterials.delete(mat));
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    for (const e of surfaceEffects) Object.assign(shader.uniforms, e.uniforms);
    const extraPars = surfaceEffects.map((e) => e.pars ?? '').join('\n');
    const extraFinal = surfaceEffects.map((e) => '{\n' + e.fragment + '\n}').join('\n');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <lights_phong_pars_fragment>', PARS + extraPars)
      .replace('#include <map_fragment>', ALBEDO)
      .replace('#include <specularmap_fragment>', SPECULAR)
      .replace('#include <normal_fragment_maps>', BUMP)
      .replace('#include <colorspace_fragment>', '')
      .replace('#include <dithering_fragment>', FINAL.replace('#include <dithering_fragment>', extraFinal + '\n#include <dithering_fragment>'));
    shader.vertexShader = shader.vertexShader.replace('#include <uv_pars_vertex>', VERTEX_PARS).replace('#include <begin_vertex>', VERTEX_DISPLACE);
  };
  mat.customProgramCacheKey = () => `bindery-surface-${o.emboss ? 'e' : ''}${o.finish ? 'f' : ''}${o.bleed ? 'b' : ''}-${surfaceEffects.map((e) => e.name).join('+')}`;
  return mat;
}

/** Page edges: a standard lit material, tone mapped like the rest of the built-in pipeline. */
export function createEdgeMaterial(map: Texture, tint = '#d9d5cd'): MeshStandardMaterial {
  return new MeshStandardMaterial({ map, color: tint, roughness: 0.85, metalness: 0, side: DoubleSide });
}
