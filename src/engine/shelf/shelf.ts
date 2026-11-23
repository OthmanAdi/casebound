/**
 * The shelf: featured books in a vertical stack, one per scroll slot. Scrolling moves the stack; each book
 * turns out of the way as it leaves and turns in as it arrives (SPEC sections 6 and 7).
 */
import { Euler, Quaternion, Vector3 } from 'three';
import type { Book } from '../book/book';
import type { Engine } from '../index';
import { DEG, approach, clamp, easeInOutQuad, frameFactor, lerp, smoothDamp } from '../core/math';
import { tunable } from '../core/tune';
import { SCROLL_COMPACT, SCROLL_DESKTOP, createBridge, createHaste, createScrollState, stepHaste, stepScroll, type ScrollState } from './scroll';
import { ROW_DEFAULT, choose, createRow, joinOf, placeAt, releaseRow, rowOrder, rowSettled, stepChoice, stepRow } from './row';
import { SPIN_DEFAULT, createSpin, dragSpin, grabSpin, releaseSpin, stepSpin, type SpinGrab } from './spin';

export interface ShelfOptions {
  /** Slugs of the featured books, top to bottom. Default: every book. */
  featured?: string[];
  /** Height of one scroll slot in CSS pixels. The site sets this to its panel pitch. */
  slotPx?: () => number;
  /** Scroll position source. Default: the window. */
  scrollY?: () => number;
  /** Where on the screen the centred book sits, as an offset from the canvas centre in CSS pixels. */
  centreOffsetPx?: () => { x: number; y: number };
  /** Replaces or adjusts the default stack. */
  layout?: ShelfLayout;
  /** A press that starts inside an element matching this selector never takes hold of a book. */
  ignore?: string;
  /** Extra scale for the books, for layouts where they share the screen. Default 1. */
  fit?: () => number;
  /**
   * Adds one scroll slot after the last featured book, where every loaded book stands in a row, spine to the
   * front. The chosen book turns its cover to the front.
   */
  row?: boolean;
}

/** The row of spines, when the shelf has one. */
export interface ShelfRow {
  /** True while the row stands and takes keys and presses. */
  readonly settled: boolean;
  /** Slug of the book that shows its cover. */
  readonly selected: string;
  /** Moves the choice by a number of books. False when nothing changed. */
  step(delta: number): boolean;
  select(slug: string): boolean;
}

/** What the shelf decided for one book this frame. A custom layout may change any of it. */
export interface ShelfPose {
  position: Vector3;
  /** Pose the book eases toward. */
  quaternion: Quaternion;
  scale: number;
  visible: boolean;
}

/**
 * A custom arrangement. Called for every book each frame with the default pose already filled in.
 * `offset` is the book's distance from the centre in slots: 0 centred, positive above, negative below.
 */
export type ShelfLayout = (book: { slot: number; offset: number; count: number; slug: string }, pose: ShelfPose) => void;

export interface Shelf {
  readonly state: ScrollState;
  /** Books in shelf order. */
  readonly order: number[];
  /** False while a view such as the reader owns the books. */
  enabled: boolean;
  /** The row of spines, or null when the shelf was made without one. */
  readonly row: ShelfRow | null;
  /** Plays the arrival of the first book again. */
  intro(): void;
  dispose(): void;
}

const euler = (x: number, y: number, z: number): Quaternion => new Quaternion().setFromEuler(new Euler(x * DEG, y * DEG, z * DEG, 'XYZ'));

export function createShelf(engine: Engine, opts: ShelfOptions = {}): Shelf {
  const { ctx } = engine;
  const order = (opts.featured ?? engine.books.map((b) => b.record.slug)).map((slug) => {
    const i = engine.books.findIndex((b) => b.record.slug === slug);
    if (i < 0) throw new Error(`casebound: shelf lists "${slug}", which is not a loaded book`);
    return i;
  });

  const t = tunable(ctx.registry, {
    id: 'shelf.featured',
    label: 'Featured stack',
    kind: 'layout',
    tags: ['layout', 'animation', 'book'],
    describe: 'One book per scroll slot. Books ride up with the scroll and turn as they leave and arrive.',
    source: 'src/engine/shelf/shelf.ts',
    params: {
      pitch: { value: 24, min: 4, max: 80, help: 'World distance between neighbouring books' },
      planeZ: { value: -36, min: -120, max: 20, help: 'Depth of the shelf plane' },
      baseY: { value: -0.869, min: -30, max: 30, help: 'Height of the centred book before the centre offset. Measured: the book rests at -3.0553 with the picture centred 69 px below the window centre' },
      restX: { value: -28, min: -180, max: 180, unit: 'deg' },
      restY: { value: 32, min: -180, max: 180, unit: 'deg' },
      restZ: { value: 12, min: -180, max: 180, unit: 'deg' },
      leaveX: { value: -75, min: -180, max: 180, unit: 'deg', help: 'Pose a book turns to while leaving upward' },
      leaveZ: { value: 90, min: -180, max: 180, unit: 'deg' },
      arriveX: { value: -155, min: -180, max: 180, unit: 'deg', help: 'Pose a book arrives from below in' },
      arriveZ: { value: 90, min: -180, max: 180, unit: 'deg' },
      turnStart: { value: 0.1, min: 0, max: 1, help: 'Distance from centre, in slots, where the turn begins' },
      turnEndArrive: { value: 0.8, min: 0.2, max: 3 },
      turnEndLeave: { value: 1.2, min: 0.2, max: 3 },
      turnFollow: { value: 0.165, min: 0.01, max: 1, help: 'Fraction of the way to the target pose per 60 Hz frame' },
      turnHaste: { value: 0.5, min: 0, max: 3, help: 'How much faster the turn follows while the page scrolls fast (above 2.5 window heights per second) and for 0.6 s after. Measured: 0.5' },
      exitFrom: { value: 0.6, min: 0, max: 2, help: 'Distance past centre where a leaving book speeds away' },
      exitBoost: { value: 2.25, min: 0, max: 8 },
      visible: { value: 1.8, min: 0.5, max: 6, help: 'Books further than this many slots from centre are hidden' },
      tiltYaw: { value: 0.16, min: 0, max: 1, unit: 'rad', help: 'Yaw toward the pointer at the screen edge' },
      tiltPitch: { value: 0.1, min: 0, max: 1, unit: 'rad' },
      tiltRate: { value: 4, min: 0.1, max: 40, unit: '1/s' },
      compactScale: { value: 0.77, min: 0.2, max: 1.5, help: 'Book scale under 900 px wide' },
      introSeconds: { value: 2, min: 0, max: 10 },
    },
    onChange: () => ctx.invalidate(),
  });

  const spinTune = tunable(ctx.registry, {
    id: 'shelf.spin',
    label: 'Turning a book by hand',
    kind: 'interaction',
    tags: ['interaction', 'animation', 'book'],
    describe: 'Drag the centred book to turn it. It coasts on, and its trailing cover lifts while it turns.',
    source: 'src/engine/shelf/spin.ts',
    params: {
      gain: { value: SPIN_DEFAULT.gain, min: 0, max: 0.05, unit: 'rad/px', help: 'Turn per pixel of mouse travel' },
      touchGain: { value: SPIN_DEFAULT.touchGain, min: 0, max: 0.05, unit: 'rad/px' },
      inertiaCap: { value: SPIN_DEFAULT.inertiaCap, min: 0, max: 2, help: 'Largest coasting step, radians per 60 Hz frame' },
      friction: { value: SPIN_DEFAULT.friction, min: 0.5, max: 0.999, help: 'Share of the coasting speed kept per 60 Hz frame' },
      stiffness: { value: SPIN_DEFAULT.stiffness, min: 10, max: 4000, help: 'Spring between the hand and the drawn book' },
      damping: { value: SPIN_DEFAULT.damping, min: 1, max: 200 },
      flap: { value: SPIN_DEFAULT.flap, min: 0, max: 0.5, help: 'Cover lift per radian per second of turning. 0 keeps the covers shut' },
      flapLimit: { value: SPIN_DEFAULT.flapLimit, min: 0, max: 1.4, unit: 'rad' },
      flapRate: { value: SPIN_DEFAULT.flapRate, min: 1, max: 200, unit: '1/s' },
      coverMax: { value: SPIN_DEFAULT.coverMax, min: 0, max: 1.6, unit: 'rad' },
      levelDelay: { value: SPIN_DEFAULT.levelDelay, min: 0, max: 20, unit: 's', help: 'Wait before a book left upside down turns level again' },
      levelSeconds: { value: SPIN_DEFAULT.levelSeconds, min: 0.1, max: 20, unit: 's' },
      dragPx: { value: 5, min: 0, max: 40, unit: 'px', help: 'Pointer travel before a press counts as a drag' },
      unwind: { value: 5, min: 0.1, max: 40, unit: '1/s', help: 'How fast a book that leaves the centre forgets its turn' },
      peek: { value: 5, min: 0, max: 40, unit: 'deg', help: 'How far the front cover lifts while the pointer rests on the book. Measured: 5' },
      peekFollow: { value: 0.075, min: 0.005, max: 1, help: 'Share of the way the cover moves per 60 Hz frame' },
    },
    onChange: () => ctx.invalidate(),
  });

  const rowTune = opts.row
    ? tunable(ctx.registry, {
        id: 'shelf.row',
        label: 'Row of spines',
        kind: 'layout',
        tags: ['layout', 'animation', 'book', 'interaction'],
        describe: 'Past the last featured book every book stands side by side, spine to the front. The chosen one turns its cover to the front.',
        source: 'src/engine/shelf/row.ts',
        params: {
          gap: { value: ROW_DEFAULT.gap, min: 0, max: 6, help: 'Air between two spines' },
          slot: { value: ROW_DEFAULT.slot, min: 2, max: 40, help: 'Width a book takes when its cover faces the front' },
          spine: { value: ROW_DEFAULT.spine, min: 0.2, max: 2, help: 'Spine width as a share of the thickness' },
          depth: { value: ROW_DEFAULT.depth, min: 0, max: 80, help: 'How far behind the shelf plane the row stands' },
          forward: { value: ROW_DEFAULT.forward, min: 0, max: 30, help: 'How far the chosen book comes forward' },
          back: { value: ROW_DEFAULT.back, min: 0, max: 30, help: 'How far the other books step back' },
          yawPower: { value: ROW_DEFAULT.yawPower, min: 0.2, max: 5 },
          yawTime: { value: ROW_DEFAULT.yawTime, min: 0.01, max: 3, unit: 's', help: 'Time for a book to turn when the choice changes' },
          offsetTime: { value: ROW_DEFAULT.offsetTime, min: 0.01, max: 3, unit: 's', help: 'Time for the row to slide the chosen book to the middle' },
          span: { value: ROW_DEFAULT.span, min: 0.1, max: 1, help: 'Share of the last scroll slot after which the row is fully called for' },
          assembleAt: { value: ROW_DEFAULT.assembleAt, min: 0.01, max: 1 },
          releaseAt: { value: ROW_DEFAULT.releaseAt, min: 0, max: 1 },
          leaveAt: { value: ROW_DEFAULT.leaveAt, min: 0.2, max: 1, help: 'A row that stood fully starts to sink below this value of the eased scroll' },
          farDrop: { value: ROW_DEFAULT.farDrop, min: 0, max: 10, help: 'How much deeper the far books start than the near ones' },
          anchorYawTime: { value: ROW_DEFAULT.anchorYawTime, min: 0.01, max: 3, unit: 's', help: 'Time for the last featured book to turn its cover' },
          gateTime: { value: ROW_DEFAULT.gateTime, min: 0.01, max: 3, unit: 's' },
          assembleTime: { value: ROW_DEFAULT.assembleTime, min: 0.01, max: 3, unit: 's' },
          hoverPop: { value: ROW_DEFAULT.hoverPop, min: 0, max: 20, help: 'How far a spine under the pointer steps forward' },
          hoverRate: { value: ROW_DEFAULT.hoverRate, min: 0.5, max: 60, unit: '1/s' },
          stepPause: { value: ROW_DEFAULT.stepPause, min: 0, max: 2, unit: 's', help: 'Least time between two steps of the choice' },
          seat: { value: -0.064, min: -0.5, max: 0.5, help: 'How far below the middle of the picture the row stands, as a share of the picture height. Negative: above. Measured: the covers span 167 to 758 px of 900' },
        },
        onChange: () => ctx.invalidate(),
      })
    : null;
  // Every loaded book is in the row: the featured ones first, then the rest, then put in display order.
  const catalogue = [...order, ...engine.books.map((_, i) => i).filter((i) => !order.includes(i))];
  const display = rowTune ? rowOrder(catalogue.length, order.length - 1).map((i) => catalogue[i]!) : [];
  const anchor = display.indexOf(order[order.length - 1]!);
  const row = rowTune ? createRow(display.length, anchor) : null;
  const managed = row ? catalogue : order;
  let rowPast = 0;
  const rowPastVel = { v: 0 };
  let rowPastSeeded = false;
  let rowLive = false;
  let rowWidths: number[] = [];
  /** World units per CSS pixel at the depth of the row, for a hand that drags it. */
  let rowWorldPerPx = 0.03;
  let hoveredSpine = -1;
  /** The book that keys, presses and the reader act on: the centred featured book, or the chosen one in the row. */
  let focus = order[0]!;

  // Books the shelf does not place stay out of sight until another view takes them.
  for (const [i, book] of engine.books.entries()) if (!order.includes(i)) book.root.visible = false;

  const state = createScrollState();
  const haste = createHaste();
  const bridge = createBridge();
  /** Engine time of the last wheel event, milliseconds. */
  let wheelAt = -Infinity;
  const scrollY = opts.scrollY ?? ((): number => window.scrollY);
  const slotPx = opts.slotPx ?? ((): number => window.innerHeight);
  const qRest = new Quaternion();
  const qLeave = new Quaternion();
  const qArrive = new Quaternion();
  const pose: ShelfPose = { position: new Vector3(), quaternion: new Quaternion(), scale: 1, visible: true };
  const tilt = { yaw: 0, pitch: 0 };
  const qTilt = new Quaternion();
  const qTiltRow = new Quaternion();
  const qTiltMix = new Quaternion();
  const qUpright = new Quaternion();
  const rowAt = new Vector3();
  const qInverse = new Quaternion();
  const eTilt = new Euler();
  let introT = 0;
  let introActive = !ctx.still;
  let seeded = false;

  const shelf: Shelf = {
    state,
    order,
    enabled: true,
    row: row
      ? {
          get settled() {
            return rowLive;
          },
          get selected() {
            return engine.books[display[row.selected]!]!.record.slug;
          },
          step: (delta) => {
            const moved = stepChoice(row, delta, rowTune!);
            if (moved) ctx.invalidate();
            return moved;
          },
          select: (slug) => {
            const pos = display.findIndex((i) => engine.books[i]!.record.slug === slug);
            const moved = pos >= 0 && choose(row, pos);
            if (moved) ctx.invalidate();
            return moved;
          },
        }
      : null,
    intro: () => {
      introT = 0;
      introActive = !ctx.still;
      ctx.invalidate();
    },
    dispose: () => {
      unsub();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      ctx.registry.remove('shelf.featured');
      ctx.registry.remove('shelf.spin');
      if (row) ctx.registry.remove('shelf.row');
    },
  };

  const onScroll = (): void => ctx.invalidate();
  window.addEventListener('scroll', onScroll, { passive: true });
  const onWheel = (): void => {
    wheelAt = clock;
  };
  window.addEventListener('wheel', onWheel, { passive: true, capture: true });

  // ---------------------------------------------------------------- turning the centred book by hand
  const ignore = opts.ignore ?? 'button, a, input, select, textarea, label, aside, header, footer, nav, [role="toolbar"], [role="dialog"]';
  let spin = createSpin();
  let spun = -1;
  let press: { id: number; x: number; y: number; at: number; touch: boolean; grab: SpinGrab | null; trail: { t: number; x: number; y: number }[]; pick?: number; pull?: boolean } | null = null;
  /** The pointer rests on the centred book. */
  let hovering = false;
  let peek = 0;
  const centre = new Vector3();
  /** The engine's own time in milliseconds. The speed of the hand is taken on this clock, so a recording that steps the clock coasts like a live session. */
  let clock = 0;

  const centred = (): Book | null => (shelf.enabled ? (engine.books[focus] ?? null) : null);

  /** Position in the row of the book under a point of the window, or -1. */
  const spineAt = (x: number, y: number): number => {
    if (!row || !rowTune || !rowLive || !shelf.enabled) return -1;
    const rect = ctx.canvas.getBoundingClientRect();
    let best = -1;
    let nearest = Infinity;
    for (const [pos, i] of display.entries()) {
      const book = engine.books[i]!;
      if (!book.root.visible || book.held) continue;
      book.root.getWorldPosition(centre);
      const perWorld = ctx.size.y / ctx.visibleHeightAt(centre.z);
      centre.project(ctx.camera);
      const dx = Math.abs(x - (rect.left + (centre.x * 0.5 + 0.5) * rect.width));
      const dy = Math.abs(y - (rect.top + (0.5 - centre.y * 0.5) * rect.height));
      const scale = book.root.scale.x * perWorld;
      const half = (pos === row.selected ? book.dims.coverW * 0.6 : (book.dims.thickness * rowTune.spine + rowTune.gap) / 2) * scale;
      if (dx < half && dy < book.dims.coverH * scale * 0.55 && dx < nearest) {
        best = pos;
        nearest = dx;
      }
    }
    return best;
  };

  /** True when a point of the window lies on the centred book. */
  const onBook = (x: number, y: number): boolean => {
    const book = centred();
    if (!book || book.held || !book.root.visible) return false;
    book.root.getWorldPosition(centre);
    const perWorld = ctx.size.y / ctx.visibleHeightAt(centre.z);
    centre.project(ctx.camera);
    const rect = ctx.canvas.getBoundingClientRect();
    const dx = x - (rect.left + (centre.x * 0.5 + 0.5) * rect.width);
    const dy = y - (rect.top + (0.5 - centre.y * 0.5) * rect.height);
    const scale = book.root.scale.x * perWorld;
    return Math.abs(dx) < book.dims.coverW * scale * 0.6 && Math.abs(dy) < book.dims.coverH * scale * 0.55;
  };

  const onDown = (ev: PointerEvent): void => {
    if (press || ev.button !== 0 || !ev.isPrimary) return;
    if (ev.target instanceof Element && ev.target.closest(ignore)) return;
    const touch = ev.pointerType === 'touch';
    // In the row a press on another spine chooses that book.
    const spine = spineAt(ev.clientX, ev.clientY);
    if (row && spine >= 0 && spine !== row.selected) {
      press = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, at: clock, touch, grab: null, trail: [], pick: spine };
      if (!touch) ev.preventDefault();
      return;
    }
    if (!onBook(ev.clientX, ev.clientY)) return;
    press = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, at: clock, touch, grab: null, trail: [] };
    // A mouse press on the book must not start a text selection. A finger may still scroll the page.
    if (!touch) ev.preventDefault();
  };

  const onMove = (ev: PointerEvent): void => {
    if (!press) {
      if (ev.pointerType === 'mouse' && shelf.enabled) {
        const free = !(ev.target instanceof Element && ev.target.closest(ignore));
        const spine = free ? spineAt(ev.clientX, ev.clientY) : -1;
        const other = row !== null && spine >= 0 && spine !== row.selected;
        if (spine !== hoveredSpine) {
          hoveredSpine = spine;
          ctx.invalidate();
        }
        const over = free && !other && onBook(ev.clientX, ev.clientY);
        if (over !== hovering) {
          hovering = over;
          ctx.invalidate();
        }
        const cursor = other ? 'pointer' : over ? 'grab' : '';
        if (cursor || ['grab', 'pointer'].includes(document.documentElement.style.cursor)) document.documentElement.style.cursor = cursor;
      }
      return;
    }
    if (ev.pointerId !== press.id) return;
    const dx = ev.clientX - press.x;
    const dy = ev.clientY - press.y;
    if (press.pick !== undefined && row) {
      // A press on a spine that moves sideways drags the whole row.
      if (!press.pull) {
        if (Math.hypot(dx, dy) < spinTune.dragPx) return;
        if (press.touch && Math.abs(dy) > Math.abs(dx)) {
          press = null;
          return;
        }
        press.pull = true;
        row.dragging = true;
        document.documentElement.style.cursor = 'grabbing';
      }
      row.drag = dx * rowWorldPerPx;
      press.trail.push({ t: clock, x: ev.clientX, y: ev.clientY });
      while (press.trail.length > 2 && clock - press.trail[0]!.t > 100) press.trail.shift();
      ctx.invalidate();
      return;
    }
    if (!press.grab) {
      if (Math.hypot(dx, dy) < spinTune.dragPx) return;
      // A finger that moves mostly up or down is scrolling the page.
      if (press.touch && Math.abs(dy) > Math.abs(dx)) {
        press = null;
        return;
      }
      press.grab = grabSpin(spin, press.touch);
      document.documentElement.style.cursor = 'grabbing';
    }
    dragSpin(spin, press.grab, dx, dy, spinTune);
    press.trail.push({ t: clock, x: ev.clientX, y: ev.clientY });
    while (press.trail.length > 2 && clock - press.trail[0]!.t > 100) press.trail.shift();
    ctx.invalidate();
  };

  const onUp = (ev: PointerEvent): void => {
    if (!press || ev.pointerId !== press.id) return;
    const p = press;
    press = null;
    document.documentElement.style.cursor = '';
    if (p.pick !== undefined) {
      if (row && p.pull) {
        const first = p.trail[0];
        const last = p.trail[p.trail.length - 1];
        const fresh = ev.type === 'pointerup' && first && last && last.t > first.t && clock - last.t < 80;
        const speed = fresh ? (last.x - first.x) / (Math.max(1, last.t - first.t) / 1000) : 0;
        releaseRow(row, rowWidths, speed * rowWorldPerPx, Math.abs(speed) > 250, rowTune!);
      } else if (row && ev.type === 'pointerup') choose(row, p.pick);
      ctx.invalidate();
      return;
    }
    if (!p.grab) {
      const book = centred();
      if (ev.type === 'pointerup' && book && clock - p.at < 500) ctx.events.emit('book-click', { slug: book.record.slug });
      return;
    }
    // Speed of the hand over its last 100 ms. A hand that stopped before letting go gives none.
    const first = p.trail[0];
    const last = p.trail[p.trail.length - 1];
    let vx = 0;
    let vy = 0;
    if (ev.type === 'pointerup' && first && last && last.t > first.t && clock - last.t < 80) {
      const span = Math.max(1, last.t - first.t) / 1000;
      vx = (last.x - first.x) / span;
      vy = (last.y - first.y) / span;
    }
    releaseSpin(spin, p.grab, vx, vy, spinTune);
    ctx.invalidate();
  };

  window.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  const unsub = ctx.onFrame('layout', (f) => {
    clock = f.time * 1000;
    if (!shelf.enabled) return;
    const tuning = ctx.compact ? SCROLL_COMPACT : SCROLL_DESKTOP;
    let moving = stepScroll(state, scrollY(), slotPx(), order.length + (row ? 1 : 0), tuning, f.dt, ctx.still, { bridge, time: f.time, ago: (clock - wheelAt) / 1000 });
    const widths = row && rowTune ? display.map((i) => engine.books[i]!.dims.thickness * rowTune.spine) : [];
    if (row && rowTune) {
      rowWidths = widths;
      rowWorldPerPx = ctx.visibleHeightAt(t.planeZ - rowTune.depth) / Math.max(1, ctx.size.y);
      // Measured: the row reads the scroll in a straight line from the last featured book to its own place, lightly
      // damped. The dwell that holds a featured book at the centre is not part of it.
      const rawPast = clamp(scrollY() / Math.max(1, slotPx()) - (order.length - 1), 0, 1);
      rowPast = !rowPastSeeded || ctx.still ? rawPast : smoothDamp(rowPast, rawPast, rowPastVel, 0.063, clamp(f.dt, 1 / 240, 1 / 30));
      rowPastSeeded = true;
      if (Math.abs(rowPast - rawPast) > 1e-4) moving = true;
      if (stepRow(row, widths, rowPast, hoveredSpine, f.dt, rowTune, ctx.still)) moving = true;
      rowLive = rowSettled(row, rowPast, rowTune);
    }

    qRest.copy(euler(t.restX, t.restY, t.restZ));
    qLeave.copy(euler(t.leaveX, 0, t.leaveZ));
    qArrive.copy(euler(t.arriveX, 0, t.arriveZ));

    // Intro: the stack starts one slot low and eases up.
    let introDrop = 0;
    if (introActive) {
      introT += f.dt;
      const k = t.introSeconds <= 0 ? 1 : clamp(introT / t.introSeconds, 0, 1);
      introDrop = 1 - easeInOutQuad(k);
      if (k >= 1) introActive = false;
      moving = true;
    }

    // Pointer tilt, shared by every visible book.
    const goalYaw = ctx.pointer && !ctx.compact ? t.tiltYaw * ctx.pointer.x : 0;
    const goalPitch = ctx.pointer && !ctx.compact ? -t.tiltPitch * ctx.pointer.y : 0;
    const beforeTilt = tilt.yaw + tilt.pitch;
    tilt.yaw = ctx.still ? goalYaw : approach(tilt.yaw, goalYaw, t.tiltRate, f.dt);
    tilt.pitch = ctx.still ? goalPitch : approach(tilt.pitch, goalPitch, t.tiltRate, f.dt);
    if (Math.abs(tilt.yaw + tilt.pitch - beforeTilt) > 1e-6) moving = true;
    qTilt.setFromEuler(eTilt.set(tilt.pitch, tilt.yaw, 0, 'YXZ'));
    // Measured: in the row the books follow the pointer a quarter as far.
    qTiltRow.setFromEuler(eTilt.set(tilt.pitch * 0.25, tilt.yaw * 0.25, 0, 'YXZ'));

    const offset = opts.centreOffsetPx?.() ?? { x: 0, y: 0 };
    const worldPerPx = ctx.visibleHeightAt(t.planeZ) / Math.max(1, ctx.size.y);
    // A book never grows wider than the screen: on a narrow one it shrinks to fit, with a little air.
    const wide = (engine.books[order[0]!]?.dims.coverW ?? 15) * 1.16 / worldPerPx;
    const scale = Math.min(ctx.compact ? t.compactScale : 1, (ctx.size.x * 0.9) / wide) * (opts.fit?.() ?? 1);
    const hurry = stepHaste(haste, scrollY(), ctx.size.y, f.dt);
    const follow = !seeded || ctx.still ? 1 : frameFactor(Math.min(1, t.turnFollow * (1 + t.turnHaste * hurry)), f.dt);

    /** Writes where a book of the row stands into `rowAt` and returns how far its cover is turned to the front. */
    const rowPlace = (pos: number, blend = 1): number => {
      const place = placeAt(row!, widths, pos, rowTune!, blend);
      const z = t.planeZ - rowTune!.depth * blend;
      const perPx = ctx.visibleHeightAt(z) / Math.max(1, ctx.size.y);
      const seatY = ctx.camera.position.y - (offset.y + rowTune!.seat * ctx.size.y) * perPx;
      const below = seatY - ctx.visibleHeightAt(z) * 0.95;
      rowAt.set(offset.x * perPx + place.x * scale, lerp(below, seatY, place.rise), z + place.z * scale);
      return place.turn;
    };
    for (const i of order) engine.books[i]!.presentYaw = Math.PI / 2;

    for (const [slot, index] of order.entries()) {
      const book = engine.books[index]!;
      // Measured: the last featured book waits for the row where it is; it does not ride up with the scroll.
      const b = row && slot === order.length - 1 ? Math.min(0, state.progress - slot - introDrop) : state.progress - slot - introDrop;
      let y = b * t.pitch + t.baseY - offset.y * worldPerPx;
      if (b > t.exitFrom) y += Math.pow((b - t.exitFrom) / 0.4, 3) * t.pitch * t.exitBoost;
      const end = b > 0 ? t.turnEndLeave : t.turnEndArrive;
      const amount = easeInOutQuad(clamp((Math.abs(b) - t.turnStart) / Math.max(1e-3, end - t.turnStart), 0, 1));
      pose.position.set(offset.x * worldPerPx, y, t.planeZ);
      pose.quaternion.copy(qRest).slerp(b > 0 ? qLeave : qArrive, amount);
      pose.scale = scale;
      pose.visible = Math.abs(b) < t.visible;
      opts.layout?.({ slot, offset: b, count: order.length, slug: book.record.slug }, pose);
      if (row && rowTune && slot === order.length - 1) {
        // The last featured book is where the row grows from: it moves from its featured pose into its place.
        const join = joinOf(row, rowPast, rowTune);
        if (join > 0) {
          const turn = rowPlace(anchor, join);
          // The depth already carries the join; height and side follow it in a straight line.
          pose.position.set(lerp(pose.position.x, rowAt.x, join), lerp(pose.position.y, rowAt.y, join), rowAt.z);
          pose.quaternion.slerp(qUpright, join);
          // Spine to the front is half a turn; the cover to the front a quarter.
          book.presentYaw = lerp(Math.PI / 2, Math.PI - (Math.PI / 2) * turn, join);
          pose.visible = true;
        }
      }

      book.root.visible = pose.visible || book.held;
      if (!book.root.visible) continue;
      book.home.position.copy(pose.position);
      book.home.scale = pose.scale;
      if (book.home.quaternion.angleTo(pose.quaternion) > 1e-4) moving = true;
      book.home.quaternion.slerp(pose.quaternion, follow);
      if (!book.held) {
        book.root.position.copy(book.home.position);
        book.root.quaternion.copy(book.home.quaternion);
        book.root.scale.setScalar(pose.scale);
        // Measured: the tilt turns about the axes of the room, not of the leaning book.
        const rowShare = row && rowTune && slot === order.length - 1 ? joinOf(row, rowPast, rowTune) : 0;
        book.tilt.quaternion.copy(qInverse.copy(book.root.quaternion).invert()).multiply(qTiltMix.copy(qTilt).slerp(qTiltRow, rowShare)).multiply(book.root.quaternion);
      }
    }
    seeded = true;

    // The other books of the row come up from below and stand side by side.
    if (row && rowTune) {
      for (const [pos, i] of display.entries()) {
        if (pos === anchor) continue;
        const book = engine.books[i]!;
        if (row.arrived[pos]! <= 0.002) {
          // A featured book is back in the hands of the stack above. Any other book is out of sight.
          if (!order.includes(i)) book.root.visible = book.held;
          continue;
        }
        const turn = rowPlace(pos);
        book.root.visible = true;
        book.presentYaw = Math.PI - (Math.PI / 2) * turn;
        book.home.position.copy(rowAt);
        book.home.quaternion.copy(qUpright);
        book.home.scale = scale;
        if (!book.held) {
          book.root.position.copy(rowAt);
          book.root.quaternion.copy(qUpright);
          book.root.scale.setScalar(scale);
          book.tilt.quaternion.copy(qTiltRow);
        }
      }
    }

    // The turn a hand gave the centred book. A book that leaves the centre forgets its turn on the way.
    const index = row && rowLive ? display[row.selected]! : order[clamp(state.active, 0, order.length - 1)]!;
    focus = index;
    if (index !== spun) {
      const next = engine.books[index]!;
      spin = createSpin(next.turned.pitch, next.turned.yaw);
      press = null;
      spun = index;
    }
    for (const i of managed) {
      const book = engine.books[i]!;
      if (i === index) {
        if (ctx.still) {
          spin.shownPitch = spin.pitch;
          spin.shownYaw = spin.yaw;
          spin.coastPitch = spin.coastYaw = spin.front = spin.back = 0;
        } else if (stepSpin(spin, f.dt, spinTune)) moving = true;
        // The cover lifts a little under a resting pointer, as if a thumb were on its edge.
        const resting = hovering && ctx.pointer !== null && !press && !book.held && !ctx.still && Math.abs(state.progress - Math.round(state.progress)) < 0.03;
        const goal = resting ? spinTune.peek * DEG : 0;
        peek += (goal - peek) * frameFactor(spinTune.peekFollow, f.dt);
        if (Math.abs(goal - peek) < 1e-4) peek = goal;
        else moving = true;
        book.setTurn(spin.shownPitch, spin.shownYaw, book.held ? 0 : Math.max(spin.front, peek), book.held ? 0 : spin.back);
      } else if (Math.abs(book.turned.pitch) + Math.abs(book.turned.yaw) + book.flap.front + book.flap.back > 1e-4) {
        const keep = ctx.still ? 0 : Math.exp(-spinTune.unwind * Math.min(f.dt, 0.05));
        book.setTurn(book.turned.pitch * keep, book.turned.yaw * keep, 0, 0);
        if (Math.abs(book.turned.pitch) + Math.abs(book.turned.yaw) < 1e-4) book.setTurn(0, 0, 0, 0);
        moving = true;
      } else if (book.root.visible) book.setTurn(0, 0, 0, 0);
    }

    if (engine.state.active !== index) {
      engine.state.active = index;
      ctx.events.emit('book-focus', { slug: engine.books[index]!.record.slug, index });
    }
    if (moving) ctx.invalidate();
  });

  return shelf;
}
