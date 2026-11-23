/**
 * The magnifier: a round glass that follows the pointer and enlarges whatever the scene shows under it.
 * It is a second pass on the same canvas: the finished frame is copied to a texture and drawn back through
 * a lens (SPEC section 10). Only the scene is magnified; page content in the DOM is untouched.
 */
import { FramebufferTexture, LinearFilter, Mesh, NoBlending, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, Vector2 } from 'three';
import type { Engine } from '../index';
import { approach, expFactor } from '../core/math';
import { tunable } from '../core/tune';

export interface Magnifier {
  readonly on: boolean;
  set(on: boolean): void;
  toggle(): boolean;
  dispose(): void;
}

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform vec2 uCentre;
uniform float uAmount;
uniform float uMagnification;
uniform float uRadius;
uniform float uEdge;
uniform float uAspect;
uniform float uBarrel;
uniform float uRingThickness;
uniform float uRingOpacity;
varying vec2 vUv;

void main() {
	vec2 delta = vUv - uCentre;
	vec2 round = vec2( delta.x * uAspect, delta.y );
	float dist = length( round );
	// 1 inside the glass, falling to 0 across the edge band.
	float glass = ( 1.0 - smoothstep( uRadius - uEdge, uRadius, dist ) ) * uAmount;
	// Pull the sample toward the centre (enlarges), more so toward the rim (the barrel term bends the image).
	float scale = ( 1.0 - uMagnification * glass ) * ( 1.0 + uBarrel * glass * dist * dist );
	vec4 colour = texture2D( tScene, uCentre + delta * scale );

	// Rim, as measured: a dark ring across the edge of the glass with a bright band in its outer part.
	float lo = uRadius - uRingThickness * 0.5;
	float hi = uRadius + uRingThickness * 0.5;
	float softDark = uRadius * 0.01;
	float softBright = uRadius * 0.005;
	float ring = smoothstep( lo - softDark, lo + softDark, dist ) * ( 1.0 - smoothstep( hi - softDark, hi + softDark, dist ) );
	float from = lo + uRingThickness * 0.7;
	float band = smoothstep( from - softBright, from + softBright, dist ) * ( 1.0 - smoothstep( hi - softBright, hi + softBright, dist ) );
	vec4 result = mix( colour, vec4( 0.0, 0.0, 0.0, 1.0 ), ring * uRingOpacity * uAmount );
	result = mix( result, vec4( 1.0 ), band * 0.8 * uRingOpacity * uAmount );
	gl_FragColor = result;
}
`;

export interface MagnifierOptions {
  /** Where the lens opens, as an offset from the canvas centre in CSS pixels. Default: the centre. */
  centreOffsetPx?: () => { x: number; y: number };
}

export function createMagnifier(engine: Engine, opts: MagnifierOptions = {}): Magnifier {
  const { ctx } = engine;
  const home = { x: 0.5, y: 0.5 };
  const findHome = (): void => {
    const o = opts.centreOffsetPx?.() ?? { x: 0, y: 0 };
    home.x = 0.5 + o.x / Math.max(1, ctx.size.x);
    home.y = 0.5 - o.y / Math.max(1, ctx.size.y);
  };
  const t = tunable(ctx.registry, {
    id: 'effect.magnifier',
    label: 'Magnifier',
    kind: 'post-effect',
    tags: ['effect', 'lens', 'post'],
    describe: 'A round lens that follows the pointer and enlarges the scene under it.',
    source: 'src/engine/effects/magnifier.ts',
    params: {
      magnification: { value: 0.308, min: 0, max: 0.9, help: 'How far samples are pulled to the centre. 0.308 is about 1.45x' },
      radius: { value: 0.31, min: 0.03, max: 0.8, help: 'Lens radius as a share of the canvas height' },
      edge: { value: 0.022, min: 0, max: 0.3, help: 'Width of the soft edge' },
      barrel: { value: -0.57, min: -3, max: 3, help: 'Bend toward the rim. Negative enlarges more at the rim' },
      ringThickness: { value: 0.006, min: 0, max: 0.05 },
      ringOpacity: { value: 1, min: 0, max: 1 },
      follow: { value: 22, min: 1, max: 120, unit: '1/s', help: 'How fast the lens follows the pointer' },
      fade: { value: 120, min: 1, max: 240, unit: '1/s', help: 'How fast the lens appears and disappears. Measured on the reference: fully on within three frames' },
    },
    onChange: () => ctx.invalidate(),
  });

  const uniforms = {
    tScene: { value: null as FramebufferTexture | null },
    uCentre: { value: new Vector2(0.5, 0.5) },
    uAmount: { value: 0 },
    uMagnification: { value: t.magnification },
    uRadius: { value: t.radius },
    uEdge: { value: t.edge },
    uAspect: { value: 1.6 },
    uBarrel: { value: t.barrel },
    uRingThickness: { value: t.ringThickness },
    uRingOpacity: { value: t.ringOpacity },
  };
  const material = new ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, blending: NoBlending, depthTest: false, depthWrite: false, toneMapped: false });
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new Scene();
  scene.add(quad);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const buffer = new Vector2();
  let target: FramebufferTexture | null = null;
  let on = false;
  let amount = 0;
  /** Where the pointer was when the lens was switched on. The lens stays in the middle until it moves from there. */
  const anchor = new Vector2();
  let following = false;
  let release: (() => void) | null = null;

  const ensureTarget = (): void => {
    ctx.renderer.getDrawingBufferSize(buffer);
    if (target && target.image.width === buffer.x && target.image.height === buffer.y) return;
    target?.dispose();
    target = new FramebufferTexture(buffer.x, buffer.y);
    target.minFilter = target.magFilter = LinearFilter;
    uniforms.tScene.value = target;
  };

  const previous = ctx.setRenderer((f) => {
    previous(f);
    if (amount <= 0.002) return;
    ensureTarget();
    const r = ctx.renderer;
    r.copyFramebufferToTexture(target!);
    const auto = r.autoClear;
    r.autoClear = false;
    r.render(scene, camera);
    r.autoClear = auto;
  });

  const unsub = ctx.onFrame('effects', (f) => {
    if (!on && amount <= 0.002) return;
    amount = ctx.still ? (on ? 1 : 0) : approach(amount, on ? 1 : 0, t.fade, f.dt);
    if (!on && amount <= 0.002) {
      amount = 0;
      release?.();
      release = null;
    }
    const u = uniforms;
    u.uAmount.value = amount;
    u.uMagnification.value = t.magnification;
    u.uRadius.value = t.radius;
    u.uEdge.value = t.edge;
    u.uBarrel.value = t.barrel;
    u.uRingThickness.value = t.ringThickness;
    u.uRingOpacity.value = t.ringOpacity;
    u.uAspect.value = ctx.size.x / Math.max(1, ctx.size.y);
    if (!following && ctx.pointerPx.distanceTo(anchor) > 2) following = true;
    if (!following) findHome();
    const gx = ctx.pointer && following ? (ctx.pointer.x + 1) / 2 : home.x;
    const gy = ctx.pointer && following ? (ctx.pointer.y + 1) / 2 : home.y;
    const k = ctx.still ? 1 : expFactor(t.follow, Math.min(f.dt, 0.05));
    u.uCentre.value.set(u.uCentre.value.x + (gx - u.uCentre.value.x) * k, u.uCentre.value.y + (gy - u.uCentre.value.y) * k);
  });

  const magnifier: Magnifier = {
    get on() {
      return on;
    },
    set: (next) => {
      if (next === on) return;
      on = next;
      if (on) {
        release ??= ctx.lease('magnifier');
        // Measured: the lens opens in the middle of the picture, not on the button that switched it on.
        findHome();
        uniforms.uCentre.value.set(home.x, home.y);
        anchor.copy(ctx.pointerPx);
        following = false;
      }
      ctx.invalidate();
    },
    toggle: () => {
      magnifier.set(!on);
      return on;
    },
    dispose: () => {
      unsub();
      ctx.setRenderer(previous);
      release?.();
      target?.dispose();
      material.dispose();
      quad.geometry.dispose();
      ctx.registry.remove('effect.magnifier');
    },
  };
  return magnifier;
}
