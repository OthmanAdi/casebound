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
import { Color, DoubleSide, FrontSide, MeshPhongMaterial, MeshStandardMaterial, NoColorSpace, ShaderChunk, Vector2, Vector4, type IUniform, type Side, type Texture } from 'three';

/** Uniforms shared by every book surface, driven by the effects module. */
export interface SurfaceFx {
  uFxTime: IUniform<number>;
  uHolo: IUniform<number>;
  uRadio: IUniform<number>;
  uFxPointer: IUniform<Vector2>;
  /** Strength of the film grain on every book surface. 0 switches it off. */
  uFilm: IUniform<number>;
  /** Changes with every drawn frame, so the grain never stands still while something moves. */
  uFilmSeed: IUniform<number>;
  /** Light that bounces between facing pages near the gutter: strength, reach as a share of the page width, sharpness. */
  uBounce: IUniform<number>;
  uBounceReach: IUniform<number>;
  uBounceSharp: IUniform<number>;
  uBounceColor: IUniform<Color>;
  /** Strength of the shade in the fold itself. */
  uGutterShade: IUniform<number>;
  /** How far the brightness ceiling of paper applies: 1 while books are shut, 0 once the pages of the open one have parted. */
  uShoulder: IUniform<number>;
  /** Depth of stamped relief, as a multiple of each cover's own strength. */
  uStamp: IUniform<number>;
  /** The joint of a case, see `JOINT`: corner, drop, start, run. */
  uJointShape: IUniform<Vector4>;
  /** Foil, see `FOIL`: tint of an iridescent foil, share of the grain that shows through foil. */
  uFoilLook: IUniform<Vector2>;
  /** What head and tail of a page block are multiplied by, see `EDGE_ENDS`. */
  uEdgeEnds: IUniform<Color>;
}

/**
 * Foil. Measured on an iridescent foil at shelf distance: saturation 0.10 to 0.25 at a value of 0.90 to 0.98,
 * the hue running through more than half the circle across one cover and staying within 6 degrees while the
 * pointer moves. The grain under a foil shows at about a third of its strength.
 */
export const FOIL = {
  /** How much of each colour in turn an iridescent foil holds back, 0 to 0.5. 0.14 gives the measured pastel, 0.38 a full rainbow. */
  tint: 0.14,
  /** Share of the grain of the material that shows through foil, 0 to 1. */
  grain: 0.3,
} as const;

/**
 * The joint: where a board meets the spine. Measured across the joint of a closed book on the shelf: the spine is
 * evenly lit up to its edge, the cloth reaches the brightness of the board within 5 pixels (0.16 world units), is
 * 14 percent darker 0.25 units further on, and is back at the brightness of the board after 0.45. On a cover
 * that faces the camera in the row the dark band lies further out, 0.5 units from the edge, and is 20 percent
 * darker. Those are the two walls of one groove: the lights shade the near wall in one pose and the far wall in
 * the other.
 * The case is built with a round hinge, so the relief does two things. It turns the normals of the hinge toward
 * the spine before its middle and toward the board after it, which reads as a square back. And it presses a
 * groove into the board beside that edge.
 */
export const JOINT = {
  /** How square the back reads: 0 leaves the hinge round as built, 1 turns the normals by the bend of its centre line, and the outer face of a board needs about 1.25. */
  corner: 1.25,
  /** Depth of the groove beside the spine, world units. */
  drop: 0.11,
  /** Where the groove starts, measured from the middle of the hinge toward the board, world units. */
  start: 0.05,
  /** Width of the groove, world units. */
  run: 0.6,
} as const;

/**
 * Slope of the joint relief along the cover, at `s` world units from the middle of a hinge toward its board.
 * `half` is half the length of the hinge, `bend` the angle it is bent by in radians (a quarter turn when the
 * book is closed). Positive slopes rise toward the board. The shader holds the same formula.
 */
export function jointSlope(s: number, half: number, bend: number, shape: { corner: number; drop: number; start: number; run: number } = JOINT): number {
  const p = Math.max(-1, Math.min(1, s / half));
  const edge = Math.min(1, Math.abs(p) / 0.35);
  const soft = edge * edge * (3 - 2 * edge);
  const turn = Math.min(1.2, Math.max(0, bend) * 0.5 * (1 - Math.abs(p)));
  const corner = Math.abs(s) < half ? shape.corner * Math.tan(turn) * soft * (p < 0 ? 1 : -1) : 0;
  const run = Math.max(1e-4, shape.run);
  const q = (s - shape.start) / run;
  const groove = q > 0 && q < 1 ? ((-shape.drop * Math.PI) / run) * Math.sin(2 * Math.PI * q) : 0;
  return corner + groove;
}

export const createSurfaceFx = (): SurfaceFx => ({
  uFxTime: { value: 0 },
  uHolo: { value: 0 },
  uRadio: { value: 0 },
  uFxPointer: { value: new Vector2() },
  uFilm: { value: 0 },
  uFilmSeed: { value: 0 },
  uBounce: { value: 0.39 * 0.6 },
  uBounceReach: { value: 0.29 },
  uBounceSharp: { value: 1.87 },
  uBounceColor: { value: new Color(0.6, 0.52, 0.69) },
  uGutterShade: { value: 1 },
  uShoulder: { value: 1 },
  uStamp: { value: 1 },
  uJointShape: { value: new Vector4(JOINT.corner, JOINT.drop, JOINT.start, JOINT.run) },
  uFoilLook: { value: new Vector2(FOIL.tint, FOIL.grain) },
  uEdgeEnds: { value: edgeEndsColor() },
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
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(effect.name)) throw new Error(`casebound: surface effect name "${effect.name}" must be kebab-case`);
  if (surfaceEffects.some((e) => e.name === effect.name)) throw new Error(`casebound: surface effect "${effect.name}" is already defined`);
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
  /** Output gain of surfaces with this grain. Default 0.9. */
  exposure?: number;
  /** Share of the film grain this surface takes, 0..1. Measured on pages only: pages and endpapers take all of it, cover materials none, whatever they are made of. */
  film?: number;
  /**
   * Tooth of the material: a soft mottle in colour and relief, 0.14 and 0.05 world units across, that does not fade
   * with distance. Range 0 to 0.1. Measured cloth has next to none at this size (0.2 percent of its brightness), so
   * the defaults are small; raise it for a felted or worn material.
   */
  mottle?: number;
  /**
   * Brightest value the surface reaches on screen while the book is shut, 0..1. The lamps of the shelf are set
   * for dark cloth; white paper under them would burn out. Light above about three quarters of the ceiling is
   * rolled off toward it. Once the pages part, the lamps are those of the reader and paper is shown as it is.
   * 0 or none: no limit.
   */
  ceiling?: number;
  /**
   * How much of the grain tile's range is real relief, 0 to 1. Times `bumpGrain` it is the depth of the grain in
   * world units. Set so that a spine facing the camera in the row shows the measured grain: for buckram 1.9 percent
   * of its brightness at a `bumpGrain` of 0.037 and 4.2 at 0.073, for paper 1.4 at 0.059 and 1.9 at 0.098.
   */
  relief?: number;
}

/**
 * What pages, leaves and endpapers add to paper: all of the film grain, and a ceiling on their brightness while
 * the book is shut. The first leaf under an opening cover takes 1.35 times full white from the shelf lamps; on
 * the reference it tops out at 228 of 255. A cover made of paper takes neither.
 */
export const PAGE_PAPER: Readonly<Pick<ClothParams, 'film' | 'ceiling'>> = { film: 1, ceiling: 0.91 };

/** Defaults by grain (S-BOOK-7). */
export const CLOTH: Readonly<Record<'buckram' | 'paper' | 'cardboard' | 'none', ClothParams>> = {
  buckram: { gloss: 0.3, sheen: 0.6, weave: 0.3, fibre: 0.05, sheenRough: 0.55, wrap: 0.3, mottle: 0.012, relief: 0.8 },
  cardboard: { gloss: 0.6, sheen: 0.2, weave: 0.18, fibre: 0.03, sheenRough: 0.75, wrap: 0.2, mottle: 0.012, relief: 0.19 },
  // Paper measured 7 percent darker on screen than the reference before its gain was raised.
  paper: { gloss: 0.7, sheen: 0.15, weave: 0.12, fibre: 0.02, sheenRough: 0.8, wrap: 0.15, exposure: 1.05, mottle: 0.006, relief: 0.19 },
  none: { gloss: 1, sheen: 0, weave: 0, fibre: 0, sheenRough: 0.6, wrap: 0 },
};

export interface SurfaceOptions {
  /** Colour texture. Stored values are written out as they are. */
  map: Texture;
  /** Tiled grain height. */
  grain: Texture;
  /** How many times the grain repeats across the surface in u and v. */
  grainRepeat: [number, number];
  /** How many times the grain repeats across one world unit of the surface. */
  grainPerUnit: number;
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
  /** For a page: where the spine is across its picture, 0 = at the left edge, 1 = at the right. Pages get the light and shade of the gutter. */
  gutter?: 0 | 1;
  /** A leaf in the air lets the print on its other side show through. Set `tBack` and `uTurn` (0..1) on the uniforms. */
  bleed?: boolean;
  /** A single sheet. Set `uAloft` on the uniforms: 0 while it lies on a stack, 1 in the air, where it takes shadows only on the side that faces the light. */
  sheet?: boolean;
  /**
   * A case: where its two hinges lie along u. `back` and `front` are the middles of the hinges, `half` is half the
   * length of a hinge, all as shares of the strip, and `length` is the strip in world units. The surface then shows
   * the joints (see `JOINT`). Set `uHinge` on the uniforms to how far each hinge is bent.
   */
  joint?: { back: number; front: number; half: number; length: number };
  /**
   * The inside of a case: the cloth of the cover is turned in over the edges of the boards, and the colour map
   * (the endpaper) shows only inside that margin. `margin` is its width as a share of the surface in u and v,
   * `repeat` is how often the colour map repeats across the surface. Both can be set later on the uniform `uTurnIn`.
   */
  turnIn?: { color: string; margin: [number, number]; repeat: [number, number] };
}

/**
 * The light loop of a single sheet. Lying on its stack (`uAloft` 0) a sheet takes shadows like the page below it.
 * In the air it takes them only on the side that faces the light: the side turned away is lit by what passes
 * through the paper, and the sheet's own shadow would black that out.
 */
/** Shadow samples per pixel on book surfaces. The library takes 5, which leaves a visible stipple in a wide penumbra. */
export const SHADOW_TAPS = 16;

/**
 * The library's shadow lookup with more samples on the same rotated disk, so the soft edge of a shadow that
 * falls across a page is smooth instead of dotted. If a library update rewrites the lookup, the pattern below
 * finds nothing and the stock lookup is used; a unit test notices.
 */
export const SOFT_SHADOWS = ShaderChunk.shadowmap_pars_fragment.replace(
  /shadow = \(\s*(?:texture\( shadowMap, vec3\( shadowCoord\.xy \+ vogelDiskSample\( \d, 5, phi \) \* radius, shadowCoord\.z \) \)\s*\+?\s*){5}\) \* 0\.2;/,
  `float bSum = 0.0;
				for ( int i = 0; i < ${SHADOW_TAPS}; i ++ ) bSum += texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( i, ${SHADOW_TAPS}, phi ) * radius, shadowCoord.z ) );
				shadow = bSum / ${SHADOW_TAPS}.0;`,
);

export const SHEET_LIGHTS = ShaderChunk.lights_fragment_begin.replace(
  /directLight\.color \*= (\( directLight\.visible && receiveShadow \) \? get\w*Shadow\([^;]*\) : 1\.0);/g,
  'directLight.color *= mix( 1.0, $1, mix( 1.0, smoothstep( 0.0, 0.25, dot( geometryNormal, directLight.direction ) ), uAloft ) );',
);

const PARS = /* glsl */ `
varying vec3 vViewPosition;
varying vec2 vRingUv;

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
uniform float uMottle;
uniform float uBumpGrain;
uniform float uBumpEmboss;
uniform vec2 uGrainRepeat;
uniform float uGrainScale;
uniform float uGrainRelief;
uniform sampler2D tGrain;
uniform sampler2D tEmboss;
uniform sampler2D tFinish;
uniform vec3 uFoilColor;
uniform float uFoilRainbow;
uniform float uFoilOpacity;
uniform float uFoilSpecular;
uniform float uFoilDetail;
uniform vec2 uFoilLook;
uniform float uFxTime;
uniform float uHolo;
uniform float uRadio;
uniform vec2 uFxPointer;
uniform float uFilm;
uniform float uFilmSeed;
uniform float uFilmShare;
#ifdef CASEBOUND_TURNIN
	// Width of the margin as a share of the surface in u and v, and how often the colour map repeats across it.
	uniform vec4 uTurnIn;
	uniform vec3 uTurnInColor;
#endif
uniform float uGutter;
uniform float uBounce;
uniform float uBounceReach;
uniform float uBounceSharp;
uniform vec3 uBounceColor;
uniform float uGutterShade;
uniform float uStamp;
uniform sampler2D tBack;
uniform float uBleed;
uniform float uTurn;
uniform float uTransmit;
uniform float uAloft;
uniform float uExposure;
uniform float uCeiling;
uniform float uShoulder;

float bCloth = 1.0;
float bTurnedIn = 0.0;
float bFoil = 0.0;
float bLod = 1.0;
float bMottle = 0.0;

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
	// The steps across one pixel keep their length, so a height is a length in world units and a relief has the
	// same slope from any distance and at any pixel ratio.
	vec3 sx = dFdx( surfPos );
	vec3 sy = dFdy( surfPos );
	vec3 r1 = cross( sy, surfNorm );
	vec3 r2 = cross( surfNorm, sx );
	float det = dot( sx, r1 ) * faceDir;
	vec3 grad = sign( det ) * ( dHdxy.x * r1 + dHdxy.y * r2 );
	return normalize( abs( det ) * surfNorm - grad );
}

// Where in its run of tones a foil is, from -0.5 to 0.5: sines of the normal and of the place in view, so the
// tone changes across a cover and as the book turns (SPEC S-BOOK-8). A stamped wall or a thread tilts the normal
// and so takes a tone of its own.
float bFoilPhase( vec3 n ) {
	float ax = - n.x * uFoilDetail + vViewPosition.x * uFoilDetail * 0.1;
	float ay = - n.y * uFoilDetail + vViewPosition.y * uFoilDetail * 0.1;
	return 0.25 * ( sin( ay ) + cos( ax ) );
}

vec3 bFoilTone( float t ) {
	// Plain metal is the colour of the foil, a little darker and lighter along its run.
	float metal = 0.78 + 0.22 * cos( 6.28318 * t );
	// An iridescent foil has a film over the metal that holds back a little of one colour at a time.
	vec3 film = 1.0 - uFoilLook.x * ( 1.0 - cos( 6.28318 * ( t * 2.0 + vec3( 0.0, 0.33, 0.67 ) ) ) );
	return uFoilColor * mix( vec3( metal ), film, uFoilRainbow );
}

#ifdef CASEBOUND_JOINT
	// uJoint: u of the middle of the back hinge and of the front hinge, half a hinge in u, world units per u.
	// uHinge: how far the back and the front hinge are bent, radians. uJointShape: corner, drop, start, run.
	uniform vec4 uJoint;
	uniform vec2 uHinge;
	uniform vec4 uJointShape;
	// Slope of the joint relief along the cover. The same formula as jointSlope() in surface.ts.
	float bJointSlope( float u ) {
		float sb = ( uJoint.x - u ) * uJoint.w;
		float sf = ( u - uJoint.y ) * uJoint.w;
		float s = max( sb, sf );
		float bend = sf > sb ? uHinge.y : uHinge.x;
		float hl = uJoint.z * uJoint.w;
		float p = clamp( s / hl, - 1.0, 1.0 );
		float turn = min( 1.2, max( bend, 0.0 ) * 0.5 * ( 1.0 - abs( p ) ) );
		float corner = uJointShape.x * tan( turn ) * smoothstep( 0.0, 0.35, abs( p ) ) * ( p < 0.0 ? 1.0 : - 1.0 ) * step( abs( s ), hl );
		float run = max( uJointShape.w, 1e-4 );
		float q = ( s - uJointShape.z ) / run;
		float groove = - uJointShape.y * PI / run * sin( 2.0 * PI * q ) * step( 0.0, q ) * step( q, 1.0 );
		return corner + groove;
	}
#endif

// Evenly spaced rings that travel outward from the upper corner of the picture and fade with distance. 0 to 1.
float bRing( vec2 uv ) {
	float d = distance( uv, vec2( 1.0, 1.0 ) );
	float ring = sin( d * 69.8 - uFxTime * 1.53 * 6.28318 ) * 0.5 + 0.5;
	return ring * ring * ( 1.0 - smoothstep( 0.0, 1.2, d ) );
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

/** Width of a grain tile in texels. The painter makes its tiles this size, and the weave twice this size. */
export const GRAIN_TILE = 256;

/** Runs right after the colour map is read: hologram resampling, cloth weave and fibre, foil colour. */
const ALBEDO = /* glsl */ `
#include <map_fragment>
{
	vec2 gUv = vMapUv * uGrainRepeat;
	// A grain tile holds ${GRAIN_TILE} texels of paper or a quarter as many threads of cloth. The colour of weave and
	// fibres fades out as a pixel grows from one to three of these (SPEC S-BOOK-5). The relief needs no such fade:
	// the smaller copies of the tile flatten it.
	bLod = 1.0 - smoothstep( 1.0, 3.0, length( fwidth( gUv ) ) * ${GRAIN_TILE}.0 );
	#ifdef CASEBOUND_FINISH
		bFoil = texture2D( tFinish, vMapUv ).r * saturate( uFoilOpacity );
	#endif
	bCloth = 1.0 - bFoil;

	#ifdef CASEBOUND_TURNIN
		// The cloth of the case is turned in over the edges of the boards. The endpaper starts inside that margin.
		vec2 inner = vMapUv / uTurnIn.zw;
		vec2 toEdge = min( inner, 1.0 - inner ) / uTurnIn.xy;
		bTurnedIn = 1.0 - smoothstep( 0.96, 1.0, min( toEdge.x, toEdge.y ) );
		diffuseColor.rgb = mix( diffuseColor.rgb, uTurnInColor, bTurnedIn );
	#endif

	#ifdef CASEBOUND_BLEED
		vec3 behind = texture2D( tBack, vec2( 1.0 - vMapUv.x, vMapUv.y ) ).rgb;
		diffuseColor.rgb *= mix( vec3( 1.0 ), behind, uBleed * sin( PI * uTurn ) );
	#endif

	float grain = texture2D( tGrain, gUv ).r;
	float gaps = smoothstep( 0.52, 0.18, grain );
	diffuseColor.rgb *= 1.0 - uWeave * bCloth * bLod * gaps;
	float streak = bNoise( vMapUv * vec2( 1100.0, 55.0 ) ) + bNoise( vMapUv * vec2( 55.0, 1100.0 ) ) - 1.0;
	diffuseColor.rgb *= 1.0 + uFibre * bCloth * bLod * streak;
	// Tooth: a mottle of two sizes, 0.14 and 0.05 world units. Unlike the weave it does not fade with distance.
	vec2 mUv = gUv / uGrainScale * 7.0;
	bMottle = bNoise( mUv ) * 0.62 + bNoise( mUv * 2.9 + 17.0 ) * 0.38 - 0.5;
	diffuseColor.rgb *= 1.0 + uMottle * bCloth * bMottle * 2.0;

}
`;

/**
 * World units across one pixel at pixel ratio 1 in a window 900 high: a book on the shelf (90.1 from the camera)
 * and one in the reader (76.1 away, scaled 1.1). Relief strengths were first tuned as slopes per pixel in these
 * two views; times these lengths they are heights in world units that give the same slopes there.
 */
const SHELF_PIXEL = (2 * 90.1 * Math.tan((9 * Math.PI) / 180)) / 900;
const READER_PIXEL = (2 * 76.1 * Math.tan((9 * Math.PI) / 180)) / 900 / 1.1;

const SPECULAR = /* glsl */ `
#include <specularmap_fragment>
// Foil adds to the strength of the highlight (measured per title: -0.49 to 2.2, median 0), and unlike cloth it
// keeps all of it. The strength without foil is in the specular colour.
specularStrength = max( 0.0, specularStrength + bFoil * uFoilSpecular / max( specular.r, 0.01 ) );
`;

const BUMP = /* glsl */ `
{
	vec2 gUv = vMapUv * uGrainRepeat;
	float g0 = texture2D( tGrain, gUv ).r;
	float gx = texture2D( tGrain, gUv + dFdx( gUv ) ).r;
	float gy = texture2D( tGrain, gUv + dFdy( gUv ) ).r;
	// The grain tile holds heights from 0 to 1. The strength of the material (0.01 to 0.10, SPEC S-BOOK-6) scales
	// them to a depth in world units.
	// Foil is pressed onto the material and keeps a part of its grain.
	float gs = uBumpGrain * uGrainRelief * mix( 1.0, uFoilLook.y, bFoil );
	vec2 dH = vec2( gx - g0, gy - g0 ) * gs;
	// The tooth catches the light as well.
	dH += vec2( dFdx( bMottle ), dFdy( bMottle ) ) * uMottle * bCloth * ${(1.6 * SHELF_PIXEL).toFixed(4)};
	#ifdef CASEBOUND_EMBOSS
		float e0 = texture2D( tEmboss, vMapUv ).r;
		float ex = texture2D( tEmboss, vMapUv + dFdx( vMapUv ) ).r;
		float ey = texture2D( tEmboss, vMapUv + dFdy( vMapUv ) ).r;
		// The relief map holds heights from 0 to 1. The strength of a title (0.05 to 0.25, SPEC S-BOOK-6) scales
		// them to a depth in world units.
		dH += vec2( ex - e0, ey - e0 ) * uBumpEmboss * uStamp;
	#endif
	#ifdef CASEBOUND_JOINT
		// The joint runs along the cover only: the thin faces at head and tail are left alone.
		float jOn = step( 0.004, vMapUv.y ) * step( vMapUv.y, 0.996 );
		dH += vec2( dFdx( vMapUv.x ), dFdy( vMapUv.x ) ) * uJoint.w * bJointSlope( vMapUv.x ) * jOn;
	#endif
	if ( uRadio > 0.001 ) {
		float r0 = bRing( vRingUv );
		dH += vec2( bRing( vRingUv + dFdx( vRingUv ) ) - r0, bRing( vRingUv + dFdy( vRingUv ) ) - r0 ) * ${(0.09 * READER_PIXEL).toFixed(5)} * uRadio;
	}
	normal = bPerturb( - vViewPosition, normal, dH, faceDirection );
	#ifdef CASEBOUND_FINISH
		diffuseColor.rgb = mix( diffuseColor.rgb, bFoilTone( bFoilPhase( normal ) ), bFoil );
	#endif
}
`;

/**
 * Where two pages meet (SPEC S-RD-13): light bounces between them near the gutter, more so where the paper
 * tilts away from the eye, and the fold itself lies in shade, with a narrow dark core down its middle.
 */
const GUTTER = /* glsl */ `
if ( uGutter >= 0.0 ) {
	float fromSpine = mix( vMapUv.x, 1.0 - vMapUv.x, uGutter );
	float tilt = pow( saturate( 1.0 - abs( dot( normalize( vNormal ), normalize( vViewPosition ) ) ) ), 1.5 );
	float near = pow( 1.0 - smoothstep( 0.0, max( 0.05, uBounceReach ), fromSpine ), max( 0.25, uBounceSharp ) );
	outgoingLight += uBounceColor * near * ( 0.8 + 0.6 * tilt ) * uBounce;
	float band = 1.0 - smoothstep( 0.0, 0.14, fromSpine );
	float core = 1.0 - smoothstep( 0.0, 0.045, fromSpine );
	float shade = min( 0.6, 0.18 * band * band * ( 0.6 + 0.4 * tilt ) + 0.34 * core * core * core );
	outgoingLight *= 1.0 - shade * uGutterShade;
}
#include <opaque_fragment>
`;

/** Runs last: scanlines, pulse, grain and tint of the hologram; ring brightness of the radio effect. */
const FINAL = /* glsl */ `
gl_FragColor.rgb *= uExposure;
if ( uCeiling * uShoulder > 0.0 ) {
	// A shoulder, as film has one: values under the knee are left as they are, what is above approaches the ceiling.
	float knee = uCeiling * 0.77;
	vec3 over = max( gl_FragColor.rgb - knee, 0.0 );
	vec3 rolled = min( gl_FragColor.rgb, vec3( knee ) ) + ( uCeiling - knee ) * ( 1.0 - exp( - over / ( uCeiling - knee ) ) );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, rolled, uShoulder );
}
if ( uHolo > 0.001 ) {
	// The hologram (SPEC S-FX-1). The print itself moves: lines shear sideways in two wave trains, and red and blue
	// are read a little to either side, so every edge gets a fringe. Scanlines, coarse grain, a pulse of light and
	// a trace of blue lie on top. The print is read again from the picture, unlit, and mixed in.
	float hI = uHolo;
	float hT = uFxTime;
	float amp = 0.6 + ( 0.5 * ( 0.4 * sin( 0.8 * hT ) + 0.35 * sin( 1.3 * hT + 2.1 ) + 0.25 * sin( 2.7 * hT + 0.5 ) ) + 0.5 ) * 0.8;
	float shear = ( sin( vMapUv.y * 408.5 + hT * 10.0 ) * 0.003 + sin( vMapUv.y * 68.06 + hT * 3.7 ) * 0.006 ) * hI * amp;
	vec2 hUv = vMapUv + vec2( shear, 0.0 );
	vec3 holo = gl_FragColor.rgb;
	// Where cloth is turned in over a board there is no print to read: the effect leaves the picture alone there.
	float printed = 1.0 - bTurnedIn;
	#ifdef USE_MAP
		holo = mix( holo, texture2D( map, hUv ).rgb, 0.5 * hI * printed );
	#endif
	holo += ( sin( vMapUv.y * 817.0 + hT * 10.0 ) + 0.7 * sin( vMapUv.y * 136.17 + hT * 6.1 ) ) * 0.055 * hI;
	#ifdef USE_MAP
		float drift = sin( hT * 1.3 + 2.1 ) * 0.6 + sin( hT * 2.7 ) * 0.4;
		vec2 split = ( uFxPointer + vec2( 0.3, 0.2 ) * drift * ( 0.5 * sin( 1.3 * hT + 2.1 ) + 0.5 ) ) * 0.0147 * hI;
		holo.r = mix( holo.r, texture2D( map, hUv + split ).r, 0.3 * hI * printed );
		holo.b = mix( holo.b, texture2D( map, hUv - split ).b, 0.3 * hI * printed );
	#endif
	holo += ( bHash( floor( gl_FragCoord.xy / 4.0 ) + floor( hT * 12.0 ) * 7.13 ) - 0.5 ) * 0.08 * hI;
	holo *= 1.0 + 0.3 * hI * ( 0.5 * ( 0.5 * sin( 1.7 * hT ) + 0.3 * sin( 2.9 * hT ) + 0.2 * sin( 0.7 * hT ) ) + 0.5 );
	gl_FragColor.rgb = holo + vec3( 0.004, 0.015, 0.087 ) * hI;
}
if ( uRadio > 0.001 ) {
	// The rings (SPEC S-FX-2): a tint and a lift of the light where a ring passes.
	float wave = bRing( vRingUv ) * uRadio;
	gl_FragColor.rgb += vec3( 0.02, 0.06, 0.09 ) * wave * 2.0;
	gl_FragColor.rgb *= 1.0 + wave * 0.35;
}
if ( uFilm * uFilmShare * ( 1.0 - bTurnedIn ) > 0.0 ) {
	// Film grain (SPEC S-RD-13): new on every drawn frame, one value per colour, stronger in the shadows.
	float lum = dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
	float mask = 0.3 + 0.7 * ( 1.0 - smoothstep( 0.3, 1.2, lum ) );
	vec2 at = gl_FragCoord.xy + uFilmSeed;
	vec3 speck = vec3( bHash( at ), bHash( at + 19.19 ), bHash( at + 47.53 ) ) - 0.5;
	gl_FragColor.rgb += speck * uFilm * uFilmShare * ( 1.0 - bTurnedIn ) * mask;
}
#include <dithering_fragment>
`;

const VERTEX_PARS = /* glsl */ `
uniform float uRadio;
uniform float uFxTime;
uniform float uRingSide;
uniform float uGutter;
varying vec2 vRingUv;
#include <uv_pars_vertex>
`;

/** How far a ring lifts the surface at the corner it starts from, world units. Measured: about 0.7 on a page 13 wide. */
export const RING_LIFT = 0.7;

const VERTEX_DISPLACE = /* glsl */ `
#include <begin_vertex>
// Where this point lies for the rings: across the whole spread, 0 at the fore-edge of the left page, 0.5 at the
// spine, 1 at the fore-edge of the right page. The rings start at the upper right corner of the spread and cross
// the fold. A page whose picture is mirrored (uGutter 1) counts from the other edge, and a sheet in the air says
// how far over it is (uRingSide, 1 lying right to -1 lying left), so its two sides ripple as one.
vRingUv = vec2( 0.5 + 0.5 * ( uGutter > 0.5 ? 1.0 - uv.x : uv.x ) * uRingSide, uv.y );
if ( uRadio > 0.001 ) {
	float d = distance( vRingUv, vec2( 1.0, 1.0 ) );
	float ring = sin( d * 69.8 - uFxTime * 1.53 * 6.28318 ) * 0.5 + 0.5;
	transformed += objectNormal * ring * ring * ( 1.0 - smoothstep( 0.0, 1.2, d ) ) * ${RING_LIFT.toFixed(3)} * uRadio;
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
    uMottle: { value: o.cloth.mottle ?? 0 },
    uBumpGrain: { value: o.bumpGrain },
    uBumpEmboss: { value: o.bumpEmboss ?? 0 },
    uGrainRepeat: { value: new Vector2(...o.grainRepeat) },
    uGrainScale: { value: o.grainPerUnit },
    uGrainRelief: { value: o.cloth.relief ?? 1 },
    tGrain: { value: o.grain },
    tEmboss: { value: o.emboss ?? null },
    tFinish: { value: o.finish ?? null },
    // The colour is written out as it is given, like the colour map.
    uFoilColor: { value: new Color(o.foilColor ?? '#d9b25a').convertLinearToSRGB() },
    uFoilRainbow: { value: o.foilRainbow ?? 0 },
    uFoilOpacity: { value: o.foilOpacity ?? 1 },
    uFoilSpecular: { value: o.foilSpecular ?? 0 },
    uFoilDetail: { value: o.foilDetail ?? 2.6 },
    tBack: { value: null },
    uBleed: { value: 0.3 },
    uTurn: { value: 0 },
    uTransmit: { value: o.transmit ?? 0 },
    uAloft: { value: 0 },
    uRingSide: { value: o.gutter === 1 ? -1 : 1 },
    uExposure: { value: o.exposure ?? o.cloth.exposure ?? 0.9 },
    uCeiling: { value: o.cloth.ceiling ?? 0 },
    uFilmShare: { value: o.cloth.film ?? 0 },
    uGutter: { value: o.gutter ?? -1 },
    uTurnIn: { value: o.turnIn ? new Vector4(...o.turnIn.margin, ...o.turnIn.repeat) : new Vector4(0, 0, 1, 1) },
    // Written out as given, and at the brightness the cloth has on the outside of the case.
    uTurnInColor: { value: new Color(o.turnIn?.color ?? '#000000').convertLinearToSRGB().multiplyScalar(0.9 / (o.exposure ?? o.cloth.exposure ?? 0.9)) },
    uJoint: { value: o.joint ? new Vector4(o.joint.back, o.joint.front, o.joint.half, o.joint.length) : new Vector4() },
    uHinge: { value: new Vector2(Math.PI / 2, Math.PI / 2) },
    ...o.fx,
  };
  mat.userData.uniforms = uniforms;
  mat.defines = { ...(mat.defines ?? {}) };
  if (o.joint) mat.defines.CASEBOUND_JOINT = '';
  if (o.emboss) mat.defines.CASEBOUND_EMBOSS = '';
  if (o.finish) mat.defines.CASEBOUND_FINISH = '';
  if (o.bleed) mat.defines.CASEBOUND_BLEED = '';
  if (o.turnIn) mat.defines.CASEBOUND_TURNIN = '';
  liveMaterials.add(mat);
  mat.addEventListener('dispose', () => liveMaterials.delete(mat));
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    for (const e of surfaceEffects) Object.assign(shader.uniforms, e.uniforms);
    const extraPars = surfaceEffects.map((e) => e.pars ?? '').join('\n');
    const extraFinal = surfaceEffects.map((e) => '{\n' + e.fragment + '\n}').join('\n');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <shadowmap_pars_fragment>', SOFT_SHADOWS)
      .replace('#include <lights_phong_pars_fragment>', PARS + extraPars)
      .replace('#include <map_fragment>', ALBEDO)
      .replace('#include <specularmap_fragment>', SPECULAR)
      .replace('#include <normal_fragment_maps>', BUMP)
      .replace('#include <opaque_fragment>', GUTTER)
      .replace('#include <colorspace_fragment>', '')
      .replace('#include <dithering_fragment>', FINAL.replace('#include <dithering_fragment>', extraFinal + '\n#include <dithering_fragment>'));
    if (o.sheet) shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', SHEET_LIGHTS);
    shader.vertexShader = shader.vertexShader.replace('#include <uv_pars_vertex>', VERTEX_PARS).replace('#include <begin_vertex>', VERTEX_DISPLACE);
  };
  mat.customProgramCacheKey = () => `casebound-surface-${o.emboss ? 'e' : ''}${o.finish ? 'f' : ''}${o.bleed ? 'b' : ''}${o.sheet ? 's' : ''}${o.joint ? 'j' : ''}${o.turnIn ? 't' : ''}-${surfaceEffects.map((e) => e.name).join('+')}`;
  return mat;
}

/**
 * Head and tail of a page block against its fore-edge. Measured in two views, the tail of the closed book on
 * the shelf and of the open book in the reader: head and tail are 0.68 as bright on screen as a fore-edge in the
 * same light would be, and warmer. `gain` is that factor before the screen's curve, range 0.1 to 1; `tint` is the
 * colour they are multiplied by.
 */
export const EDGE_ENDS = { gain: 0.43, tint: '#f0e8d8' } as const;

/** The colour that head and tail of a page block are multiplied by. */
export function edgeEndsColor(gain: number = EDGE_ENDS.gain, tint: string = EDGE_ENDS.tint): Color {
  return new Color(tint).multiplyScalar(Math.max(0, gain));
}

/** Page edges: a plain lit material. Written out without tone mapping so the paper keeps its brightness. */
/**
 * Shade where page edges meet what they touch: strength and reach toward a board, toward the spine (head and tail
 * only) and toward the two ends of the fore-edge. Read in the reference: 0.33 over 0.56, 0.21 over 1.0 and 0.12
 * over 0.32 model units, each falling off as a squared smoothstep. The reaches here are in world units.
 */
export const EDGE_CONTACT = { board: 0.33, boardReach: 0.48, spine: 0.21, spineReach: 0.85, ends: 0.12, endsReach: 0.27 };

export function createEdgeMaterial(map: Texture, tint = '#f6f3ec', ends: IUniform<Color> = { value: edgeEndsColor() }, pageWidth = 13): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ map, color: tint, emissive: '#262522', roughness: 0.85, metalness: 0, side: DoubleSide });
  // The stacked edges measured a quarter darker than the reference.
  mat.color.multiplyScalar(1.5);
  mat.toneMapped = false;
  // Head and tail are the faces whose normal runs along the spine. They get a colour of their own.
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uEdgeEnds = ends;
    shader.uniforms.uEdgePage = { value: pageWidth };
    const c = EDGE_CONTACT;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', ['#include <common>', 'attribute vec4 aContact;', 'varying float vEdgeEnd;', 'varying vec4 vContact;'].join('\n'))
      .replace('#include <begin_vertex>', ['#include <begin_vertex>', 'vEdgeEnd = abs( normal.y );', 'vContact = aContact;'].join('\n'));
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', ['#include <common>', 'varying float vEdgeEnd;', 'varying vec4 vContact;', 'uniform vec3 uEdgeEnds;', 'uniform float uEdgePage;'].join('\n'))
      .replace(
        '#include <map_fragment>',
        [
          '#include <map_fragment>',
          'diffuseColor.rgb *= mix( vec3( 1.0 ), uEdgeEnds, vEdgeEnd );',
          '{',
          '\tfloat toBoard = 1.0 - smoothstep( 0.0, ' + c.boardReach.toFixed(3) + ', min( vContact.x, vContact.y ) );',
          '\tfloat toSpine = ( 1.0 - smoothstep( 0.0, ' + c.spineReach.toFixed(3) + ', vMapUv.y * uEdgePage ) ) * vEdgeEnd;',
          '\tfloat toEnds = 1.0 - smoothstep( 0.0, ' + c.endsReach.toFixed(3) + ', min( vContact.z, vContact.w ) );',
          '\tdiffuseColor.rgb *= ( 1.0 - ' + c.board.toFixed(3) + ' * toBoard * toBoard ) * ( 1.0 - ' + c.spine.toFixed(3) + ' * toSpine * toSpine ) * ( 1.0 - ' + c.ends.toFixed(3) + ' * toEnds * toEnds );',
          '}',
        ].join('\n'),
      );
  };
  mat.customProgramCacheKey = () => 'casebound-edge';
  return mat;
}
