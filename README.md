# Bindery

**Lit hardcover books in the browser, and a system for adding your own.** A shelf you scroll with weight, books that open, leaves that turn like paper, a magnifier, and two light effects that run over the pages. Every book is a few lines of data. Every light and every motion is a named number a person or a coding agent can change.

> Working title. The name and the demo address are set at the first public release.

## Try it

```sh
git clone <this repository>
cd bindery
npm install --legacy-peer-deps
npm run dev
```

Open `http://127.0.0.1:5183/`. Needs Node 22 or newer.

| Do this | To see |
| --- | --- |
| Scroll | Books ride up with the page, hold at the centre, turn away as they leave |
| Move the pointer | The book tilts and a spot of light follows |
| `Space`, or **Open book** | The book opens toward you |
| `→` and `←` | A leaf turns. In the air the print on its other side shows through |
| `m`, or the lens button | A round magnifier follows the pointer |
| **View details**, then hover **E-book** or **Audiobook** | Hologram scanlines, or radio rings, run over the whole book |
| The theme button | Morning, Noon and Night light |
| `Esc` | Back to the shelf |

## What is in it

| Part | What it does | Where |
| --- | --- | --- |
| Books | Case, hinges, page blocks and turning leaves are generated. No model files | [`src/engine/book/`](src/engine/book) |
| Covers and pages | Painted in code from the book's record: colour, emboss, foil, cloth grain, page edges, typeset pages | [`painter.ts`](src/engine/book/painter.ts) |
| Surfaces | Cloth shading with a fabric sheen, softened highlights, foil that shifts with the angle | [`surface.ts`](src/engine/book/surface.ts) |
| Light | Four lights in presets that blend by theme and by view; a spot follows the pointer; shadows fall on a wall behind the books | [`src/engine/stage/`](src/engine/stage) |
| Shelf | Scroll to motion: a hold on each book, critically damped follow, leave and arrive poses | [`src/engine/shelf/`](src/engine/shelf) |
| Reader | Opening, lean toward the pointer, page turn physics | [`src/engine/reader/`](src/engine/reader) |
| Effects | Magnifier pass, hologram and radio looks | [`src/engine/effects/`](src/engine/effects) |
| Registry | Every tunable number with id, range and help text | [`registry.ts`](src/engine/core/registry.ts) |
| Site | The page around the canvas: marquee, panels, toolbar, detail column, deep links | [`src/site/`](src/site) |

## Add a book

Make a folder and a record. The cover, the edges and the pages follow from it.

```
content/books/my-book/book.json
```

```json
{
  "slug": "my-book",
  "title": "My Book",
  "author": "Me",
  "pages": 280,
  "background": "#5a6b7c",
  "cover": { "cloth": "#22324a", "ink": "#e8dcc0", "pattern": "rules", "foil": "#d9b25a", "grain": "buckram" }
}
```

Add `"my-book"` to `featured` in [`content/library.json`](content/library.json). For text, put `{ "paragraphs": ["..."] }` in `text.json` beside the record. All fields are listed in the [content reference](.agents/skills/bindery/references/content.md).

## Extend it

An extension is one file in [`extensions/`](extensions) that receives the engine. Three examples are included.

| Example | Adds | Try |
| --- | --- | --- |
| [`dust.ts`](extensions/dust.ts) | An object: dust motes in the light | `?ext=dust` |
| [`aged.ts`](extensions/aged.ts) | A look for every book surface: aged paper | `?ext=aged`, then press `a` |
| [`fan.ts`](extensions/fan.ts) | A shelf layout: books fan out like cards | `?layout=fan` |

```ts
import type { Extension } from '../src/engine';

const mine: Extension = (engine) =>
  engine.addObject({ id: 'prop.mine', label: 'My prop', object: myMesh });

export default mine;
```

The [extension reference](.agents/skills/bindery/references/extending.md) covers objects, surface effects, layouts, light presets and page sources.

## Tune it

Open the console on the running page.

```js
bindery.engine.ctx.registry.describe('tag:light')
bindery.engine.ctx.registry.set('light.rig', 'spotSwing', 50)
bindery.engine.ctx.registry.snapshot('reader')
```

The [tuning reference](.agents/skills/bindery/references/tuning.md) lists what is registered and where each default lives.

## For coding agents

The skill in [`.agents/skills/bindery`](.agents/skills/bindery/SKILL.md) tells an agent how to add a book, tune a value, write an extension and verify the result. Point your agent at `SKILL.md`, or copy the folder into its skills directory and give it the path of this checkout.

Example request:

> Use the Bindery skill. Add "The Sceptical Chymist" by Robert Boyle with a dark brown buckram cover and gold foil, fetch its text, and make the Night theme's key light a little warmer. Show me the shelf and one open spread.

## How the values were found

The feel of this project was measured, not guessed. A public reference site with a similar idea was studied in three ways: its shipped code was read for constants, its running scene was inspected in a browser, and its motion was captured frame by frame under a virtual clock. The numbers are collected in [`research/SPEC.md`](research/SPEC.md) with a note on how each was verified. The capture tooling is in [`tools/`](tools) and can be run against any page, including this one.

No code, shader, model, artwork, text or typeface of the reference is in this repository. [`PROVENANCE.md`](PROVENANCE.md) says what is here and where it came from.

## Verify

| Command | Purpose |
| --- | --- |
| `npm run check` | Typecheck, unit tests, production build |
| `node tools/capture/shot.mjs <url> <out.png>` | One picture of a page in Edge, with console errors |
| `node tools/reanimate/capture-series.mjs --base <url> --out <dir>` | Frame-by-frame capture of the standard interactions |

See the [verify reference](.agents/skills/bindery/references/verify.md).

## Licence

Source under [Apache-2.0](LICENSE). The demo texts are in the public domain and come from Project Gutenberg. Typefaces and libraries are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
