/**
 * Engine entry. `createEngine` wires the context, the stage (lights and shadow wall) and the books, and
 * exposes the extension points. Views (shelf, reader) and effects are added on top of this.
 */
import type { Object3D } from 'three';
import { createContext, type ContextOptions, type EngineContext } from './core/app';
import { Book, type BookRecord } from './book/book';
import { DEFAULT_FACES, type Typefaces } from './book/painter';
import { createSurfaceFx, defineSurfaceEffect, type SurfaceEffect, type SurfaceFx } from './book/surface';
import type { FrameInfo } from './core/loop';
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
  const rig = new LightRig(ctx.registry);
  const wall = new ShadowWall(ctx.registry);
  ctx.scene.add(rig.group, wall.mesh);
  rig.theme = opts.theme ?? themeForHour(new Date().getHours());

  const books: Book[] = [];
  const removers: (() => void)[] = [];
  const state = { active: 0, inside: 0 };

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
      const book = new Book(record, ctx.registry, fx, faces);
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
    const wallMoving = wall.update(f.dt, active ? reach(active) : 18.5, state.inside, ctx.still);
    const rigMoving = rig.update(f.dt, { pointer: ctx.pointer, inside: state.inside, bookColor: active?.record.background ?? null, shadowCentre: wall.centre, compact: ctx.compact }, ctx.still);
    fx.uFxTime.value = f.time;
    fx.uFilm.value = film.amount;
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
