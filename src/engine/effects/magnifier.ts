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

	// Rim: a dark ring with a bright band just inside it.
	float soft = uRadius * 0.006;
	float halfW = uRingThickness * 0.5;
	float outer = 1.0 - smoothstep( halfW, halfW + soft, abs( dist - uRadius ) );
	float inner = 1.0 - smoothstep( halfW * 0.6, halfW * 0.6 + soft, abs( dist - ( uRadius - uRingThickness * 1.1 ) ) );
	float ring = outer * uRingOpacity * uAmount;
	float band = inner * 0.8 * uRingOpacity * uAmount;
	vec4 result = mix( colour, vec4( 0.0, 0.0, 0.0, 1.0 ), ring );
	result = mix( result, vec4( 1.0 ), band * ( 1.0 - ring ) );
	gl_FragColor = result;
}
`;

export function createMagnifier(engine: Engine): Magnifier {
  const { ctx } = engine;
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
      fade: { value: 14, min: 1, max: 60, unit: '1/s', help: 'How fast the lens appears and disappears' },
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
    const gx = ctx.pointer ? (ctx.pointer.x + 1) / 2 : 0.5;
    const gy = ctx.pointer ? (ctx.pointer.y + 1) / 2 : 0.5;
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
        if (ctx.pointer) uniforms.uCentre.value.set((ctx.pointer.x + 1) / 2, (ctx.pointer.y + 1) / 2);
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
