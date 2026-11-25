# Verify: checks, pictures, frame-by-frame comparison

## The quick checks

```sh
npm run check        # typecheck, unit tests, production build
npm run test         # unit tests only
```

Unit tests cover the parts that can be wrong without anyone noticing by eye: motion primitives at different frame rates, the frame loop, the leaf cross-section, the page turn curve, the scroll pipeline, the turning of a book by hand, the registry.

## Use it like a reader would

Two checks run the site in a real browser and act on it with the pointer and the keys. They stop the engine's own clock and step it by hand, so the result is the same on a slow machine. Each prints one line per step and exits with 1 if a step fails.

```sh
npm run build && npx vite preview --port 5185 &
node tools/capture/check-reader.mjs http://127.0.0.1:5185   # keys, a page pulled over, one let go, taps, a leaf caught in the air, a bundle of leaves, the pens
node tools/capture/check-shelf.mjs http://127.0.0.1:5185    # a book turned by hand, its coasting, a press that opens the details, a jump that skips no book
node tools/capture/check-stills.mjs http://127.0.0.1:5185   # the page without WebGL: a still that rides, turns and opens the details, the row, ?nowebgl and ?webgl
```

Run both after any change to the reader, the shelf, the pointer handling or the site's keys. Add a step when you add an interaction. Run them against a production build: the dev server reloads modules under them.

## Look at it

A change to anything visible is not verified until you have looked at it in a browser.

```sh
npm run dev
node tools/capture/shot.mjs "http://127.0.0.1:5183/?midday" out/home.png --wait 2600
node tools/capture/shot.mjs "http://127.0.0.1:5183/?midday#/book/opticks/page/40" out/reader.png --wait 3200
```

`shot.mjs` opens the page in Microsoft Edge (set `RE_CHANNEL=chrome` or `RE_CHANNEL=` for another browser), waits for `data-casebound-ready` on `<html>`, and reports console errors. Options:

| Option | Meaning |
| --- | --- |
| `--w`, `--h` | Viewport, default 1440 by 900 |
| `--wait <ms>` | Time to wait before the picture |
| `--move x,y` | Move the pointer there first |
| `--eval "<js>"` | Run code in the page and print its result. `casebound` is the engine handle |

Useful one-liners for `--eval`:

```js
casebound.reader.open('opticks')                          // open a book
setTimeout(() => casebound.reader.next(), 1500), 1        // turn a page shortly before the picture
casebound.magnifier.set(true), 1                          // lens on
casebound.effects.hologram(true), 1                       // hologram on
casebound.engine.ctx.registry.describe('reader')          // print values
```

Check at least: the closed book on the shelf, a scroll half way between two books, a book turned by hand, the open spread near the first page, in the middle and near the last page, a leaf in mid-turn, a held leaf, the lens, the two surface effects, the Night theme, a 390 by 844 viewport, and reduced motion.

## Record it

For anything that moves, record a scripted visit as exact frames and look at several of them. The recorder steps the engine's clock, one frame per step.

```sh
node tools/capture/record.mjs http://127.0.0.1:5185 out/rec/drag drag     # scenes: shelf, spin, reader, drag, lens, light, pointer, night, nightlens
node tools/capture/gif.mjs out/rec/drag out/drag.gif --w 720 --fps 15     # needs ffmpeg on the PATH, or its path in FFMPEG
```

A scene is a list of actions at frame numbers: pointer paths, key presses, scrolls. The built-in ones are in `tools/capture/record.mjs`. For a new interaction write your own in a separate file and pass it with `--scene-file`; `tools/capture/scenes.example.mjs` shows the shape. A scene doubles as the source of a README GIF.

The page announces its state for tools: `data-casebound-ready="true"` when it has settled, `data-casebound-view` with the current address (`/`, `/book/<slug>`, `/book/<slug>/page/<n>`).

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

1. `npm run check` passes, and so do `check-reader.mjs`, `check-shelf.mjs` and `check-stills.mjs` when the change touches what they cover. A change to the cover painter touches the stills too: they are cut from the same painted strip.
2. You looked at the changed state in a browser and at one state that should not have changed. For motion, you looked at recorded frames, not at one picture.
3. New numbers are registered and described.
4. Reduced motion still ends in the right state.
5. The commit message says what changed and, if a measured default was moved, why.
