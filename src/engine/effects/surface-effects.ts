/**
 * The two effects every book surface can show (SPEC section 11):
 *
 *  - "hologram": scanlines run down covers and pages, lines shear sideways, colours split, the light pulses.
 *  - "radio": rings travel across the surface and ripple it.
 *
 * The shading lives in the surface material. This module only fades the two amounts in and out.
 * Extensions can add their own surface effect the same way: a uniform on `engine.fx`, a fade here.
 */
import type { Engine } from '../index';
import { approach } from '../core/math';
import { tunable } from '../core/tune';

export interface SurfaceEffects {
  hologram(on: boolean): void;
  radio(on: boolean): void;
  dispose(): void;
}

export function createSurfaceEffects(engine: Engine): SurfaceEffects {
  const { ctx, fx } = engine;
  const t = tunable(ctx.registry, {
    id: 'effect.surface',
    label: 'Hologram and radio',
    kind: 'material-effect',
    tags: ['effect', 'shader', 'material'],
    describe: 'Fades the hologram and radio looks of all book surfaces in and out.',
    source: 'src/engine/book/surface.ts',
    params: {
      hologramDelay: { value: 0.1, min: 0, max: 2, unit: 's', help: 'Wait before the hologram starts to appear' },
      hologramRate: { value: 6, min: 0.2, max: 60, unit: '1/s' },
      radioIn: { value: 20, min: 0.2, max: 60, unit: '1/s' },
      radioOut: { value: 10, min: 0.2, max: 60, unit: '1/s' },
      canvasOpacity: { value: 0.9, min: 0.2, max: 1, help: 'Canvas opacity while an effect runs' },
    },
  });
  const want = { holo: false, radio: false };
  let holoWait = 0;
  let release: (() => void) | null = null;

  const unsub = ctx.onFrame('effects', (f) => {
    const busy = want.holo || want.radio || fx.uHolo.value > 0.002 || fx.uRadio.value > 0.002;
    if (!busy) {
      if (release) {
        release();
        release = null;
        fx.uHolo.value = fx.uRadio.value = 0;
        ctx.canvas.style.opacity = '';
      }
      return;
    }
    release ??= ctx.lease('surface-effect');
    holoWait = want.holo ? holoWait + f.dt : 0;
    const holoGoal = want.holo && holoWait >= t.hologramDelay ? 1 : 0;
    fx.uHolo.value = ctx.still ? holoGoal : approach(fx.uHolo.value, holoGoal, t.hologramRate, f.dt);
    fx.uRadio.value = ctx.still ? (want.radio ? 1 : 0) : approach(fx.uRadio.value, want.radio ? 1 : 0, want.radio ? t.radioIn : t.radioOut, f.dt);
    ctx.canvas.style.opacity = String(1 - (1 - t.canvasOpacity) * Math.max(fx.uHolo.value, fx.uRadio.value));
  });

  return {
    hologram: (on) => {
      want.holo = on;
      ctx.invalidate();
    },
    radio: (on) => {
      want.radio = on;
      ctx.invalidate();
    },
    dispose: () => {
      unsub();
      release?.();
      ctx.registry.remove('effect.surface');
    },
  };
}
