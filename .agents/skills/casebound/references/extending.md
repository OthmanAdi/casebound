# Extending: objects, looks, layouts, light moods

An extension is a function that receives the engine and returns a cleanup function.

```ts
import type { Extension } from '../src/engine';
const ext: Extension = (engine) => { /* add things */ return () => { /* remove them */ }; };
export default ext;
```

Put it in `extensions/<name>.ts`. Load it with `?ext=<name>` or by listing `<name>` in `content/library.json` under `extensions`.

## What the engine gives you

| On `engine` | What it is |
| --- | --- |
| `ctx.scene`, `ctx.camera`, `ctx.renderer` | The three.js scene, camera and renderer |
| `ctx.registry` | Every tunable thing, by id. `add`, `get`, `set`, `query`, `describe`, `snapshot` |
| `ctx.onFrame(phase, fn)` | Run code every frame. Phases in order: `input`, `scroll`, `layout`, `reader`, `lights`, `effects`, `before-render`, `after-render` |
| `ctx.invalidate()` | Ask for one draw |
| `ctx.lease(name)` | Draw every frame until the returned function is called |
| `ctx.pointer` | Pointer in -1..1, y up, or null on touch |
| `ctx.still` | True when the reader asked for reduced motion |
| `ctx.compact` | True under 900 px wide |
| `ctx.events` | `on('book-focus' | 'book-click' | 'view' | 'page-turn' | 'theme' | 'resize', fn)` |
| `books`, `book(slug)` | The loaded books. Each has `root`, `volume`, `dims`, `record`, `setOpen` |
| `state.active`, `state.inside` | Index of the current book; 0 on the shelf, 1 with the reader open |
| `rig`, `wall`, `fx` | Light rig, shadow wall, uniforms shared by all book surfaces |

World coordinates: the camera sits at (0.11, -1.32, 54) and looks down -z. The shelf plane is z = -36, the shadow wall z = -54.5. One book is 13.52 wide and 20.13 tall.

## An object in the scene

```ts
const remove = engine.addObject({
  id: 'prop.lamp',                 // dotted kebab-case, unique
  label: 'Desk lamp',
  object: lampGroup,               // any Object3D
  describe: 'A small lamp to the left of the centred book.',
  source: 'extensions/lamp.ts',
  update: (f, engine) => {         // optional, every frame
    lampGroup.rotation.y += f.dt * 0.2;
    return true;                   // true = something moved, draw this frame
  },
});
```

Give its numbers names with `tunable`, so they can be found and changed later:

```ts
import { tunable } from '../src/engine';
const t = tunable(engine.ctx.registry, {
  id: 'prop.lamp.light', label: 'Lamp light', kind: 'light', tags: ['light'],
  params: { intensity: { value: 2, min: 0, max: 20 }, color: { value: '#ffd9a0' } },
  onChange: () => engine.ctx.invalidate(),
});
// read t.intensity and t.color where you use them
```

Working example: `extensions/dust.ts`.

## A look for every book surface

Covers, pages and turning leaves share one shader. `defineSurfaceEffect` adds your GLSL at the end of it.

```ts
const amount = { value: 0 };
const remove = engine.defineSurfaceEffect({
  name: 'night-ink',
  uniforms: { uNightInk: amount },
  pars: `uniform float uNightInk;`,
  fragment: `gl_FragColor.rgb = mix( gl_FragColor.rgb, 1.0 - gl_FragColor.rgb, uNightInk );`,
});
```

Inside `fragment` you can use `vMapUv` (surface UV, 0..1), `gl_FragCoord`, `uFxTime` (seconds), `uFxPointer` (pointer, -1..1), and the helpers `bHash(vec2)` and `bNoise(vec2)`. Fade the uniform yourself in an `effects` frame callback and call `ctx.invalidate()` while it changes. Working example: `extensions/aged.ts`.

The two built-in looks are driven the same way: `createSurfaceEffects(engine)` returns `hologram(on)` and `radio(on)`.

## A shelf layout

The shelf calls your function for every featured book each frame, with the default pose already filled in.

```ts
import type { ShelfLayout } from '../src/engine/shelf/shelf';
export const row: ShelfLayout = (book, pose) => {
  // book.offset: 0 centred, +1 one slot above, -1 one below. book.slot, book.count, book.slug also given.
  pose.position.x = book.offset * -16;
  pose.position.y = -2.3;
  pose.visible = Math.abs(book.offset) < 3;
};
```

Pass it when the shelf is created: `createShelf(engine, { layout: row })`. The site does this for `extensions/fan.ts` when opened with `?layout=fan`. `pose.quaternion` is the pose the book eases toward; change it with `premultiply` to keep the default turn.

## A light mood

A preset describes all four lights. Define one and tell the rig to use it.

```ts
import { BROWSE } from '../src/engine/stage/presets';
engine.rig.definePreset('dusk', { ...BROWSE, key: { color: '#ff9a5c', intensity: 2.6, position: [-18, 6, 12] }, ambient: { color: '#b9a6c9', intensity: 0.6 } });
engine.rig.setPresetNames({ shelf: 'dusk' });   // slots: shelf, shelfDark, inside, insideDark
engine.ctx.invalidate();
```

## A different page source

By default the reader flows `record.text` over the pages. To draw pages yourself, pass `pages` when the reader is created:

```ts
createReader(engine, { pages: (book) => (page) => ({ folio: page, left: page % 2 === 0, heading: `Page ${page}`, paragraphs: ['...'] }) });
```

To paint something other than text, change `paintPage` in `src/engine/book/painter.ts`: it receives the page content and returns a canvas texture.
