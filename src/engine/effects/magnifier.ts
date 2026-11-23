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
	// The dark ring fades outward on both sides; the bright band fades inside it.
	float soft = uRadius * 0.02;
	float ring = smoothstep( lo - soft, lo, dist ) * ( 1.0 - smoothstep( hi, hi + soft, dist ) );
	float from = lo + uRingThickness * 0.7;
	float band = smoothstep( from - soft * 0.5, from, dist ) * ( 1.0 - smoothstep( hi - soft * 0.5, hi, dist ) );
	vec3 rim = vec3( band * 0.8 );
	gl_FragColor = vec4( mix( colour.rgb, rim, ring * uRingOpacity * uAmount ), colour.a );
}
`;

export interface MagnifierOptions {
  /** Where the lens opens, as an offset from the canvas centre in CSS pixels. Default: the centre. */
  centreOffsetPx?: () => { x: number; y: number };
  /** Called when the lens switches itself off: on a touch screen, two quick taps on the glass put it away. */
  onToggle?: (on: boolean) => void;
  /** A press on an element matching this selector opens the lens in the middle instead of under the pointer. */
  controls?: string;
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
      pinnedMagnification: { value: 1.3, min: 0.5, max: 3, help: 'On a touch screen the lens rests in the middle: its magnification is multiplied by this' },
      pinnedSize: { value: 0.858, min: 0.2, max: 2, help: 'On a touch screen: radius, edge and rim are multiplied by this (0.65 x 1.32)' },
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
  /** On a touch screen the lens rests in the middle of the picture and the page moves under it. */
  let pinned = false;
  let release: (() => void) | null = null;
  const controls = opts.controls ?? 'button, a, input, [role="toolbar"], header, footer, nav';

  // Two quick taps on the pinned glass put it away. Measured: 320 ms and 44 px apart at most, a tap being under 260 ms and 12 px.
  const tap = { downAt: 0, x: 0, y: 0, moved: false, lastAt: 0, lastX: 0, lastY: 0 };
  const onGlass = (x: number, y: number): boolean => {
    const u = uniforms.uCentre.value;
    const dx = (x / Math.max(1, ctx.size.x) - u.x) * (ctx.size.x / Math.max(1, ctx.size.y));
    const dy = 1 - y / Math.max(1, ctx.size.y) - u.y;
    return Math.hypot(dx, dy) <= uniforms.uRadius.value + 0.02;
  };
  const onTouchStart = (ev: TouchEvent): void => {
    tap.downAt = 0;
    const touch = ev.touches[0];
    if (!on || !pinned || ev.touches.length !== 1 || !touch) return;
    const rect = ctx.canvas.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    if (!onGlass(x, y)) return;
    const now = performance.now();
    if (tap.lastAt && now - tap.lastAt <= 320 && Math.hypot(x - tap.lastX, y - tap.lastY) <= 44) {
      tap.lastAt = 0;
      magnifier.set(false);
      opts.onToggle?.(false);
      return;
    }
    tap.downAt = now;
    tap.x = x;
    tap.y = y;
    tap.moved = false;
  };
  const onTouchMove = (ev: TouchEvent): void => {
    const touch = ev.touches[0];
    if (!tap.downAt || !touch) return;
    const rect = ctx.canvas.getBoundingClientRect();
    if (Math.hypot(touch.clientX - rect.left - tap.x, touch.clientY - rect.top - tap.y) > 12) tap.moved = true;
  };
  const onTouchEnd = (): void => {
    if (tap.downAt && !tap.moved && performance.now() - tap.downAt <= 260) {
      tap.lastAt = performance.now();
      tap.lastX = tap.x;
      tap.lastY = tap.y;
    } else tap.lastAt = 0;
    tap.downAt = 0;
  };
  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: true });
  window.addEventListener('touchend', onTouchEnd, { passive: true });
  window.addEventListener('touchcancel', onTouchEnd, { passive: true });

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
    const size = pinned ? t.pinnedSize : 1;
    u.uMagnification.value = Math.min(0.9, t.magnification * (pinned ? t.pinnedMagnification : 1));
    u.uRadius.value = t.radius * size;
    u.uEdge.value = t.edge * size;
    u.uBarrel.value = t.barrel;
    u.uRingThickness.value = t.ringThickness * size;
    u.uRingOpacity.value = t.ringOpacity;
    u.uAspect.value = ctx.size.x / Math.max(1, ctx.size.y);
    if (!following && !pinned && ctx.pointerPx.distanceTo(anchor) > 2) following = true;
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
        findHome();
        pinned = typeof matchMedia === 'function' && matchMedia('(hover: none), (pointer: coarse)').matches && ctx.pointer === null;
        const under = ctx.pointer ? document.elementFromPoint(ctx.pointerPx.x, ctx.pointerPx.y) : null;
        if (ctx.pointer && !pinned && !under?.closest(controls)) {
          // Switched on by a key: the lens is under the pointer at once.
          uniforms.uCentre.value.set((ctx.pointer.x + 1) / 2, (ctx.pointer.y + 1) / 2);
          following = true;
        } else {
          // Switched on by its button, or on a touch screen: it opens in the middle of the picture, not on the button.
          uniforms.uCentre.value.set(home.x, home.y);
          anchor.copy(ctx.pointerPx);
          following = false;
        }
      }
      ctx.invalidate();
    },
    toggle: () => {
      magnifier.set(!on);
      return on;
    },
    dispose: () => {
      unsub();
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
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
