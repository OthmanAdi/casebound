/**
 * Engine entry. `createEngine` wires the context, the stage (lights and shadow wall) and the books, and
 * exposes the extension points. Views (shelf, reader) and effects are added on top of this.
 */
import { Vector3 } from 'three';
import { createContext, type ContextOptions, type EngineContext } from './core/app';
import { Book, type BookRecord } from './book/book';
import { DEFAULT_FACES, type Typefaces } from './book/painter';
import { createSurfaceFx, type SurfaceFx } from './book/surface';
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
  setTheme(theme: ThemeName): void;
  use(extension: Extension): () => void;
  start(): void;
  dispose(): void;
}

export function createEngine(opts: EngineOptions): Engine {
  const ctx = createContext(opts);
  const faces = opts.faces ?? DEFAULT_FACES;
  const fx = createSurfaceFx();
  const rig = new LightRig(ctx.registry);
  const wall = new ShadowWall(ctx.registry);
  ctx.scene.add(rig.group, wall.mesh);
  rig.theme = opts.theme ?? themeForHour(new Date().getHours());

  const books: Book[] = [];
  const removers: (() => void)[] = [];
  const state = { active: 0, inside: 0 };
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
      const book = new Book(record, ctx.registry, fx, faces);
      books.push(book);
      ctx.scene.add(book.root);
      ctx.invalidate();
      return book;
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

  ctx.onFrame('lights', (f) => {
    const active = books[state.active];
    const bookZ = active ? active.root.getWorldPosition(world).z : -36;
    const wallMoving = wall.update(f.dt, bookZ, state.inside, ctx.still);
    const rigMoving = rig.update(f.dt, { pointer: ctx.pointer, inside: state.inside, bookColor: active?.record.background ?? null, shadowCentre: wall.centre, compact: ctx.compact }, ctx.still);
    rig.key.shadow.radius *= wall.radiusScale;
    fx.uFxTime.value = f.time;
    if (ctx.pointer) fx.uFxPointer.value.set(ctx.pointer.x, ctx.pointer.y);
    if (wallMoving || rigMoving || fx.uHolo.value > 0.001 || fx.uRadio.value > 0.001) ctx.invalidate();
  });

  return engine;
}

export { Book, type BookRecord } from './book/book';
export type { CoverDesign, CoverPattern, Grain, PageContent, Typefaces } from './book/painter';
export type { EngineContext } from './core/app';
export type { LightPreset, ThemeName } from './stage/presets';
