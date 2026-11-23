/**
 * Example extension: an "aged" look for every book surface. Paper and cloth yellow, edges darken, and the
 * surface gets a few foxing spots. Shows how to add a surface effect with its own uniform and a key to toggle it.
 *
 * Turn it on with `?ext=aged`, then press `a`.
 */
import { tunable, type Extension } from '../src/engine';
import { approach } from '../src/engine/core/math';

const aged: Extension = (engine) => {
  const { ctx } = engine;
  const amount = { value: 0 };
  let want = false;

  const t = tunable(ctx.registry, {
    id: 'effect.aged',
    label: 'Aged paper',
    kind: 'material-effect',
    tags: ['effect', 'shader', 'paper'],
    describe: 'Yellows and spots every book surface. Press a to toggle.',
    source: 'extensions/aged.ts',
    params: {
      rate: { value: 2.5, min: 0.1, max: 30, unit: '1/s', help: 'How fast the look fades in and out' },
      strength: { value: 1, min: 0, max: 1 },
    },
  });

  const removeEffect = engine.defineSurfaceEffect({
    name: 'aged',
    uniforms: { uAged: amount },
    pars: /* glsl */ `uniform float uAged;`,
    // `bNoise` and `vMapUv` come from the engine's surface shader.
    fragment: /* glsl */ `
      if ( uAged > 0.001 ) {
        vec3 tone = gl_FragColor.rgb * vec3( 1.0, 0.93, 0.76 );
        vec2 edge = min( vMapUv, 1.0 - vMapUv );
        float vignette = smoothstep( 0.0, 0.16, min( edge.x, edge.y ) );
        float spots = smoothstep( 0.78, 0.9, bNoise( vMapUv * 34.0 ) ) * 0.35;
        tone *= mix( 0.74, 1.0, vignette ) * ( 1.0 - spots * vec3( 0.25, 0.4, 0.6 ) );
        gl_FragColor.rgb = mix( gl_FragColor.rgb, tone, uAged );
      }
    `,
  });

  const stop = ctx.onFrame('effects', (f) => {
    const goal = want ? t.strength : 0;
    if (Math.abs(amount.value - goal) < 1e-3) return;
    amount.value = ctx.still ? goal : approach(amount.value, goal, t.rate, f.dt);
    ctx.invalidate();
  });

  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'a' || e.metaKey || e.ctrlKey) return;
    want = !want;
    ctx.invalidate();
  };
  addEventListener('keydown', onKey);

  return () => {
    removeEventListener('keydown', onKey);
    stop();
    removeEffect();
    ctx.registry.remove('effect.aged');
  };
};

export default aged;
