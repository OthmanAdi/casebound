/**
 * The engine context: renderer, scene, camera, loop, registry and pointer. Everything else plugs into this.
 * Values: research/SPEC.md section 2.
 */
import { PCFShadowMap, PerspectiveCamera, Scene, Vector2, WebGLRenderer } from 'three';
import { FrameLoop, type FrameInfo, type FramePhase, type Unsubscribe } from './loop';
import { clamp } from './math';
import { Registry } from './registry';
import { tunable } from './tune';

export interface EngineEvents {
  resize: { width: number; height: number; pixelRatio: number };
  theme: { theme: string };
  view: { view: string; slug: string | null; page: number | null };
  'book-focus': { slug: string; index: number };
  'page-turn': { slug: string; leaf: number; direction: 1 | -1 };
}

type Handler<T> = (payload: T) => void;

export class Emitter<E> {
  private readonly map = new Map<keyof E, Set<Handler<never>>>();
  on<K extends keyof E>(type: K, fn: Handler<E[K]>): Unsubscribe {
    let set = this.map.get(type);
    if (!set) this.map.set(type, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => set.delete(fn as Handler<never>);
  }
  emit<K extends keyof E>(type: K, payload: E[K]): void {
    for (const fn of this.map.get(type) ?? []) (fn as Handler<E[K]>)(payload);
  }
}

export interface ContextOptions {
  canvas: HTMLCanvasElement;
  /** Low-power tier: no shadows, lower pixel ratio. Defaults to a user-agent and URL check. */
  lowPower?: boolean;
}

export interface EngineContext {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly registry: Registry;
  readonly loop: FrameLoop;
  readonly events: Emitter<EngineEvents>;
  /** Canvas size in CSS pixels. */
  readonly size: Vector2;
  /** Pointer in normalised device coordinates (-1..1, y up), or null when the last input was touch. */
  pointer: { x: number; y: number } | null;
  /** Pointer in CSS pixels relative to the viewport. */
  readonly pointerPx: Vector2;
  /** True under 900 CSS px wide: the compact layout tier. */
  compact: boolean;
  readonly lowPower: boolean;
  /** Reduced motion: animations jump to their end. */
  still: boolean;
  onFrame(phase: FramePhase, fn: (f: FrameInfo) => void): Unsubscribe;
  invalidate(): void;
  lease(name: string): Unsubscribe;
  /** World units visible vertically at the given depth. */
  visibleHeightAt(z: number): number;
  /** Replaces the function that draws the frame (the magnifier wraps it). Returns the previous one. */
  setRenderer(fn: (f: FrameInfo) => void): (f: FrameInfo) => void;
  dispose(): void;
}

export function createContext(opts: ContextOptions): EngineContext {
  const { canvas } = opts;
  const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
  const lowPower = opts.lowPower ?? (params.has('lowpower') || /Android/i.test(typeof navigator === 'undefined' ? '' : navigator.userAgent));
  const registry = new Registry();
  const events = new Emitter<EngineEvents>();

  const renderer = new WebGLRenderer({
    canvas,
    antialias: params.get('aa') !== '0',
    alpha: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: !lowPower,
  });
  renderer.shadowMap.enabled = !lowPower;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  const camera = new PerspectiveCamera(18, 1, 1, 1000);

  const cam = tunable(registry, {
    id: 'camera.main',
    label: 'Camera',
    kind: 'perspective-camera',
    tags: ['camera'],
    describe: 'A narrow lens far from the books, so they read almost flat but keep a little depth.',
    source: 'src/engine/core/app.ts',
    params: {
      fov: { value: 18, min: 5, max: 90, unit: 'deg' },
      x: { value: 0.11, min: -50, max: 50 },
      y: { value: -1.32, min: -50, max: 50 },
      z: { value: 54, min: -100, max: 300 },
      pixelRatioMax: { value: lowPower ? 1.5 : 2, min: 0.5, max: 3, help: 'Upper clamp for the device pixel ratio' },
      introDrop: { value: 0, min: 0, max: 400, help: 'How far below its rest depth the camera starts. The intro animation writes this.' },
    },
    onChange: () => applyCamera(),
  });

  const size = new Vector2(1, 1);
  const pointerPx = new Vector2();
  let draw: (f: FrameInfo) => void = () => renderer.render(scene, camera);
  const loop = new FrameLoop({ render: (f) => draw(f) });

  function applyCamera(): void {
    camera.fov = cam.fov;
    camera.position.set(cam.x, cam.y, cam.z - cam.introDrop);
    camera.rotation.set(0, 0, 0);
    camera.updateProjectionMatrix();
    loop.invalidate();
  }

  const ctx: EngineContext = {
    canvas,
    renderer,
    scene,
    camera,
    registry,
    loop,
    events,
    size,
    pointer: null,
    pointerPx,
    compact: false,
    lowPower,
    still: typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    onFrame: (phase, fn) => loop.onFrame(phase, fn),
    invalidate: () => loop.invalidate(),
    lease: (name) => loop.lease(name),
    visibleHeightAt: (z) => 2 * Math.abs(camera.position.z - z) * Math.tan((camera.fov * Math.PI) / 360),
    setRenderer: (fn) => {
      const prev = draw;
      draw = fn;
      return prev;
    },
    dispose: () => {
      loop.stop();
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerdown', onPointer);
      motion?.removeEventListener('change', onMotion);
      renderer.dispose();
    },
  };

  function resize(): void {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const pr = clamp(window.devicePixelRatio || 1, 1, cam.pixelRatioMax);
    size.set(w, h);
    ctx.compact = w < 900;
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    events.emit('resize', { width: w, height: h, pixelRatio: pr });
    loop.invalidate();
  }

  function onPointer(e: PointerEvent): void {
    pointerPx.set(e.clientX, e.clientY);
    if (e.pointerType === 'touch') {
      ctx.pointer = null;
    } else {
      const r = canvas.getBoundingClientRect();
      ctx.pointer = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: 1 - ((e.clientY - r.top) / r.height) * 2 };
    }
    loop.invalidate();
  }

  const motion = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const onMotion = (): void => {
    ctx.still = !!motion?.matches;
    loop.invalidate();
  };

  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('pointerdown', onPointer, { passive: true });
  motion?.addEventListener('change', onMotion);
  applyCamera();
  resize();
  return ctx;
}
