/**
 * The reader: opens a book from the shelf, lays it open toward the camera, turns its leaves and closes it again.
 * SPEC section 9.
 */
import { Euler, Quaternion, Vector3, type Texture } from 'three';
import type { Book } from '../book/book';
import type { Engine } from '../index';
import { DEG, approach, clamp, easeOutCubic, lerp, powerSigmoid } from '../core/math';
import { tunable } from '../core/tune';
import { Leaf } from './leaf';
import { LEAF_DEFAULT, sendLeaf, stepLeaf } from './leaf-physics';
import { paginate, type PageSource } from './pages';

export interface ReaderOptions {
  /** Custom page content per book. Default: the record's text, paginated. */
  pages?: (book: Book) => PageSource | undefined;
  /** Offset of the open book from the canvas centre, in CSS pixels. */
  centreOffsetPx?: () => { x: number; y: number };
  /** Extra scale for the open book, for layouts where it shares the screen. Default 1. */
  fit?: () => number;
}

export interface Reader {
  readonly isOpen: boolean;
  /** 0 = closed, 1 = fully open. */
  readonly openness: number;
  readonly book: Book | null;
  /** Number of the left-hand page of the spread. The right-hand page is this plus one. */
  readonly page: number;
  readonly pageCount: number;
  open(slug: string, page?: number): void;
  close(): void;
  next(): boolean;
  previous(): boolean;
  goTo(page: number): void;
  dispose(): void;
}

const LIVE_LEAVES = 6;
const TEXTURE_BUDGET = 10;

export function createReader(engine: Engine, opts: ReaderOptions = {}): Reader {
  const { ctx } = engine;
  const t = tunable(ctx.registry, {
    id: 'reader',
    label: 'Reader',
    kind: 'view',
    tags: ['animation', 'book', 'interaction'],
    describe: 'Opens a book toward the camera and turns its leaves.',
    source: 'src/engine/reader/reader.ts',
    params: {
      coverSeconds: { value: 0.98, min: 0.05, max: 5, unit: 's', help: 'Time for the front cover to swing open' },
      pageDelay: { value: 0.82, min: 0, max: 5, unit: 's', help: 'When the pages start to part, counted from the start of opening' },
      pageSeconds: { value: 0.9, min: 0.05, max: 5, unit: 's', help: 'Time for the pages to part to the reading place' },
      forward: { value: 0, min: 0, max: 60, help: 'How far the open book comes toward the camera. Measured: a featured book stays at its depth; 14 when opened from a spine row' },
      scale: { value: 1, min: 0.3, max: 3, help: 'Scale of the open book. Measured: 1 for a featured book; 1.1 when opened from a spine row' },
      pitch: { value: 22, min: 0, max: 80, unit: 'deg', help: 'How far the open book leans back' },
      pitchUp: { value: 10, min: 0, max: 40, unit: 'deg', help: 'Extra pitch with the pointer at the top' },
      pitchDown: { value: 12, min: 0, max: 40, unit: 'deg' },
      pitchRate: { value: 6, min: 0.1, max: 40, unit: '1/s' },
      lean: { value: 0.38, min: 0, max: 1.2, unit: 'rad', help: 'How far the open book turns toward the pointer side' },
      leanRate: { value: 7, min: 0.1, max: 40, unit: '1/s' },
      pageHeight: { value: 1536, min: 256, max: 4096, help: 'Height of a painted page in pixels' },
    },
    onChange: () => ctx.invalidate(),
  });
  const leafTune = tunable(ctx.registry, {
    id: 'reader.leaf',
    label: 'Turning leaf',
    kind: 'animation',
    tags: ['animation', 'paper', 'physics'],
    describe: 'How a released leaf accelerates, cruises and lands.',
    source: 'src/engine/reader/leaf-physics.ts',
    params: {
      accel: { value: LEAF_DEFAULT.accel, min: 0.0005, max: 0.1, help: 'Push toward the target per 60 Hz frame' },
      damping: { value: LEAF_DEFAULT.damping, min: 0.005, max: 0.9, help: 'Speed lost per 60 Hz frame while cruising' },
      landing: { value: LEAF_DEFAULT.landing, min: 0, max: 0.95, help: 'Extra speed lost at the landing' },
      landingZone: { value: LEAF_DEFAULT.landingZone, min: 0.02, max: 1, help: 'Share of the turn where the landing brake acts' },
      follow: { value: LEAF_DEFAULT.follow, min: 0.001, max: 0.95, help: 'How far the drawn leaf trails the simulated one' },
      settle: { value: LEAF_DEFAULT.settle, min: 0, max: 0.05, help: 'Steady pull that brings the leaf down at the end' },
      kick: { value: LEAF_DEFAULT.kick, min: 0, max: 0.3, help: 'Starting speed of a button-triggered turn, radians per 60 Hz frame' },
    },
  });

  let book: Book | null = null;
  let source: PageSource = () => ({ folio: null, left: true });
  /** Leaves lying on the left. The spread shows pages 2 x spread and 2 x spread + 1. */
  let spread = 0;
  let cover = 0;
  let pages = 0;
  let opening = false;
  let elapsed = 0;
  let coverFrom = 0;
  let pagesFrom = 0;
  let release: (() => void) | null = null;
  let leaves: Leaf[] = [];
  let blank: Texture | null = null;
  const cache = new Map<number, Texture>();
  const pitch = { v: 0 };
  const lean = { v: 0 };
  const q = new Quaternion();
  const goalPos = new Vector3();
  const e = new Euler();

  const texture = (page: number): Texture => {
    if (!book) throw new Error('casebound: reader has no book');
    if (page < 1 || page > book.dims.leaves * 2) return blank!;
    const hit = cache.get(page);
    if (hit) {
      cache.delete(page);
      cache.set(page, hit);
      return hit;
    }
    const tex = book.paintPage(source(page), t.pageHeight);
    cache.set(page, tex);
    return tex;
  };

  /** Frees painted pages that are far from the spread. */
  const trim = (): void => {
    const keep = new Set<number>();
    for (let p = spread * 2 - 3; p <= spread * 2 + 4; p++) keep.add(p);
    for (const [page, tex] of cache) {
      if (cache.size <= TEXTURE_BUDGET) break;
      if (keep.has(page)) continue;
      tex.dispose();
      cache.delete(page);
    }
  };

  /** Shows the right pages on the two blocks, allowing for leaves that are in the air. */
  const paintSpread = (): void => {
    if (!book) return;
    let left = spread;
    let right = spread;
    for (const leaf of leaves) {
      if (!leaf.active) continue;
      // A leaf in the air came from one stack and has not reached the other.
      left = Math.min(left, leaf.index);
      right = Math.max(right, leaf.index + 1);
    }
    book.setPage('left', texture(left * 2));
    book.setPage('right', texture(right * 2 + 1));
    trim();
    ctx.invalidate();
  };

  const emitView = (): void => {
    ctx.events.emit('view', book && (opening || cover > 0) ? { view: 'reader', slug: book.record.slug, page: Math.max(1, spread * 2) } : { view: 'shelf', slug: null, page: null });
  };

  const launch = (direction: 1 | -1): boolean => {
    if (!book || !opening || pages < 0.9) return false;
    const leafIndex = direction === 1 ? spread : spread - 1;
    if (leafIndex < 0 || leafIndex >= book.dims.leaves) return false;
    // Take a free leaf, or the one that has all but landed.
    let leaf = leaves.find((l) => !l.active);
    if (!leaf) {
      const near = (l: Leaf): number => Math.abs((l.motion.target ?? 1) * Math.PI - l.motion.angle);
      leaf = leaves.reduce((a, b) => (near(a) <= near(b) ? a : b));
      if (near(leaf) > 0.6) return false;
      leaf.active = false;
    }
    leaf.active = true;
    leaf.index = leafIndex;
    leaf.motion.angle = leaf.motion.shown = direction === 1 ? 0 : Math.PI;
    leaf.motion.velocity = 0;
    leaf.setPages(texture(leafIndex * 2 + 1), texture(leafIndex * 2 + 2));
    sendLeaf(leaf.motion, direction === 1 ? 1 : 0, leafTune.kick);
    leaf.mesh.visible = true;
    spread += direction;
    paintSpread();
    ctx.events.emit('page-turn', { slug: book.record.slug, leaf: leafIndex, direction });
    emitView();
    return true;
  };

  const reader: Reader = {
    get isOpen() {
      return opening;
    },
    get openness() {
      return cover;
    },
    get book() {
      return book;
    },
    get page() {
      return spread * 2;
    },
    get pageCount() {
      return book ? book.dims.leaves * 2 : 0;
    },
    open: (slug, page) => {
      const next = engine.book(slug);
      if (!next) throw new Error(`casebound: cannot open "${slug}": no such book. Loaded: ${engine.books.map((b) => b.record.slug).join(', ')}`);
      if (book && book !== next) finish();
      if (book !== next) {
        book = next;
        source = opts.pages?.(next) ?? paginate(next.record, next.dims.leaves * 2);
        blank = next.paintPage({ folio: null, left: true }, 64);
        leaves = Array.from({ length: LIVE_LEAVES }, () => new Leaf(next, engine.fx, blank!));
        spread = clamp(Math.round((page ?? Math.round(next.dims.leaves * 0.42) * 2) / 2), 0, next.dims.leaves);
        next.held = true;
      }
      opening = true;
      elapsed = 0;
      coverFrom = cover;
      pagesFrom = pages;
      release ??= ctx.lease('reader');
      engine.state.active = engine.books.indexOf(next);
      paintSpread();
      emitView();
    },
    close: () => {
      if (!book || !opening) return;
      opening = false;
      elapsed = 0;
      coverFrom = cover;
      pagesFrom = pages;
      emitView();
    },
    next: () => launch(1),
    previous: () => launch(-1),
    goTo: (page) => {
      if (!book) return;
      spread = clamp(Math.round(page / 2), 0, book.dims.leaves);
      for (const leaf of leaves) {
        leaf.active = false;
        leaf.mesh.visible = false;
      }
      paintSpread();
      emitView();
    },
    dispose: () => {
      finish();
      unsub();
      ctx.registry.remove('reader');
      ctx.registry.remove('reader.leaf');
    },
  };

  function finish(): void {
    if (!book) return;
    for (const leaf of leaves) leaf.dispose();
    leaves = [];
    for (const tex of cache.values()) tex.dispose();
    cache.clear();
    blank?.dispose();
    blank = null;
    book.held = false;
    book.lean = 0;
    book.setOpen(0, 0.5, 1);
    book = null;
    cover = 0;
    pages = 0;
    engine.state.inside = 0;
    release?.();
    release = null;
    emitView();
  }

  const unsub = ctx.onFrame('reader', (f) => {
    if (!book) return;
    elapsed += f.dt;
    const k = ctx.still ? 1 : clamp(elapsed / t.coverSeconds, 0, 1);
    cover = opening ? lerp(coverFrom, 1, k * k) : lerp(coverFrom, 0, easeOutCubic(k));
    if (opening) {
      const pk = ctx.still ? 1 : clamp((elapsed - t.pageDelay) / t.pageSeconds, 0, 1);
      pages = Math.max(pagesFrom, powerSigmoid(pk));
    } else {
      const pk = ctx.still ? 1 : clamp(elapsed / t.pageSeconds, 0, 1);
      pages = lerp(pagesFrom, 0, easeOutCubic(pk));
    }
    if (!opening && k >= 1) {
      finish();
      ctx.invalidate();
      return;
    }
    engine.state.inside = cover;

    // Leaves in the air.
    for (const leaf of leaves) {
      if (!leaf.active) continue;
      stepLeaf(leaf.motion, f.dt, { ...LEAF_DEFAULT, ...leafTune });
      if (leaf.motion.resting || ctx.still) {
        leaf.active = false;
        leaf.mesh.visible = false;
        paintSpread();
      }
    }

    // Lean toward the pointer, pitch with its height.
    const px = ctx.pointer?.x ?? 0;
    const py = ctx.pointer?.y ?? 0;
    lean.v = ctx.still ? 0 : approach(lean.v, -px * t.lean, t.leanRate, f.dt);
    pitch.v = ctx.still ? 0 : approach(pitch.v, py > 0 ? py * t.pitchUp : py * t.pitchDown, t.pitchRate, f.dt);
    book.lean = lean.v;
    book.setOpen(cover, book.dims.leaves ? spread / book.dims.leaves : 0.5, pages);
    for (const leaf of leaves) if (leaf.active) leaf.update();

    // From where the shelf keeps the book to the reading position.
    const offset = opts.centreOffsetPx?.() ?? { x: 0, y: 0 };
    const home = book.home;
    const z = home.position.z + t.forward;
    const worldPerPx = ctx.visibleHeightAt(z) / Math.max(1, ctx.size.y);
    goalPos.set(ctx.camera.position.x + offset.x * worldPerPx, ctx.camera.position.y - offset.y * worldPerPx, z);
    const blend = cover * cover * (3 - 2 * cover);
    book.root.position.copy(home.position).lerp(goalPos, blend);
    q.setFromEuler(e.set(-(t.pitch - pitch.v) * DEG, 0, 0));
    book.root.quaternion.copy(home.quaternion).slerp(q, blend);
    book.root.scale.setScalar(lerp(home.scale, home.scale * t.scale * (opts.fit?.() ?? 1), blend));
    book.tilt.rotation.set(0, 0, 0);
  });

  return reader;
}
