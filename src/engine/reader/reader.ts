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
import { flowPages } from '../book/painter';
import { paginate, type PageSource } from './pages';

export interface ReaderOptions {
  /** Custom page content per book. Default: the record's text, paginated. */
  pages?: (book: Book) => PageSource | undefined;
  /** Offset of the open book from the canvas centre, in CSS pixels. */
  centreOffsetPx?: () => { x: number; y: number };
  /** Extra scale for the open book, for layouts where it shares the screen. Default 1. */
  fit?: () => number;
  /** A press that starts inside an element matching this selector never grabs a page. */
  ignore?: string;
}

export interface Reader {
  readonly isOpen: boolean;
  /** 0 = closed, 1 = fully open. */
  readonly openness: number;
  readonly book: Book | null;
  /** How far the pages have parted, 0..1. Pages can be turned from 0.9. */
  readonly parted: number;
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
      openDelay: { value: 0.65, min: 0, max: 3, unit: 's', help: 'Pause between the request and the cover starting to move. Measured: 0.65' },
      coverSeconds: { value: 0.98, min: 0.05, max: 5, unit: 's', help: 'Time for the front cover to swing open' },
      pageDelay: { value: 0.693, min: 0, max: 5, unit: 's', help: 'When the pages start to part, counted from the cover starting to move. Measured: the moment the cover is half way' },
      pageSeconds: { value: 0.9, min: 0.05, max: 5, unit: 's', help: 'Time for the pages to part to the reading place' },
      forward: { value: 0, min: 0, max: 60, help: 'How far the open book comes toward the camera. Measured: a featured book stays at its depth; 14 when opened from a spine row' },
      scale: { value: 1, min: 0.3, max: 3, help: 'Scale of the open book. Measured: 1 for a featured book; 1.1 when opened from a spine row' },
      rise: { value: 0.524, min: -10, max: 10, help: 'How far above the centre of the picture the spine of the open book sits' },
      pitch: { value: 22, min: 0, max: 80, unit: 'deg', help: 'How far the open book leans back' },
      pitchUp: { value: 10, min: 0, max: 40, unit: 'deg', help: 'Extra pitch with the pointer at the top' },
      pitchDown: { value: 12, min: 0, max: 40, unit: 'deg' },
      pitchRate: { value: 6, min: 0.1, max: 40, unit: '1/s' },
      lean: { value: 0.38, min: 0, max: 1.2, unit: 'rad', help: 'How far the open book turns toward the pointer side' },
      leanRate: { value: 7, min: 0.1, max: 40, unit: '1/s' },
      pageHeight: { value: 1536, min: 256, max: 4096, help: 'Height of a painted page in pixels' },
      dragWidth: { value: 0.73, min: 0.2, max: 3, help: 'Share of the window width a pointer travels to pull a leaf all the way over' },
      dragFollow: { value: 0.4, min: 0.01, max: 0.95, help: 'How far a held leaf lags the hand: remaining share per 60 Hz frame' },
      tapPx: { value: 5, min: 0, max: 40, unit: 'px', help: 'Pointer travel below which a press counts as a tap' },
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
  /** Pause before this opening starts to move. None when a closing book is opened again. */
  let delay = 0;
  let settled = false;
  const tiltFrom = new Quaternion();
  const upright = new Quaternion();
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

  // ---------------------------------------------------------------- leaves in the air
  // `spread` counts the leaves that lie on the left or are on their way there. Every leaf in the air knows
  // which stack it is counted on (`side`), so the count only moves when a leaf is sent the other way.

  /** Puts a leaf back into the pool. */
  const retire = (leaf: Leaf): void => {
    leaf.active = false;
    leaf.dragTarget = null;
    leaf.mesh.visible = false;
  };

  /** The leaf in the air that is outermost on a stack (0 = right, 1 = left): the one a hand or a key reaches first. */
  const outer = (side: 0 | 1): Leaf | undefined => leaves.find((l) => l.active && l.side === side && l.index === (side === 1 ? spread - 1 : spread));

  /** Lifts the top leaf off a stack: 1 = off the right stack, -1 = off the left. It stays counted where it was. */
  const take = (direction: 1 | -1): Leaf | null => {
    if (!book || !opening || pages < 0.9) return null;
    let leaf = leaves.find((l) => !l.active);
    if (!leaf) {
      // None free: take the one that has all but landed. A held leaf is never taken away.
      const near = (l: Leaf): number => (l.dragTarget !== null ? 9 : Math.abs(l.side * Math.PI - l.motion.angle));
      leaf = leaves.reduce((a, b) => (near(a) <= near(b) ? a : b));
      if (near(leaf) > 0.6) return null;
      retire(leaf);
    }
    const index = direction === 1 ? spread : spread - 1;
    if (index < 0 || index >= book.dims.leaves) return null;
    leaf.active = true;
    leaf.index = index;
    leaf.side = direction === 1 ? 0 : 1;
    leaf.dragTarget = null;
    leaf.motion.angle = leaf.motion.shown = leaf.side * Math.PI;
    leaf.motion.velocity = 0;
    leaf.motion.target = leaf.side;
    leaf.motion.resting = false;
    leaf.setPages(texture(index * 2 + 1), texture(index * 2 + 2));
    leaf.mesh.visible = true;
    paintSpread();
    return leaf;
  };

  /** Sends a leaf to a side and moves the page count with it. */
  const aim = (leaf: Leaf, side: 0 | 1, kick: number): void => {
    if (leaf.side !== side) {
      spread += side === 1 ? 1 : -1;
      leaf.side = side;
      if (book) ctx.events.emit('page-turn', { slug: book.record.slug, leaf: leaf.index, direction: side === 1 ? 1 : -1 });
    }
    sendLeaf(leaf.motion, side, kick);
    paintSpread();
    emitView();
  };

  /** Turns one page: 1 = forward, -1 = back. A leaf that is still in the air on that side is sent back instead of a new one. */
  const launch = (direction: 1 | -1): boolean => {
    const from: 0 | 1 = direction === 1 ? 0 : 1;
    const flying = outer(from);
    if (flying && flying.dragTarget !== null) return false;
    const leaf = flying ?? take(direction);
    if (!leaf) return false;
    aim(leaf, direction === 1 ? 1 : 0, leafTune.kick);
    return true;
  };

  // ---------------------------------------------------------------- turning a page by hand (SPEC S-RD-10)
  let drag: { leaf: Leaf; id: number; startX: number; startAngle: number; remembered: 0 | 1; half: 1 | -1; travel: number; dx: number } | null = null;
  const centre = new Vector3();
  const ignore = opts.ignore ?? 'button, a, input, select, textarea, label, aside, header, footer, nav, [role="toolbar"], [role="dialog"]';

  /** Which half of the spread lies under a point of the window: 1 = right, -1 = left, 0 = neither. */
  const halfAt = (x: number, y: number): 1 | -1 | 0 => {
    if (!book || !opening || pages < 0.9) return 0;
    book.root.getWorldPosition(centre);
    const perWorld = ctx.size.y / ctx.visibleHeightAt(centre.z);
    centre.project(ctx.camera);
    const rect = ctx.canvas.getBoundingClientRect();
    const dx = x - (rect.left + (centre.x * 0.5 + 0.5) * rect.width);
    const dy = y - (rect.top + (0.5 - centre.y * 0.5) * rect.height);
    const scale = book.root.scale.x * perWorld;
    if (Math.abs(dx) > book.dims.pageW * scale * 1.06 || Math.abs(dy) > book.dims.pageH * scale * 0.56) return 0;
    return dx >= 0 ? 1 : -1;
  };

  /** How far a pull of `px` pixels turns the leaf, 0..1: a quick start, then in step with the hand. */
  const pull = (px: number): number => Math.min(1, 0.08 * (1 - Math.exp(-px / 12)) + (0.92 * px) / Math.max(1, window.innerWidth * t.dragWidth * (ctx.compact ? 2 : 1)));

  const onDown = (ev: PointerEvent): void => {
    if (drag || ev.button !== 0 || !ev.isPrimary) return;
    if (ev.target instanceof Element && ev.target.closest(ignore)) return;
    const half = halfAt(ev.clientX, ev.clientY);
    if (!half) return;
    // Catch a leaf that is in the air over this half, whichever way it was going. Otherwise lift the top one.
    const near: 0 | 1 = half === 1 ? 0 : 1;
    const far = outer(near === 1 ? 0 : 1);
    const over = far && (half === 1 ? far.motion.angle < Math.PI / 2 : far.motion.angle > Math.PI / 2) ? far : undefined;
    const leaf = outer(near) ?? over ?? take(half);
    if (!leaf || leaf.dragTarget !== null) return;
    drag = { leaf, id: ev.pointerId, startX: ev.clientX, startAngle: leaf.motion.angle, remembered: leaf.side, half, travel: 0, dx: 0 };
    leaf.dragTarget = leaf.motion.angle;
    leaf.motion.resting = false;
    document.documentElement.style.cursor = 'grabbing';
    ev.preventDefault();
    ctx.invalidate();
  };

  const onMove = (ev: PointerEvent): void => {
    if (!drag) {
      if (opening && ev.pointerType === 'mouse') {
        const over = !(ev.target instanceof Element && ev.target.closest(ignore)) && halfAt(ev.clientX, ev.clientY) !== 0;
        document.documentElement.style.cursor = over ? 'grab' : '';
      }
      return;
    }
    if (ev.pointerId !== drag.id) return;
    drag.dx = ev.clientX - drag.startX;
    drag.travel = Math.max(drag.travel, Math.abs(drag.dx));
    // Pulling to the left raises the angle, which turns the leaf forward.
    drag.leaf.dragTarget = clamp(drag.startAngle - Math.sign(drag.dx) * Math.PI * pull(Math.abs(drag.dx)), 0, Math.PI);
    ctx.invalidate();
  };

  const onUp = (ev: PointerEvent): void => {
    if (!drag || ev.pointerId !== drag.id) return;
    const { leaf, travel, dx, startAngle, remembered, half } = drag;
    drag = null;
    document.documentElement.style.cursor = '';
    leaf.dragTarget = null;
    // Measured: a released leaf starts from rest, whatever speed the hand had.
    leaf.motion.velocity = 0;
    const wasLeft = startAngle > Math.PI / 2;
    if (travel < t.tapPx) {
      // A tap lets the leaf go where it was going, then turns one page like the button does.
      aim(leaf, remembered, 0);
      if (ev.type !== 'pointercancel') launch(half);
    } else if (Math.abs(dx) >= t.tapPx && (wasLeft ? dx > 0 : dx < 0)) {
      // Any pull that ends on the turning side turns the page, however far it got.
      aim(leaf, wasLeft ? 0 : 1, 0);
    } else {
      aim(leaf, wasLeft ? 1 : 0, 0);
    }
    ctx.invalidate();
  };

  window.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

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
    get parted() {
      return pages;
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
        source = opts.pages?.(next) ?? paginate(next.record, next.dims.leaves * 2, (paragraphs, heading) => flowPages(paragraphs, heading, next.dims.pageW / next.dims.pageH, next.faces));
        blank = next.paintPage({ folio: null, left: true }, 64);
        leaves = Array.from({ length: LIVE_LEAVES }, () => new Leaf(next, engine.fx, blank!));
        spread = clamp(Math.round((page ?? Math.round(next.dims.leaves * 0.42) * 2) / 2), 0, next.dims.leaves);
        next.held = true;
        tiltFrom.copy(next.tilt.quaternion);
      }
      opening = true;
      delay = cover > 1e-3 ? 0 : t.openDelay;
      settled = false;
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
        leaf.dragTarget = null;
        leaf.mesh.visible = false;
      }
      drag = null;
      paintSpread();
      emitView();
    },
    dispose: () => {
      finish();
      unsub();
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      ctx.registry.remove('reader');
      ctx.registry.remove('reader.leaf');
    },
  };

  function finish(): void {
    if (!book) return;
    for (const leaf of leaves) leaf.dispose();
    leaves = [];
    drag = null;
    document.documentElement.style.cursor = '';
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
    const moving = opening ? Math.max(0, elapsed - delay) : elapsed;
    const k = ctx.still ? 1 : clamp(moving / t.coverSeconds, 0, 1);
    cover = opening ? lerp(coverFrom, 1, k * k) : lerp(coverFrom, 0, easeOutCubic(k));
    if (opening) {
      const pk = ctx.still ? 1 : clamp((moving - t.pageDelay) / t.pageSeconds, 0, 1);
      pages = Math.max(pagesFrom, powerSigmoid(pk));
      if (!settled && pages >= 0.985) {
        settled = true;
        emitView();
      }
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
    const frames = 60 * Math.min(f.dt, 0.05);
    for (const leaf of leaves) {
      if (!leaf.active) continue;
      if (leaf.dragTarget !== null) {
        // Held: the leaf follows the hand with a little lag. Its speed only tells the sheet which way to bow.
        const m = leaf.motion;
        const before = m.angle;
        m.angle += (leaf.dragTarget - m.angle) * (1 - Math.pow(t.dragFollow, frames));
        m.velocity = (m.angle - before) / Math.max(1e-3, frames);
        m.shown += (m.angle - m.shown) * (1 - Math.pow(leafTune.follow, frames));
        continue;
      }
      stepLeaf(leaf.motion, f.dt, { ...LEAF_DEFAULT, ...leafTune });
      if (leaf.motion.resting || ctx.still) {
        leaf.motion.angle = leaf.motion.shown = leaf.side * Math.PI;
        retire(leaf);
        paintSpread();
        emitView();
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
    goalPos.set(offset.x * worldPerPx, ctx.camera.position.y - offset.y * worldPerPx + t.rise, z);
    // Measured: position and turn follow the cover's own progress, with no second easing on top.
    const blend = cover;
    book.root.position.copy(home.position).lerp(goalPos, blend);
    q.setFromEuler(e.set(-(t.pitch - pitch.v) * DEG, 0, 0));
    book.root.quaternion.copy(home.quaternion).slerp(q, blend);
    book.root.scale.setScalar(lerp(home.scale, home.scale * t.scale * (opts.fit?.() ?? 1), blend));
    // The lean toward the pointer that the book had on the shelf fades as the cover opens.
    book.tilt.quaternion.copy(tiltFrom).slerp(upright, blend);
  });

  return reader;
}
