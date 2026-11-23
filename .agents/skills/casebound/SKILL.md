---
name: casebound
description: Build, extend and tune a Casebound library: lit 3D hardcover books in the browser with a damped shelf, real page turns, a magnifier and surface effects. Use when asked to add or restyle a book, change lights or motion, add an object, effect or layout, or check that a change still looks and moves right.
---

# Casebound

Casebound draws hardcover books with three.js and puts an ordinary web page around them. Every book is generated from a few lines of data: its geometry, its cover, its pages. Every number that shapes light or motion is a named parameter you can read and change while the page runs.

Use this skill inside a checkout of the project. Read `package.json` for the scripts and `research/SPEC.md` if you need to know why a number has the value it has.

## Before you change anything

1. `npm install --legacy-peer-deps`, then `npm run dev`. The site is at `http://127.0.0.1:5183/`, the bare test stage at `http://127.0.0.1:5183/dev/stage.html`.
2. Open the browser console. `casebound.engine.ctx.registry.describe()` prints every tunable thing with its current values and the file that owns it.
3. Decide which of the four kinds of change you are making. Each has its own reference file.

| The request is about | Do this | Reference |
| --- | --- | --- |
| A book: add one, change its cover, give it text | Edit data under `content/` | [content.md](references/content.md) |
| How something looks or moves: light, shadow, scroll feel, page turn, lens | Change a named parameter, then write the value into source | [tuning.md](references/tuning.md) |
| Something new in the scene: a prop, a look for the pages, a different shelf arrangement, a light mood | Write an extension in `extensions/` | [extending.md](references/extending.md) |
| Whether it still works | Run the checks and look at it | [verify.md](references/verify.md) |

## Add a book

Create `content/books/<slug>/book.json` and list the slug in `content/library.json` under `featured`. Nothing else is needed: the cover, the page edges and the pages are painted from the record.

```json
{
  "slug": "the-sceptical-chymist",
  "title": "The Sceptical Chymist",
  "author": "Robert Boyle",
  "year": 1661,
  "pages": 300,
  "background": "#6b5a3c",
  "blurb": "Two or three plain sentences about the book.",
  "cover": { "cloth": "#3a2a1c", "ink": "#e3c98a", "pattern": "rules", "foil": "#d9b25a", "grain": "buckram" }
}
```

For text, add `content/books/<slug>/text.json` with `{ "paragraphs": ["...", "..."] }`. If the book is on Project Gutenberg, put `"source": { "name": "Project Gutenberg", "id": <number> }` in the record and run `node tools/content/gutenberg.mjs <slug>`. Use only text you have the right to publish.

## Tune light or motion

Find the parameter, try values live, then make the change durable in source.

```js
casebound.engine.ctx.registry.query('tag:light')            // what exists
casebound.engine.ctx.registry.set('light.rig', 'spotSwing', 50)   // try it now
casebound.engine.ctx.registry.snapshot('reader')           // current values, ready to copy
```

A live change lasts until reload. To keep it, change the default where the parameter is declared: the `source` line of `describe()` names the file. Light colours, intensities and positions live in `src/engine/stage/presets.ts`.

## Add something new

An extension is one file in `extensions/` with a default export. It receives the engine and returns a function that undoes it. Three working examples are in the folder: `dust.ts` (an object), `aged.ts` (a look for every book surface), `fan.ts` (a shelf layout).

```ts
import type { Extension } from '../src/engine';

const mine: Extension = (engine) => {
  const remove = engine.addObject({ id: 'prop.mine', label: 'My prop', object: myMesh });
  return remove;
};
export default mine;
```

Load it with `?ext=mine` while developing. To ship it, add `"mine"` to `extensions` in `content/library.json`.

Rules that keep extensions healthy:

1. Register what you add. `engine.addObject` does it for objects; use `tunable` for numbers. An unregistered number cannot be found or tuned by the next person or agent.
2. Ask for a draw when something changed: return `true` from `update`, or call `engine.ctx.invalidate()`. The scene is drawn on demand, so a silent change stays invisible.
3. Respect `engine.ctx.still`. When it is true the reader asked for reduced motion: jump to the end state instead of animating.
4. Return a cleanup function that removes everything you added.

## Verify

Run `npm run check` (types, unit tests, production build). Then look at the result in a real browser, because a passing build says nothing about how a page turn looks:

```sh
node tools/capture/shot.mjs "http://127.0.0.1:5183/#/book/<slug>/page/20" out.png --wait 3000
```

Read the picture. Check the closed book on the shelf, the open spread, one page turn, the magnifier, and the page with reduced motion turned on.

## Boundaries

- Covers, pages, grain and backgrounds are generated in code. Do not add third-party artwork, scans, models or typefaces unless the user states they hold the rights and names the licence. Record anything added in `THIRD_PARTY_NOTICES.md` and `PROVENANCE.md`.
- The motion and light values were measured from a public reference site and are documented in `research/`. The material used for that study is not part of the repository and must not be added to it.
- Do not remove the registry entries or the on-demand drawing to make a change easier. Both are what other changes rely on.
