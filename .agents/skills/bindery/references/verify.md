# Verify: checks, pictures, frame-by-frame comparison

## The quick checks

```sh
npm run check        # typecheck, unit tests, production build
npm run test         # unit tests only
```

Unit tests cover the parts that can be wrong without anyone noticing by eye: motion primitives at different frame rates, the frame loop, the leaf cross-section, the page turn curve, the scroll pipeline, the registry.

## Look at it

A change to anything visible is not verified until you have looked at it in a browser.

```sh
npm run dev
node tools/capture/shot.mjs "http://127.0.0.1:5183/?midday" out/home.png --wait 2600
node tools/capture/shot.mjs "http://127.0.0.1:5183/?midday#/book/opticks/page/40" out/reader.png --wait 3200
```

`shot.mjs` opens the page in Microsoft Edge (set `RE_CHANNEL=chrome` or `RE_CHANNEL=` for another browser), waits for `data-bindery-ready` on `<html>`, and reports console errors. Options:

| Option | Meaning |
| --- | --- |
| `--w`, `--h` | Viewport, default 1440 by 900 |
| `--wait <ms>` | Time to wait before the picture |
| `--move x,y` | Move the pointer there first |
| `--eval "<js>"` | Run code in the page and print its result. `bindery` is the engine handle |

Useful one-liners for `--eval`:

```js
bindery.reader.open('opticks')                          // open a book
setTimeout(() => bindery.reader.next(), 1500), 1        // turn a page shortly before the picture
bindery.magnifier.set(true), 1                          // lens on
bindery.effects.hologram(true), 1                       // hologram on
bindery.engine.ctx.registry.describe('reader')          // print values
```

Check at least: the closed book on the shelf, a scroll half way between two books, the open spread, a leaf in mid-turn, the lens, the two surface effects, the Night theme, a 390 by 844 viewport, and reduced motion.

The page announces its state for tools: `data-bindery-ready="true"` when it has settled, `data-bindery-view` with the current address (`/`, `/book/<slug>`, `/book/<slug>/page/<n>`).

## Frame-by-frame capture and comparison

For motion, single pictures are not enough. `tools/reanimate/capture-series.mjs` runs a fixed list of interactions (hover, open, page turn, lens, effects) under a virtual clock, 60 frames per second, and records every frame together with every shader uniform and every scene value. Two captures of the same build are identical, so two builds can be compared number by number.

It uses reanimate, an open-source capture tool (MIT, https://github.com/NiazMorshed2007/reanimate). Clone it somewhere outside the project, install its script dependencies as its README says, then:

```sh
export REANIMATE_SCRIPTS=/path/to/reanimate/skills/reanimate/scripts
node tools/reanimate/capture-series.mjs --base http://127.0.0.1:5183 --out captures/mine
```

`tools/reanimate/edge-preload.mjs` makes reanimate drive Edge without changing its code. `tools/reanimate/scene-poses.mjs <capture dir>` prints object poses from a capture.

Captures can be large (hundreds of megabytes each). Keep them out of git.

## What "done" means for a visible change

1. `npm run check` passes.
2. You looked at the changed state in a browser and at one state that should not have changed.
3. New numbers are registered and described.
4. Reduced motion still ends in the right state.
5. The commit message says what changed and, if a measured default was moved, why.
