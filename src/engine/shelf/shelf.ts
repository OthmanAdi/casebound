/**
 * The shelf: featured books in a vertical stack, one per scroll slot. Scrolling moves the stack; each book
 * turns out of the way as it leaves and turns in as it arrives (SPEC sections 6 and 7).
 */
import { Euler, Quaternion, Vector3 } from 'three';
import type { Engine } from '../index';
import { DEG, approach, clamp, easeInOutQuad, frameFactor } from '../core/math';
import { tunable } from '../core/tune';
import { SCROLL_COMPACT, SCROLL_DESKTOP, createScrollState, stepScroll, type ScrollState } from './scroll';

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
  /** Plays the arrival of the first book again. */
  intro(): void;
  dispose(): void;
}

const euler = (x: number, y: number, z: number): Quaternion => new Quaternion().setFromEuler(new Euler(x * DEG, y * DEG, z * DEG, 'XYZ'));

export function createShelf(engine: Engine, opts: ShelfOptions = {}): Shelf {
  const { ctx } = engine;
  const order = (opts.featured ?? engine.books.map((b) => b.record.slug)).map((slug) => {
    const i = engine.books.findIndex((b) => b.record.slug === slug);
    if (i < 0) throw new Error(`bindery: shelf lists "${slug}", which is not a loaded book`);
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
      baseY: { value: -2.3068, min: -30, max: 30, help: 'Height of the centred book' },
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

  // Books the shelf does not place stay out of sight until another view takes them.
  for (const [i, book] of engine.books.entries()) if (!order.includes(i)) book.root.visible = false;

  const state = createScrollState();
  const scrollY = opts.scrollY ?? ((): number => window.scrollY);
  const slotPx = opts.slotPx ?? ((): number => window.innerHeight);
  const qRest = new Quaternion();
  const qLeave = new Quaternion();
  const qArrive = new Quaternion();
  const pose: ShelfPose = { position: new Vector3(), quaternion: new Quaternion(), scale: 1, visible: true };
  const tilt = { yaw: 0, pitch: 0 };
  let introT = 0;
  let introActive = !ctx.still;
  let seeded = false;

  const shelf: Shelf = {
    state,
    order,
    enabled: true,
    intro: () => {
      introT = 0;
      introActive = !ctx.still;
      ctx.invalidate();
    },
    dispose: () => {
      unsub();
      window.removeEventListener('scroll', onScroll);
      ctx.registry.remove('shelf.featured');
    },
  };

  const onScroll = (): void => ctx.invalidate();
  window.addEventListener('scroll', onScroll, { passive: true });

  const unsub = ctx.onFrame('layout', (f) => {
    if (!shelf.enabled) return;
    const tuning = ctx.compact ? SCROLL_COMPACT : SCROLL_DESKTOP;
    let moving = stepScroll(state, scrollY(), slotPx(), order.length, tuning, f.dt, ctx.still);

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

    const offset = opts.centreOffsetPx?.() ?? { x: 0, y: 0 };
    const worldPerPx = ctx.visibleHeightAt(t.planeZ) / Math.max(1, ctx.size.y);
    const scale = ctx.compact ? t.compactScale : 1;
    const follow = !seeded || ctx.still ? 1 : frameFactor(t.turnFollow, f.dt);

    for (const [slot, index] of order.entries()) {
      const book = engine.books[index]!;
      const b = state.progress - slot - introDrop;
      let y = b * t.pitch + t.baseY - offset.y * worldPerPx;
      if (b > t.exitFrom) y += Math.pow((b - t.exitFrom) / 0.4, 3) * t.pitch * t.exitBoost;
      const end = b > 0 ? t.turnEndLeave : t.turnEndArrive;
      const amount = easeInOutQuad(clamp((Math.abs(b) - t.turnStart) / Math.max(1e-3, end - t.turnStart), 0, 1));
      pose.position.set(offset.x * worldPerPx, y, t.planeZ);
      pose.quaternion.copy(qRest).slerp(b > 0 ? qLeave : qArrive, amount);
      pose.scale = scale;
      pose.visible = Math.abs(b) < t.visible;
      opts.layout?.({ slot, offset: b, count: order.length, slug: book.record.slug }, pose);

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
        book.tilt.rotation.set(tilt.pitch, tilt.yaw, 0);
      }
    }
    seeded = true;

    if (state.active !== engine.state.active || engine.books[order[state.active]!] !== engine.books[engine.state.active]) {
      const index = order[clamp(state.active, 0, order.length - 1)]!;
      if (engine.state.active !== index) {
        engine.state.active = index;
        ctx.events.emit('book-focus', { slug: engine.books[index]!.record.slug, index });
      }
    }
    if (moving) ctx.invalidate();
  });

  return shelf;
}
