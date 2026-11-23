# Tuning: every number has a name

Nothing that shapes light or motion is a bare constant in the middle of a function. Each value is registered with an id, a label, a range and a sentence of help, so it can be found and changed while the page runs.

## Find, try, keep

In the browser console of the running site or stage:

```js
const r = casebound.engine.ctx.registry;
r.describe();                      // everything
r.describe('tag:light');           // by tag
r.describe('reader');              // by id prefix
r.query('kind:animation paper');   // words are ANDed: tag:, kind:, id:, or free text
r.set('stage.wall', 'softness', 10);
r.getParam('reader.leaf', 'kick');
JSON.stringify(r.snapshot('light'), null, 1);   // current values, ready to copy
```

A value set this way lasts until reload. To keep it, change the default in the file named on the `source` line of `describe()`.

## What is registered

| Id | What it controls | Declared in |
| --- | --- | --- |
| `camera.main` | Field of view, position, pixel ratio cap | `src/engine/core/app.ts` |
| `light.rig` | Blend rates between presets, pointer parallax, how the spot follows the pointer, tint in the Noon theme | `src/engine/stage/rig.ts` |
| `light.ambient`, `light.key`, `light.sun`, `light.spot` | The four lights. Written by the rig every frame, so change presets, not these | `src/engine/stage/presets.ts` |
| `stage.wall` | Shadow wall: depth, colour, opacity, fade with distance, softness | `src/engine/stage/wall.ts` |
| `shelf.featured` | Slot pitch, shelf depth, rest pose, leave and arrive poses, pointer tilt, intro time | `src/engine/shelf/shelf.ts` |
| `reader` | Cover opening time, how far the book comes forward, scale, pitch, lean toward the pointer | `src/engine/reader/reader.ts` |
| `reader.leaf` | Page turn physics: push, damping, landing brake, launch speed | `src/engine/reader/leaf-physics.ts` |
| `effect.magnifier` | Magnification, radius, edge, barrel bend, rim, follow speed | `src/engine/effects/magnifier.ts` |
| `effect.surface` | Fade rates of hologram and radio | `src/engine/effects/surface-effects.ts` |
| `book.<slug>` | Open amount and reading progress of one book | `src/engine/book/book.ts` |

Extensions add their own ids; `describe()` lists them too.

## Light presets

`src/engine/stage/presets.ts` holds four complete rigs: `browse`, `dark`, `look-inside`, `dark-look-inside`. Each lists colour, intensity and position of ambient, key, sun and spot, and the key light's shadow settings. The rig blends between them by theme and by whether a book is open. Change a preset to change a mood; add one with `engine.rig.definePreset`.

Themes: Morning uses `browse` with key and sun 10 % brighter. Noon uses `browse` tinted toward the current book's `background`. Night uses `dark`. Without a fixed theme the hour of the day decides. `?theme=light|colour|dark` or `?midday` in the address fixes it.

## Scroll feel

`src/engine/shelf/scroll.ts`: `lockPx` is how many pixels of scrolling a centred book holds still, `smoothTime` is the damping time in seconds (0.066 desktop, 0.0945 under 900 px), `hysteresis` is how far the scroll must go before the next book counts as current. The functions are pure and tested in `scroll.test.ts`; change the test with the value.

## Motion primitives

`src/engine/core/math.ts`. Use these instead of writing a new easing inline:

- `smoothDamp(current, target, velocity, smoothTime, dt)`: critically damped, never overshoots.
- `approach(current, target, ratePerSecond, dt)`: exponential approach.
- `frameFactor(k, dt)`: a "k per frame at 60 Hz" value made frame-rate independent.
- `springStep(state, target, stiffness, damping, dt)`: sub-stepped spring.
- `easeInOutQuad`, `easeOutCubic`, `cosineInOut`, `powerSigmoid`.

All take delta time, so the feel is the same at 30, 60 and 120 Hz. The tests check that.

## Where the values come from

`research/SPEC.md` lists every measured value with an id such as `S-LIGHT-2` and says how it was verified: read in code, read from the running scene, or measured frame by frame. If you change a default away from its measured value, say so in the commit message.
