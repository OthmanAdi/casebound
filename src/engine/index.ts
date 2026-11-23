/**
 * Engine entry. `createEngine` wires the context, the stage (lights and shadow wall) and the books, and
 * exposes the extension points. Views (shelf, reader) and effects are added on top of this.
 */
import { Vector3, type Object3D } from 'three';
import { createContext, type ContextOptions, type EngineContext } from './core/app';
import { Book, type BookRecord } from './book/book';
import { PAGE_ARCH } from './book/volume';
import { COVER_RELIEF, DEFAULT_FACES, type Typefaces } from './book/painter';
import { JOINT, createSurfaceFx, defineSurfaceEffect, type SurfaceEffect, type SurfaceFx } from './book/surface';
import type { FrameInfo } from './core/loop';
import { smoothstep } from './core/math';
import type { ParamSpec, Tag } from './core/registry';
import { LightRig } from './stage/rig';
import { themeForHour, type ThemeName } from './stage/presets';
import { ShadowWall } from './stage/wall';

export interface EngineOptions extends ContextOptions {
  books: BookRecord[];
  faces?: Typefaces;
  /** Fixed theme. Default: by local hour. */
  theme?: ThemeName;
}

/** An extension gets the engine and returns a function that removes it again. */
export type Extension = (engine: Engine) => void | (() => void);

/** Anything an extension puts into the scene: a prop, a particle cloud, a second light. */
export interface SceneObjectInit {
  /** Stable dotted kebab-case id, for example `prop.dust`. */
  id: string;
  label: string;
  object: Object3D;
  tags?: Tag[];
  /** One or two sentences an agent can read to understand it. */
  describe?: string;
  /** Named, ranged parameters. `tunable` is the easy way to make them. */
  params?: ParamSpec[];
  /** Where to change it in source. */
  source?: string;
  /** Called every frame. Return true while something is moving, so the scene keeps drawing. */
  update?: (f: FrameInfo, engine: Engine) => boolean | void;
}

export interface Engine {
  readonly ctx: EngineContext;
  readonly rig: LightRig;
  readonly wall: ShadowWall;
  readonly fx: SurfaceFx;
  readonly books: Book[];
  readonly faces: Typefaces;
  /** State other modules write and the stage reads each frame. */
  readonly state: {
    /** Index of the book the lights and shadow follow. */
    active: number;
    /** 0 = shelf, 1 = reader open. */
    inside: number;
    /** How far the pages of the open book have parted, 0..1. */
    parted: number;
  };
  book(slug: string): Book | undefined;
  addBook(record: BookRecord): Book;
  /** Adds an object to the scene and to the registry. Returns a function that removes it. */
  addObject(init: SceneObjectInit): () => void;
  /** Adds a look that every book surface can take on. Returns a function that removes it. */
  defineSurfaceEffect(effect: SurfaceEffect): () => void;
  setTheme(theme: ThemeName): void;
  use(extension: Extension): () => void;
  start(): void;
  dispose(): void;
}

export function createEngine(opts: EngineOptions): Engine {
  const ctx = createContext(opts);
  const faces = opts.faces ?? DEFAULT_FACES;
  const fx = createSurfaceFx();
  const film = tunable(ctx.registry, {
    id: 'effect.film',
    label: 'Film grain',
    kind: 'material-effect',
    tags: ['effect', 'shader', 'material', 'paper'],
    describe: 'Fine grain on paper, new on each drawn frame and stronger in the shadows. A cover material takes it too when its cloth sets `film`.',
    source: 'src/engine/book/surface.ts',
    params: {
      amount: { value: 0.087, min: 0, max: 0.4, help: 'Strength. Measured: 0.116 x 0.75. 0 switches the grain off' },
    },
    onChange: () => ctx.invalidate(),
  });
  const gutter = tunable(ctx.registry, {
    id: 'book.gutter',
    label: 'Gutter light',
    kind: 'material-effect',
    tags: ['effect', 'shader', 'material', 'paper', 'light'],
    describe: 'Where two pages meet: light that bounces between them, and the shade of the fold.',
    source: 'src/engine/book/surface.ts',
    params: {
      bounce: { value: 0.39 * 0.6, min: 0, max: 2, help: 'Strength of the light that bounces between the pages. Measured: 0.39 x 0.6' },
      reach: { value: 0.29, min: 0.05, max: 1, help: 'How far from the spine the bounce reaches, as a share of the page width' },
      sharpness: { value: 1.87, min: 0.25, max: 8 },
      color: { value: '#9985b0', help: 'Colour of the bounced light' },
      shade: { value: 1, min: 0, max: 1.6, help: 'Strength of the shade in the fold' },
    },
    onChange: () => ctx.invalidate(),
  });
  const books: Book[] = [];
  const arch = tunable(ctx.registry, {
    id: 'book.arch',
    label: 'Belly of the pages',
    kind: 'shape',
    tags: ['book', 'paper', 'shape'],
    describe: 'How far the pages of an open book bulge between the gutter and the fore-edge.',
    source: 'src/engine/book/volume.ts',
    params: {
      height: { value: PAGE_ARCH.height, min: 0, max: 0.3, help: 'Belly of the top page of a thick stack, as a share of the page width. 0 lays every page flat. Measured: about 0.085 with half the book on each side' },
      fall: { value: PAGE_ARCH.fall, min: 0.005, max: 0.5, help: 'Stack height at which a page has two thirds of the belly, as a share of the page width. Smaller: thin stacks bulge too' },
    },
    onChange: () => {
      for (const b of books) {
        b.volume.arch = { height: arch.height, fall: arch.fall };
        b.refresh();
      }
      ctx.invalidate();
    },
  });
  const relief = tunable(ctx.registry, {
    id: 'book.relief',
    label: 'Stamped relief',
    kind: 'material-effect',
    tags: ['material', 'shader', 'cover', 'light'],
    describe: 'How type and ornaments are pressed into a cover. The depth scales what the lights see; the wall is painted into the relief map, so changing it paints every cover again.',
    source: 'src/engine/book/painter.ts',
    params: {
      depth: { value: 1, min: 0, max: 4, help: 'Depth of every stamp, as a multiple of the cover\'s own strength (`material.bumpEmboss`, in world units). 0 makes covers flat' },
      press: { value: COVER_RELIEF.press, min: 0, max: 0.5, help: 'How far type is pressed into the relief map, as a share of its range. Ornaments go 0.65 as deep. Repaints the covers' },
      wall: { value: COVER_RELIEF.wall, min: 0.6, max: 6, unit: 'texel', help: 'Half width of the wall of a stamped letter in the relief map. Measured: walls about two pixels wide at shelf distance. Larger is softer. Repaints the covers' },
    },
    onChange: (key) => {
      if (key !== 'depth') for (const b of books) b.repaintCover(relief);
      ctx.invalidate();
    },
  });
  const joint = tunable(ctx.registry, {
    id: 'book.joint',
    label: 'Joint of the case',
    kind: 'material-effect',
    tags: ['material', 'shader', 'cover', 'light'],
    describe: 'Where a board meets the spine: a relief that makes the round hinge read as a square back with a groove beside it. Measured across the joint of a closed book: board brightness 0.16 world units from the edge of the spine, 14 percent darker 0.25 further on, level again after 0.45.',
    source: 'src/engine/book/surface.ts',
    params: {
      corner: { value: JOINT.corner, min: 0, max: 1.5, help: 'How square the back reads. 0 leaves the hinge round as it is built' },
      drop: { value: JOINT.drop, min: 0, max: 0.5, unit: 'world', help: 'How far the cloth comes down from the edge of the spine onto the board. This is the depth of the groove. 0 leaves none' },
      start: { value: JOINT.start, min: -0.3, max: 0.6, unit: 'world', help: 'Where the descent starts, measured from the middle of the hinge toward the board' },
      run: { value: JOINT.run, min: 0.05, max: 1.5, unit: 'world', help: 'Length of the descent. Shorter is a sharper groove' },
    },
    onChange: () => ctx.invalidate(),
  });
  const rig = new LightRig(ctx.registry);
  const wall = new ShadowWall(ctx.registry);
  ctx.scene.add(rig.group, wall.mesh);
  rig.theme = opts.theme ?? themeForHour(new Date().getHours());

  const removers: (() => void)[] = [];
  const state = { active: 0, inside: 0, parted: 0 };
  const world = new Vector3();

  const engine: Engine = {
    ctx,
    rig,
    wall,
    fx,
    books,
    faces,
    state,
    book: (slug) => books.find((b) => b.record.slug === slug),
    addBook: (record) => {
      const book = new Book(record, ctx.registry, fx, faces, relief);
      book.volume.arch = { height: arch.height, fall: arch.fall };
      book.refresh();
      books.push(book);
      ctx.scene.add(book.root);
      ctx.invalidate();
      return book;
    },
    addObject: (init) => {
      ctx.scene.add(init.object);
      ctx.registry.add({ id: init.id, label: init.label, kind: init.object.type, tags: ['object', ...(init.tags ?? [])], object: init.object, describe: init.describe, params: init.params, source: init.source });
      const update = init.update;
      const stop = update
        ? ctx.onFrame('layout', (f) => {
            if (update(f, engine)) ctx.invalidate();
          })
        : (): void => undefined;
      ctx.invalidate();
      const remove = (): void => {
        stop();
        init.object.removeFromParent();
        ctx.registry.remove(init.id);
        ctx.invalidate();
      };
      removers.push(remove);
      return remove;
    },
    defineSurfaceEffect: (effect) => {
      const remove = defineSurfaceEffect(effect);
      ctx.invalidate();
      removers.push(remove);
      return remove;
    },
    setTheme: (theme) => {
      rig.theme = theme;
      ctx.events.emit('theme', { theme });
      ctx.invalidate();
    },
    use: (extension) => {
      const remove = extension(engine) ?? ((): void => undefined);
      removers.push(remove);
      return remove;
    },
    start: () => ctx.loop.start(),
    dispose: () => {
      for (const r of removers.splice(0)) r();
      for (const b of books.splice(0)) b.dispose();
      ctx.dispose();
    },
  };

  for (const record of opts.books) engine.addBook(record);

  /** Distance from the wall plane to the point of a book's case that is farthest from it. */
  const reach = (book: Book): number => {
    const mesh = book.volume.caseMesh;
    mesh.updateWorldMatrix(true, false);
    const e = mesh.matrixWorld.elements;
    const p = mesh.geometry.getAttribute('position');
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < p.count; i++) {
      const z = e[2]! * p.getX(i) + e[6]! * p.getY(i) + e[10]! * p.getZ(i) + e[14]!;
      if (z < lo) lo = z;
      if (z > hi) hi = z;
    }
    return Math.max(Math.abs(lo - wall.centre.z), Math.abs(hi - wall.centre.z));
  };

  ctx.onFrame('lights', (f) => {
    const active = books[state.active];
    const pivot = active ? Math.abs(active.root.getWorldPosition(world).z - wall.centre.z) : 18.5;
    const wallMoving = wall.update(f.dt, pivot, active ? reach(active) : pivot, state.inside, ctx.still);
    const rigMoving = rig.update(f.dt, { pointer: ctx.pointer, inside: state.inside, bookColor: active?.record.background ?? null, shadowCentre: wall.centre, compact: ctx.compact }, ctx.still);
    fx.uFxTime.value = f.time;
    fx.uFilm.value = film.amount;
    fx.uBounce.value = gutter.bounce;
    fx.uBounceReach.value = gutter.reach;
    fx.uBounceSharp.value = gutter.sharpness;
    fx.uBounceColor.value.set(gutter.color).convertLinearToSRGB();
    fx.uGutterShade.value = gutter.shade;
    // Measured on the first leaf of an opening book: its light is held down until the pages start to part.
    fx.uShoulder.value = 1 - smoothstep(0.03, 0.25, state.parted);
    fx.uStamp.value = relief.depth;
    fx.uJointShape.value.set(joint.corner, joint.drop, joint.start, joint.run);
    fx.uFilmSeed.value = (f.frame * 37) % 1024;
    // Measured: the effects follow the pointer with a short lag instead of jumping to it.
    if (ctx.pointer) fx.uFxPointer.value.lerp(ctx.pointer, ctx.still ? 1 : 1 - Math.exp(-12.8 * Math.min(f.dt, 0.05)));
    if (wallMoving || rigMoving || fx.uHolo.value > 0.001 || fx.uRadio.value > 0.001) ctx.invalidate();
  });

  return engine;
}

export { Book, type BookRecord } from './book/book';
export type { CoverDesign, CoverPattern, Grain, PageContent, Typefaces } from './book/painter';
export type { SurfaceEffect } from './book/surface';
export type { FrameInfo, FramePhase } from './core/loop';
import { tunable } from './core/tune';
export { tunable };
export type { EngineContext } from './core/app';
export type { LightPreset, ThemeName } from './stage/presets';
