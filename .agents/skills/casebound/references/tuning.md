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
r.set('stage.wall', 'softness', 2);
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
| `stage.wall` | Shadow wall: depth, colour, opacity, fade with distance, extra softness | `src/engine/stage/wall.ts` |
| `shelf.featured` | Slot pitch, shelf depth, rest pose, leave and arrive poses, pointer tilt, intro time | `src/engine/shelf/shelf.ts` |
| `shelf.spin` | Turning the centred book by hand: turn per pixel, spring, coasting, cover lift, levelling | `src/engine/shelf/spin.ts` |
| `shelf.row` | The row of spines: gap, width of an open cover, depth, how far the chosen book steps out, turn and slide times, the glide to a far choice (`glideBase`, `glidePerPlace`, `glideMax`), how fast covers follow a pull (`followYawTime`), the room each end keeps inside the window (`endRoom`), when the row assembles, hover pop | `src/engine/shelf/row.ts` |
| `effect.film`, `book.gutter` | Film grain on pages; the light and shade where two pages meet | `src/engine/book/surface.ts` |
| `book.relief` | Stamped type and ornament: depth (live), and how far and with how wide a wall they are pressed into the relief map (these two paint the covers again) | `src/engine/book/painter.ts` |
| `book.joint` | Where a board meets the spine: how square the back reads, and depth, start and width of the groove beside it | `src/engine/book/surface.ts` |
| `book.foil` | How much colour an iridescent foil takes, and how much of the grain shows through foil | `src/engine/book/surface.ts` |
| `book.edges` | Brightness and tint of head and tail of a page block against its fore-edge | `src/engine/book/surface.ts` |
| `book.arch` | The belly of the pages: `height` of the top page of a thick stack and the stack height `fall` at which a page has two thirds of it, both as shares of the page width. `height` 0 lays every page flat | `src/engine/book/volume.ts` |
| `reader` | Pause before opening, cover and page times, height of the open book, scale, pitch, how the weight of the book follows the pointer (`push`, `pushEdge`, `pushRate`, `pushSwap`; `push` 0 keeps the book still), how fast the case follows a turning leaf (`readingFollow`), and the page drag (`dragWidth`, `dragFollow`, `tapPx`) | `src/engine/reader/reader.ts` |
| `reader.leaf` | Page turn physics: push, damping, landing brake, launch speed | `src/engine/reader/leaf-physics.ts` |
| `reader.curl` | Corner curl: strength under the pointer, in the hand and in the air, the fold line, the rates, and the flop of a held leaf. `amount` 0 turns the curl off, `hover` 0 mounts no sheet under the pointer, `flop` 0 turns the flop off | `src/engine/reader/curl.ts` |
| `reader.bundle` | A bundle of leaves turned as one block: the fewest leaves that count as one (`min`), the wait after letting go, the length of the turn and what every doubling of the leaves adds, the lift off the stack and its twist, the bow in the air | `src/engine/reader/bundle.ts` |
| `reader.riffle` | Opening riffle: live leaves per side, when and how fast they settle and go limp, how far they fan out. `leaves` 0 turns it off | `src/engine/reader/riffle.ts` |
| `effect.magnifier` | Magnification, radius, edge, barrel bend, rim, follow speed | `src/engine/effects/magnifier.ts` |
| `effect.surface` | Waits and fade rates of hologram and radio | `src/engine/effects/surface-effects.ts` |
| `book.<slug>` | Open amount and reading progress of one book, and its cover material: highlight, depth of grain and stamp, foil, and the cloth values. Try a value here, then keep it in the book's `book.json` under the field its help text names | `src/engine/book/book.ts` |

Extensions add their own ids; `describe()` lists them too.

## What a cover is made of

Relief is measured in world units: `bumpGrain` times `cloth.relief` is the depth of the grain, `bumpEmboss` the depth of a stamp that uses the whole relief map. It looks the same at any distance and pixel ratio. The size of the weave is `GRAIN_PER_UNIT` in `src/engine/book/painter.ts` (a buckram tile holds 64 threads); `WEAVE_CRIMP` is what keeps a weave visible from across the room.

Most of the speckle on a cover seen from across the room is not the cover: it is the grain layer over the whole page, `.grain` in `src/site/site.css`, with its strength in `--grain`. A page that uses the engine without that layer shows smoother covers.

## Light presets

`src/engine/stage/presets.ts` holds four complete rigs: `browse`, `dark`, `look-inside`, `dark-look-inside`. Each lists colour, intensity and position of ambient, key, sun and spot, and the key light's shadow settings. The rig blends between them by theme and by whether a book is open. Change a preset to change a mood; add one with `engine.rig.definePreset`.

Themes: Morning uses `browse` with key and sun 10 % brighter. Noon uses `browse` tinted toward the current book's `background`. Night uses `dark`. Without a fixed theme the hour of the day decides. `?theme=light|colour|dark` or `?midday` in the address fixes it.

## Scroll feel

`src/engine/shelf/scroll.ts`: `lockPx` is how many pixels of scrolling a centred book holds still, `smoothTime` is the damping time in seconds (0.0945, on desktop times 0.7), `hysteresis` is how far the scroll must go before the next book counts as current. The functions are pure and tested in `scroll.test.ts`; change the test with the value.

## Hands on the books

Three things follow the pointer directly, and all are plain numbers you can test without a browser.

- `src/engine/shelf/row.ts` lays out the row of spines: `stepRow` advances it, `placeAt` says where a book stands, `choose` and `stepChoice` move the choice. Its tests pin the order, the spacing and the thresholds.
- `src/engine/shelf/spin.ts` turns a closed book: `grabSpin`, `dragSpin`, `releaseSpin`, `stepSpin`. Its tests in `spin.test.ts` pin the gain, the coasting distance at 30, 60 and 120 frames per second, the levelling and the cover lift.
- `src/engine/reader/reader.ts` turns a page by hand. `take` lifts the top leaf of a stack, `aim` sends a leaf to a side and moves the page count, `outer` finds the leaf in the air that a hand or a key reaches first. The page count only changes in `aim`. Keep it that way, or two leaves end up with the same pages.

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
