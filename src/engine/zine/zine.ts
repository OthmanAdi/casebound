/**
 * The zine of a book in the scene (SPEC S-ZINE-3..6).
 *
 * A zine is a `Book` with the pamphlet binding, built from the record `zineRecord` derives. It is added to the
 * engine the first time it is asked for, after the shelf has taken its books, so the shelf never places it. This
 * unit flies it in from the right, lays it closed over the picture, hands it to the reader when its cover is
 * turned, and flies it out again. Reading it is the reader's business: leaves, bar, lens and pens are the book's.
 *
 * The reader brings a book from its `home` to the reading place with the cover's own progress. The zine's `home`
 * is the place where it lies closed, so the first turn opens the cover and brings the zine to the reading place in
 * one motion, as measured.
 */
import { Euler, Vector3 } from 'three';
import type { Book } from '../book/book';
import { tunable } from '../core/tune';
import type { Engine } from '../index';
import type { Reader } from '../reader/reader';
import { ZINE_POSE, flyOffset, flyTurn, stepPresence, zineNumber, zinePage } from './pose';
import { bookOf, isZine, zineRecord, zineSlug } from './record';

export type ZineState = 'away' | 'coming' | 'lying' | 'reading' | 'going';

export interface ZineOptions {
  /** Offset of the middle of the picture from the canvas centre, in CSS pixels. The same the reader is given. */
  centreOffsetPx?: () => { x: number; y: number };
  /** Called when the state or the zine on show changes. */
  onChange?: () => void;
  /** A press that starts inside an element matching this selector does not turn the cover. */
  ignore?: string;
}

export interface Zines {
  /** Slug of the book whose zine is out, or null. */
  readonly slug: string | null;
  readonly state: ZineState;
  /** The pamphlet that is out. */
  readonly book: Book | null;
  /** 0 = the book has the picture, 1 = it has made room for its zine. */
  readonly room: number;
  /** How far the book stands aside for its zine right now, world units. Add it to the book's place. */
  away(): { x: number; y: number };
  /** The number the bar shows: 1 closed, then the sides turned. */
  readonly number: number;
  /** True for a book whose record has a zine. */
  has(slug: string): boolean;
  /** Brings the zine of a book in. With a number above 1 it is opened there once it lies. False: the book has none. */
  open(slug: string, number?: number): boolean;
  /** Turns the cover of the zine that lies closed, or goes to a number in the one that is open. */
  read(number?: number): void;
  /** Shuts the cover of the open zine again. It stays, lying closed. */
  shut(): void;
  /** Closes it and sends it away. */
  close(): void;
  /** The box of the zine in the window, CSS pixels: left, top, width, height. Null while none is drawn. */
  rect(): [number, number, number, number] | null;
  dispose(): void;
}

/** What the reader is told while it holds a zine, and what it had before. */
const READER_KEYS = ['forward', 'scale', 'openDelay'] as const;

export function createZines(engine: Engine, reader: Reader, opts: ZineOptions = {}): Zines {
  const { ctx } = engine;
  const t = tunable(ctx.registry, {
    id: 'zine',
    label: 'Zine',
    kind: 'view',
    tags: ['animation', 'book', 'interaction'],
    describe: 'The pamphlet cut from a book: how it flies in, where it lies closed, and where it is read.',
    source: 'src/engine/zine/zine.ts',
    params: {
      flyFrom: { value: ZINE_POSE.flyFrom, min: 0, max: 120, help: 'How far to the right it starts, world units. Measured: 45' },
      flyRate: { value: ZINE_POSE.flyRate, min: 0.01, max: 1, help: 'Share of the remaining way it closes in a frame of 1/60 s, coming and going. Measured: 0.12' },
      liePitch: { value: ZINE_POSE.liePitch, min: -90, max: 30, unit: 'deg', help: 'How far the closed zine leans back at rest. Fitted to a still: -21' },
      lieYaw: { value: ZINE_POSE.lieYaw, min: -60, max: 60, unit: 'deg', help: 'Its turn about the upright at rest: the fore-edge goes back. Fitted to a still: 33' },
      lieRoll: { value: ZINE_POSE.lieRoll, min: -45, max: 45, unit: 'deg', help: 'Its turn in the picture plane at rest. Fitted to a still: 11' },
      lieLeft: { value: -0.3, min: -20, max: 20, help: 'How far left of the reading place the fold of the closed zine lies. Fitted to a still: 0.3 to the right of it' },
      lieUp: { value: 0.18, min: -10, max: 10, help: 'How far above the reading place it lies. Measured: 0.18' },
      lieForward: { value: 3.56, min: 0, max: 30, help: 'How far in front of its book the closed zine lies. Measured: 3.56' },
      lieScale: { value: 0.88, min: 0.2, max: 2, help: 'Scale of the closed zine. Fitted to a still: 0.88' },
      forward: { value: 5, min: 0, max: 30, help: 'How far in front of its book the zine is read. Measured: 5' },
      scale: { value: 0.896, min: 0.2, max: 2, help: 'Scale of the open zine. Measured: a page 12.11 wide, which is 0.896 of ours' },
      linkWait: { value: 2, min: 0, max: 10, unit: 's', help: 'A zine opened at a page by its address lies closed this long first. Read in the reference: 2' },
      bookAwayX: { value: 19, min: 0, max: 60, help: 'How far to the left its book goes to make room' },
      bookAwayY: { value: 5, min: -30, max: 30, help: 'And how far down' },
    },
  });
  const pose = (): typeof ZINE_POSE => ({ flyFrom: t.flyFrom, flyRate: t.flyRate, shown: ZINE_POSE.shown, liePitch: t.liePitch, lieYaw: t.lieYaw, lieRoll: t.lieRoll });

  const pamphlets = new Map<string, Book>();
  let out: { slug: string; book: Book } | null = null;
  let state: ZineState = 'away';
  let p = 0;
  /** A number to open at once the zine lies, and how long it has lain. */
  let pending: number | null = null;
  let lain = 0;
  let saved: Partial<Record<(typeof READER_KEYS)[number], number>> | null = null;
  const e = new Euler();
  const v = new Vector3();

  const set = (next: ZineState): void => {
    if (state === next) return;
    state = next;
    opts.onChange?.();
    ctx.invalidate();
  };

  /** The pamphlet of a book, built on first use. */
  const pamphlet = (slug: string): Book | null => {
    const have = pamphlets.get(slug);
    if (have) return have;
    const parent = engine.book(slug);
    const record = parent && zineRecord(parent.record);
    if (!record) return null;
    const active = engine.state.active;
    const book = engine.addBook(record);
    engine.state.active = active;
    book.root.visible = false;
    pamphlets.set(slug, book);
    return book;
  };

  /** Gives the reader the zine's reading place, and keeps what it had for the books. */
  const lend = (): void => {
    if (saved) return;
    saved = {};
    for (const key of READER_KEYS) saved[key] = Number(ctx.registry.getParam('reader', key));
    ctx.registry.set('reader', 'forward', t.forward - t.lieForward);
    ctx.registry.set('reader', 'scale', t.scale / t.lieScale);
    // Measured: the cover moves in the frame after the key.
    ctx.registry.set('reader', 'openDelay', 0);
  };
  const giveBack = (): void => {
    if (!saved) return;
    for (const key of READER_KEYS) if (Number.isFinite(saved[key])) ctx.registry.set('reader', key, saved[key]!);
    saved = null;
  };

  const hide = (): void => {
    if (!out) return;
    out.book.root.visible = false;
    out = null;
    p = 0;
    pending = null;
    giveBack();
    set('away');
  };

  const read = (number?: number): void => {
    if (!out || state === 'going' || state === 'away') return;
    const page = zinePage(number ?? 2, out.book.dims.leaves) ?? 0;
    if (state === 'reading') {
      reader.goTo(page);
      return;
    }
    // On its way in it finishes the way first.
    if (state === 'coming') {
      pending = number ?? 2;
      return;
    }
    const active = engine.state.active;
    lend();
    reader.open(zineSlug(out.slug), page);
    // The book it was cut from stays the one the page is about.
    engine.state.active = active;
    pending = null;
    set('reading');
  };

  const rect = (): [number, number, number, number] | null => {
    if (!out || !out.book.root.visible) return null;
    const mesh = out.book.volume.caseMesh;
    mesh.updateWorldMatrix(true, false);
    const at = mesh.geometry.getAttribute('position');
    const box = ctx.canvas.getBoundingClientRect();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < at.count; i++) {
      v.set(at.getX(i), at.getY(i), at.getZ(i)).applyMatrix4(mesh.matrixWorld).project(ctx.camera);
      const x = box.left + (v.x * 0.5 + 0.5) * box.width;
      const y = box.top + (0.5 - v.y * 0.5) * box.height;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    return Number.isFinite(x0) ? [x0, y0, x1 - x0, y1 - y0] : null;
  };

  const unsub = ctx.onFrame('layout', (f) => {
    if (!out) return;
    const book = out.book;
    const coming = state === 'coming' || state === 'lying' || state === 'reading';
    const before = p;
    p = ctx.still ? (coming ? 1 : 0) : stepPresence(p, coming, f.dt, pose());

    // The reading place, as the reader will work it out, and the place to lie relative to it.
    const parent = engine.book(out.slug);
    const depth = parent ? parent.home.position.z : book.home.position.z;
    const zRead = depth + t.forward;
    const offset = opts.centreOffsetPx?.() ?? { x: 0, y: 0 };
    const perPx = ctx.visibleHeightAt(zRead) / Math.max(1, ctx.size.y);
    const turn = flyTurn(p, pose());
    book.home.position.set(offset.x * perPx - t.lieLeft + flyOffset(p, pose()), ctx.camera.position.y - offset.y * perPx + Number(ctx.registry.getParam('reader', 'rise') ?? 0) + t.lieUp, depth + t.lieForward);
    book.home.quaternion.setFromEuler(e.set(turn.pitch, turn.yaw, turn.roll));
    book.home.scale = t.lieScale;
    if (!book.held) {
      book.root.position.copy(book.home.position);
      book.root.quaternion.copy(book.home.quaternion);
      book.root.scale.setScalar(book.home.scale);
    }
    book.root.visible = p > ZINE_POSE.shown;

    if (state === 'coming' && p >= 1) {
      lain = 0;
      set('lying');
    }
    if (state === 'lying' && pending !== null) {
      lain += f.dt;
      if (lain >= t.linkWait || ctx.still) read(pending);
    }
    // The reader was closed by someone else: by its bar, or by a key.
    if (state === 'reading' && reader.book !== book && !book.held) set('going');
    if (state === 'going' && reader.book !== book && !book.held) {
      giveBack();
      if (p <= 0) hide();
    }
    if (p !== before || state === 'coming' || state === 'going') ctx.invalidate();
  });

  const ignore = opts.ignore ?? 'button, a, input, select, textarea, label, aside, header, footer, nav, [role="toolbar"], [role="dialog"]';
  const onDown = (ev: PointerEvent): void => {
    if (state !== 'lying' || ev.button !== 0 || !ev.isPrimary) return;
    if (ev.target instanceof Element && ev.target.closest(ignore)) return;
    const box = rect();
    if (!box || ev.clientX < box[0] || ev.clientX > box[0] + box[2] || ev.clientY < box[1] || ev.clientY > box[1] + box[3]) return;
    read();
  };
  window.addEventListener('pointerdown', onDown);

  return {
    get slug() {
      return out?.slug ?? null;
    },
    get state() {
      return state;
    },
    get book() {
      return out?.book ?? null;
    },
    get room() {
      const q = Math.min(1, Math.max(0, p));
      return 1 - (1 - q) * (1 - q);
    },
    get number() {
      return zineNumber(out && state === 'reading' && reader.book === out.book ? reader.page / 2 : null);
    },
    has: (slug) => !isZine(slug) && !!engine.book(slug)?.record.zine,
    open: (slug, number) => {
      slug = bookOf(slug);
      if (out && out.slug !== slug) {
        if (reader.book === out.book) reader.close();
        hide();
      }
      const book = pamphlet(slug);
      if (!book) return false;
      if (!out) out = { slug, book };
      pending = number !== undefined && number >= 2 ? number : null;
      if (state === 'away' || state === 'going') set(p >= 1 ? 'lying' : 'coming');
      else if (state === 'reading' && pending !== null) read(pending);
      return true;
    },
    read,
    shut: () => {
      if (!out || state !== 'reading') return;
      if (reader.book === out.book) reader.close();
      pending = null;
      lain = 0;
      set('lying');
    },
    close: () => {
      if (!out || state === 'away' || state === 'going') return;
      if (reader.book === out.book) reader.close();
      pending = null;
      set('going');
    },
    away: () => {
      const q = Math.min(1, Math.max(0, p));
      const room = 1 - (1 - q) * (1 - q);
      return { x: -t.bookAwayX * room, y: -t.bookAwayY * room };
    },
    rect,
    dispose: () => {
      unsub();
      window.removeEventListener('pointerdown', onDown);
      giveBack();
      // The pamphlets are books of the engine and go with it.
      pamphlets.clear();
      ctx.registry.remove('zine');
    },
  };
}
