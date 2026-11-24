/**
 * The reader: opens a book from the shelf, lays it open toward the camera, turns its leaves and closes it again.
 * SPEC section 9.
 */
import { Euler, Quaternion, Raycaster, Vector2, Vector3, type Mesh, type Texture } from 'three';
import type { Book } from '../book/book';
import type { Engine } from '../index';
import { DEG, approach, clamp, easeOutCubic, lerp, powerSigmoid } from '../core/math';
import { tunable } from '../core/tune';
import { BUNDLE_DEFAULT, bundleCount, bundleLift, bundleShown, bundleTurn, releaseLift, stepRelease } from './bundle';
import { CURL_DEFAULT, curlFlat, resetCurl, resetFlop, stepCurl, stepFlop } from './curl';
import { Leaf } from './leaf';
import { BRAKE_HOLD, LEAF_DEFAULT, braked, sendLeaf, sheetTurn, stepLeaf, throwLeaf, windOf } from './leaf-physics';
import { flowPages } from '../book/painter';
import { paginate, type PageSource } from './pages';
import { PUSH_DEFAULT, createPush, stepPush } from './push';
import { RIFFLE_DEFAULT, RIFFLE_MAX, riffleCast, riffleDrop, riffleReveal, riffleTurn } from './riffle';

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

/** A place on a printed page. See `Reader.pageAt`. */
export interface PageHit {
  page: number;
  u: number;
  v: number;
  point: Vector3;
  normal: Vector3;
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
  /**
   * Turns several leaves as one block: a positive count forward, a negative one back. No more than lie on that
   * side. Fewer than two turn as a single page. False when nothing turned: a leaf is in the air, or a block is.
   */
  turnLeaves(count: number): boolean;
  goTo(page: number): void;
  /**
   * A second picture over the print of every page, in the page's own picture space: the marks of a pen, say. A
   * function from the page number to its overlay, or null for a page without one. Call `refreshOverlays` when a
   * page gets its first overlay or loses it; painting into an overlay that is already on show needs no call.
   */
  overlay: ((page: number) => Texture | null) | null;
  refreshOverlays(): void;
  /**
   * The printed page under a point of the window: its number, where on its picture the point lies (u from the
   * left, v from the foot, both 0 to 1), and the place and the facing of the paper there in the world. Stacks,
   * leaves in the air and a bundle all count. Null where no page is.
   */
  pageAt(x: number, y: number): PageHit | null;
  /** While true, a press on a page takes no leaf and turns nothing: a tool such as a pen has the pointer. */
  handsOff: boolean;
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
      forwardFirst: { value: 0.236, min: 0, max: 1, help: 'Share of the way forward that the book takes while it waits for its cover to move. Measured: 4.25 of 18' },
      scale: { value: 1, min: 0.3, max: 3, help: 'Scale of the open book. Measured: 1 for a featured book; 1.1 when opened from a spine row' },
      rise: { value: 0.524, min: -10, max: 10, help: 'How far above the centre of the picture the spine of the open book sits' },
      pitch: { value: 22, min: 0, max: 80, unit: 'deg', help: 'How far the open book leans back' },
      pitchUp: { value: 10, min: 0, max: 40, unit: 'deg', help: 'Extra pitch with the pointer at the top' },
      pitchDown: { value: 12, min: 0, max: 40, unit: 'deg' },
      pitchRate: { value: 6, min: 0.1, max: 40, unit: '1/s' },
      push: { value: PUSH_DEFAULT.max, min: 0, max: 0.5, help: 'How far the weight of the open book follows the pointer near the middle of the spread, as a share of the book. The spine rolls, the boards stay. Measured: 0.2' },
      pushEdge: { value: PUSH_DEFAULT.edge, min: 0, max: 0.5, help: 'With the pointer at a window edge, a book open near that end opens up to this reading place. Measured: 0.3' },
      pushRate: { value: PUSH_DEFAULT.rate, min: 0.1, max: 40, unit: '1/s', help: 'How fast the weight follows. Measured: 7' },
      pushSwap: { value: PUSH_DEFAULT.swap, min: 0, max: 2, unit: 's', help: 'Blend when the pointer crosses the middle of the spread. Measured: 0.4' },
      readingFollow: { value: 0.25, min: 0.01, max: 1, help: 'Share of the way the case moves per 60 Hz frame toward a new reading place, so a turning leaf does not jolt the boards. Measured: 0.25' },
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

  const curlTune = tunable(ctx.registry, {
    id: 'reader.curl',
    label: 'Corner curl',
    kind: 'animation',
    tags: ['animation', 'paper', 'interaction'],
    describe: 'The page under the pointer lifts its corner, a page held by a hand folds over where it is held, and a leaf let go carries a curl that relaxes as it lands. Not shown under reduced motion.',
    source: 'src/engine/reader/curl.ts',
    params: {
      amount: { value: CURL_DEFAULT.amount, min: 0, max: 20, unit: 'rad', help: 'Base strength: radians of roll over one span. Measured 7.02. 0 turns the curl off' },
      hover: { value: CURL_DEFAULT.hover, min: 0, max: 1, help: 'Share of the base strength under a resting pointer. Measured 2 x 0.14, which gives 1.97 rad. 0 mounts no sheet for hover' },
      drag: { value: CURL_DEFAULT.drag, min: 0, max: 4, help: 'Share while a hand holds the page. Measured 1.82: 12.8 rad, far past the half turn the roll stops at, so the held region folds flat over' },
      flight: { value: CURL_DEFAULT.flight, min: 0, max: 2, help: 'Share of the held strength a leaf carries in the air' },
      power: { value: CURL_DEFAULT.power, min: 0.3, max: 3, help: 'Exponent of the roll. Below 1 the sheet turns up early past the fold line' },
      tilt: { value: CURL_DEFAULT.tilt, min: 0, max: 60, unit: 'deg', help: 'Slant of the fold line with the pointer at the head or foot of the page' },
      flightTilt: { value: CURL_DEFAULT.flightTilt, min: 0, max: 60, unit: 'deg', help: 'Least slant of the fold line on a leaf in the air. Its direction follows the pointer height' },
      pivot: { value: CURL_DEFAULT.pivot, min: 0.2, max: 1, help: 'Where the fold line crosses the middle of the page, as a share of the page width from the spine' },
      span: { value: CURL_DEFAULT.span, min: 0.2, max: 6, help: 'Length over which the roll builds up, in page widths. Measured 32.4 on a page 15.6 wide' },
      inner: { value: CURL_DEFAULT.inner, min: 0, max: 4, help: 'How much longer the span gets for a grab at the spine: span x (1 + inner)' },
      innerLoss: { value: CURL_DEFAULT.innerLoss, min: 0, max: 1, help: 'Share of the strength lost for a grab at the spine' },
      dragRate: { value: CURL_DEFAULT.dragRate, min: 0.005, max: 1, help: 'How fast the fold builds under a hand: share per 60 Hz frame' },
      hoverRate: { value: CURL_DEFAULT.hoverRate, min: 0.005, max: 1, help: 'How fast the corner lifts under a resting pointer: share per 60 Hz frame' },
      flightRate: { value: CURL_DEFAULT.flightRate, min: 0.005, max: 1, help: 'How fast the curl builds on a leaf in the air: share per 60 Hz frame' },
      relaxRate: { value: CURL_DEFAULT.relaxRate, min: 0.005, max: 1, help: 'How fast a corner comes down once the pointer has left: share per 60 Hz frame' },
      handoffRate: { value: CURL_DEFAULT.handoffRate, min: 0.005, max: 1, help: 'The same for a sheet another leaf is about to land on' },
      dragTiltRate: { value: CURL_DEFAULT.dragTiltRate, min: 0.005, max: 1, help: 'How fast the fold line follows a hand: share per 60 Hz frame' },
      tiltRate: { value: CURL_DEFAULT.tiltRate, min: 0.005, max: 1, help: 'How fast the fold line follows the pointer otherwise' },
      rise: { value: CURL_DEFAULT.rise, min: 0, max: 1, unit: 's', help: 'Time for the drawn curl to rise to a stronger one' },
      fall: { value: CURL_DEFAULT.fall, min: 0, max: 1, unit: 's', help: 'Time for the drawn curl to fall to a weaker one. Measured as immediate; a short fall keeps the fold from jumping when the page is let go' },
      fadeFrom: { value: CURL_DEFAULT.fadeFrom, min: 0, max: 1, help: 'Share of its turn at which a leaf in the air starts to relax its curl' },
      fadeTo: { value: CURL_DEFAULT.fadeTo, min: 0, max: 1, help: 'Share of its turn at which the curl is gone' },
      boost: { value: CURL_DEFAULT.boost, min: 0, max: 2, help: 'Extra strength early in the turn' },
      boostFrom: { value: CURL_DEFAULT.boostFrom, min: 0, max: 1, help: 'Share of the turn at which the early extra starts to go' },
      boostTo: { value: CURL_DEFAULT.boostTo, min: 0, max: 1, help: 'Share of the turn at which the early extra is gone' },
      edge: { value: CURL_DEFAULT.edge, min: 0.01, max: 1, help: 'The curl fades as the leaf turns edge-on: it is whole once the cosine of the leaf angle passes this' },
      flop: { value: CURL_DEFAULT.flop, min: 0, max: 3, unit: 'rad', help: 'How far the outer half of a held leaf falls over near upright, toward the side the hand has pulled it to. 0 turns it off' },
      flopRate: { value: CURL_DEFAULT.flopRate, min: 0.005, max: 1, help: 'How fast it falls: share per 60 Hz frame' },
      flopZone: { value: CURL_DEFAULT.flopZone, min: 0.05, max: 0.5, help: 'It acts within this share of the turn around upright' },
      flopFade: { value: CURL_DEFAULT.flopFade, min: 0, max: 1, unit: 's', help: 'Time for it to go once the leaf is let go' },
    },
    onChange: () => ctx.invalidate(),
  });
  const bundleTune = tunable(ctx.registry, {
    id: 'reader.bundle',
    label: 'Bundle of leaves',
    kind: 'animation',
    tags: ['animation', 'paper', 'interaction'],
    describe: 'The fore-edge of a page stack takes every leaf from the top down to the place under the pointer. Under a resting pointer they lift off the stack as one block; a press let go, or a flick, turns them over. `reader.turnLeaves` turns a block on a clock. Not shown under reduced motion.',
    source: 'src/engine/reader/bundle.ts',
    params: {
      min: { value: BUNDLE_DEFAULT.min, min: 2, max: 50, step: 1, help: 'Fewest leaves that turn as a block. Measured: 2' },
      hold: { value: BUNDLE_DEFAULT.hold, min: 0, max: 1, unit: 's', help: 'Wait between letting go and the turn, while the block lifts. Measured: 120 ms' },
      base: { value: BUNDLE_DEFAULT.base, min: 0.1, max: 3, unit: 's', help: 'Time the smallest block takes to turn. Measured: 700 ms' },
      perDoubling: { value: BUNDLE_DEFAULT.perDoubling, min: 0, max: 0.5, unit: 's', help: 'Time added for every doubling of the leaves. Measured: 45 ms' },
      longest: { value: BUNDLE_DEFAULT.longest, min: 0.1, max: 5, unit: 's', help: 'The longest a turn takes. Measured: 1.1 s' },
      lift: { value: BUNDLE_DEFAULT.lift, min: 0, max: 0.8, unit: 'rad', help: 'How far the block lifts off its stack. Measured: 7 degrees' },
      liftSeconds: { value: BUNDLE_DEFAULT.liftSeconds, min: 0.01, max: 1, unit: 's', help: 'Time for the lift to build up. Measured: 150 ms' },
      liftFade: { value: BUNDLE_DEFAULT.liftFade, min: 0, max: 0.99, help: 'Share of the turn from which the lift goes again' },
      twist: { value: BUNDLE_DEFAULT.twist, min: 0, max: 1, help: 'How far the foot of the page leads the lift and the head trails it, as a share of the lift' },
      bow: { value: BUNDLE_DEFAULT.bow, min: 0, max: 1, help: 'How far the block bows against the air, as a share of the bow of a single sheet' },
      handLift: { value: BUNDLE_DEFAULT.handLift, min: 0, max: 0.8, unit: 'rad', help: 'How far a block lifts under the pointer or in a hand. 0: nothing lifts under a resting pointer. Measured: 16 degrees' },
      liftRate: { value: BUNDLE_DEFAULT.liftRate, min: 0.5, max: 60, unit: '1/s', help: 'How fast that lift builds up. Measured: 12' },
      dropRate: { value: BUNDLE_DEFAULT.dropRate, min: 0.5, max: 60, unit: '1/s', help: 'How fast it goes. Measured: 10' },
      turnRate: { value: BUNDLE_DEFAULT.turnRate, min: 0.5, max: 40, unit: '1/s', help: 'A block let go by hand covers this share of the way that is left per second. Measured: 7' },
      turnLeast: { value: BUNDLE_DEFAULT.turnLeast, min: 0.05, max: 10, unit: '1/s', help: 'And never less than this share of the whole turn per second. Measured: 0.9' },
      flick: { value: BUNDLE_DEFAULT.flick, min: 0.05, max: 10, help: 'Pointer speed in px per ms above which a held block is sent over at once. Measured: 0.7' },
      leave: { value: BUNDLE_DEFAULT.leave, min: 0, max: 2, unit: 's', help: 'How long a lifted block waits for a pointer that has left its edge. Measured: 90 ms' },
    },
    onChange: () => ctx.invalidate(),
  });
  const riffleTune = tunable(ctx.registry, {
    id: 'reader.riffle',
    label: 'Opening riffle',
    kind: 'animation',
    tags: ['animation', 'paper', 'book'],
    describe: 'While the pages part, a few leaves on top of each stack are live: they rise with the block direction and settle onto their stacks one after another, the lowest first. Not shown under reduced motion.',
    source: 'src/engine/reader/riffle.ts',
    params: {
      leaves: { value: RIFFLE_DEFAULT.leaves, min: 0, max: RIFFLE_MAX, step: 1, help: 'Live leaves on each side. 0 turns the riffle off: the two blocks simply part. Read when a book opens' },
      start: { value: RIFFLE_DEFAULT.start, min: 0, max: 0.9, help: 'Page progress at which the first leaves start to settle. Measured 0.25' },
      stagger: { value: RIFFLE_DEFAULT.stagger, min: 0, max: 0.5, unit: 's', help: 'Time between one leaf starting to settle and the next one above it. Measured 90 ms' },
      seconds: { value: RIFFLE_DEFAULT.seconds, min: 0, max: 2, unit: 's', help: 'Time one leaf takes to settle onto its stack. Measured 420 ms' },
      dropStart: { value: RIFFLE_DEFAULT.dropStart, min: 0, max: 0.9, help: 'Page progress at which the leaves start to go limp. Measured 0.2' },
      dropDelay: { value: RIFFLE_DEFAULT.dropDelay, min: 0, max: 1, unit: 's', help: 'Time before the first leaf goes limp. Measured 50 ms' },
      dropStagger: { value: RIFFLE_DEFAULT.dropStagger, min: 0, max: 0.5, unit: 's', help: 'Time between one leaf going limp and the next. Measured 50 ms' },
      dropSeconds: { value: RIFFLE_DEFAULT.dropSeconds, min: 0, max: 2, unit: 's', help: 'Time for a leaf to go from stiff to limp. Measured 400 ms' },
      fan: { value: RIFFLE_DEFAULT.fan, min: 0, max: 1, help: 'How far the waiting leaves fan out around the block direction, as a share of its rise' },
    },
    onChange: () => ctx.invalidate(),
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
  /**
   * A bundle of leaves turning as one block: the leaves `lo` up to `hi`. `turn` runs from 0, lying right, to 1.
   * `spread` already counts them where they are going.
   */
  let bundle: {
    lo: number;
    hi: number;
    forward: boolean;
    /** Turned by itself on a clock, or taken by a pointer. */
    source: 'auto' | 'hand';
    /** In a hand: lifted and waiting, or let go. By itself: turning. */
    phase: 'gather' | 'release' | 'turn';
    /** A block in a hand: how far it is on its way, 0 to 1, and where it is going: over (1) or back (0). */
    progress: number;
    goal: 0 | 1;
    /** True once `spread` counts its leaves where they are going. A block that only lifts is not counted yet. */
    counted: boolean;
    elapsed: number;
    turn: number;
    /** Radians off the stack it lies on. */
    lift: number;
    landed: boolean;
    /** Lifted by a resting pointer, not by a press: it sinks back when the pointer leaves its edge. */
    hover: boolean;
    missing: boolean;
    lost: number;
    /** Frames since the number of its leaves last changed. Its pages are painted once it holds still. */
    steady: number;
  } | null = null;
  /** A press that started on the fore-edge of a stack. `spent` once a flick has sent the block. */
  let edgePress: { id: number; x: number; y: number; startX: number; startY: number; time: number; speed: number; moved: number; spent: boolean } | null = null;
  let blank: Texture | null = null;
  const cache = new Map<number, Texture>();
  const pitch = { v: 0 };
  const push = createPush();
  /** The reading place the case shows: it follows the leaves with a short lag. Negative before the first frame. */
  let readingShown = -1;
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
    pageOf.set(tex, page);
    return tex;
  };

  /** Which page a painted picture is of, for the overlays. */
  const pageOf = new Map<Texture, number>();
  /** The pages on show on the two stacks and on the faces of a bundle. 0: none. */
  const shown = { left: 0, right: 0, top: 0, under: 0 };

  /** Pages that are wanted soon but not painted yet, the most urgent first. One is painted per frame. */
  let pending: number[] = [];

  /** The texture of a page for now: blank while the page waits to be painted. */
  const soon = (page: number): Texture => (pending.includes(page) ? blank! : texture(page));

  /** Frees painted pages that are far from the spread and on no live leaf. */
  const trim = (): void => {
    const keep = new Set<number>();
    for (let p = spread * 2 - 3; p <= spread * 2 + 4; p++) keep.add(p);
    for (const leaf of leaves) if (leaf.active) keep.add(leaf.index * 2).add(leaf.index * 2 + 1).add(leaf.index * 2 + 2).add(leaf.index * 2 + 3);
    if (bundle) keep.add(bundle.lo * 2).add(bundle.lo * 2 + 1).add(bundle.hi * 2).add(bundle.hi * 2 + 1);
    for (const [page, tex] of cache) {
      if (cache.size <= TEXTURE_BUDGET) break;
      if (keep.has(page)) continue;
      tex.dispose();
      pageOf.delete(tex);
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
    if (bundle) {
      // The stacks show what lies under the bundle, and the bundle its own two outer pages. None of them is
      // painted here: a block under a moving pointer changes its leaves from frame to frame (see `queuePages`).
      const have = (page: number): Texture => (cache.has(page) ? texture(page) : blank!);
      book.setPage('bundleTop', have(bundle.lo * 2 + 1));
      book.setPage('bundleUnder', have(bundle.hi * 2));
      book.setPage('left', have(bundle.lo * 2));
      book.setPage('right', have(bundle.hi * 2 + 1));
      Object.assign(shown, { left: bundle.lo * 2, right: bundle.hi * 2 + 1, top: bundle.lo * 2 + 1, under: bundle.hi * 2 });
    } else {
      book.setPage('left', soon(left * 2));
      book.setPage('right', soon(right * 2 + 1));
      Object.assign(shown, { left: left * 2, right: right * 2 + 1, top: 0, under: 0 });
    }
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
    leaf.toss = null;
    leaf.script = null;
    leaf.limp = 1;
    leaf.wind = 1;
    leaf.held = 0;
    leaf.mesh.visible = false;
    resetCurl(leaf.curl);
    resetFlop(leaf.flop);
  };

  /** The leaf in the air that is outermost on a stack (0 = right, 1 = left): the one a hand or a key reaches first. */
  const outer = (side: 0 | 1): Leaf | undefined => leaves.find((l) => l.active && l.side === side && l.index === (side === 1 ? spread - 1 : spread));

  /**
   * Lifts the top leaf off a stack: 1 = off the right stack, -1 = off the left. It stays counted where it was.
   * With none free, `steal` allows taking the one that has all but landed.
   */
  const take = (direction: 1 | -1, steal = true): Leaf | null => {
    // While a bundle turns, the stacks give no single leaf.
    if (!book || !opening || pages < 0.9 || bundle) return null;
    // The pool also holds the leaves of the opening riffle. They do not count toward the leaves in the air.
    const busy = leaves.reduce((n, l) => n + (l.active && !l.script ? 1 : 0), 0);
    let leaf = busy < LIVE_LEAVES ? leaves.find((l) => !l.active) : undefined;
    if (!leaf) {
      if (!steal) return null;
      // None free: take the one that has all but landed. A held leaf is never taken away.
      const near = (l: Leaf): number => (!l.active || l.script || l.dragTarget !== null ? 9 : Math.abs(l.side * Math.PI - l.motion.angle));
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
    leaf.toss = null;
    leaf.motion.angle = leaf.motion.shown = leaf.side * Math.PI;
    leaf.motion.velocity = 0;
    leaf.motion.target = leaf.side;
    leaf.motion.resting = false;
    leaf.wind = 1;
    leaf.held = 0;
    resetCurl(leaf.curl);
    leaf.setPages(texture(index * 2 + 1), texture(index * 2 + 2));
    leaf.mesh.visible = true;
    paintSpread();
    return leaf;
  };

  /** Takes a leaf out of the opening riffle: from here on it moves by itself or by hand, and needs both its pages. */
  const unscript = (leaf: Leaf): void => {
    if (!leaf.script) return;
    leaf.script = null;
    leaf.motion.velocity = 0;
    leaf.setPages(texture(leaf.index * 2 + 1), texture(leaf.index * 2 + 2));
  };

  /** Sends a leaf to a side and moves the page count with it. */
  const aim = (leaf: Leaf, side: 0 | 1, kick: number): void => {
    unscript(leaf);
    const across = leaf.side !== side;
    if (across) {
      spread += side === 1 ? 1 : -1;
      leaf.side = side;
      if (book) ctx.events.emit('page-turn', { slug: book.record.slug, leaf: leaf.index, direction: side === 1 ? 1 : -1 });
    }
    // A hand gives no speed. A leaf it sends across is thrown on as it passes upright (see `throwLeaf`).
    leaf.toss = across && kick === 0 ? side : null;
    sendLeaf(leaf.motion, side, kick);
    paintSpread();
    emitView();
  };

  /** Turns one page: 1 = forward, -1 = back. A leaf that is still in the air on that side is sent back instead of a new one. */
  const launch = (direction: 1 | -1): boolean => {
    if (pages < 0.9) return false;
    const from: 0 | 1 = direction === 1 ? 0 : 1;
    const flying = outer(from);
    if (flying && flying.dragTarget !== null) return false;
    const leaf = flying ?? take(direction);
    if (!leaf) return false;
    aim(leaf, direction === 1 ? 1 : 0, leafTune.kick);
    return true;
  };

  const pick = new Raycaster();
  const pickAt = new Vector2();

  // ---------------------------------------------------------------- a bundle of leaves (SPEC S-RD-12)
  const edgeA = new Vector3();
  const edgeB = new Vector3();
  /** Depths at which the fore-edge of a stack is projected to find the pointer on it. */
  const EDGE_STEPS = 16;

  /** A block in a hand that has not been sent: it only lifts, and may still sink back. */
  const lifted = (): boolean => !!bundle && bundle.source === 'hand' && !bundle.counted;

  /**
   * True when a block can be taken: the pages have parted, no sheet is off its stack and the case has come to
   * rest. A turned leaf whose sheet is down counts as down, although its angle creeps on for seconds.
   */
  const calm = (): boolean =>
    !!book &&
    opening &&
    pages >= 0.985 &&
    !bundle &&
    !ctx.still &&
    Math.abs(readingShown * book.dims.leaves - spread) < 0.5 &&
    !leaves.some((l) => l.active && (l.script || l.dragTarget !== null || Math.abs(sheetTurn(l.motion.shown / Math.PI) - l.side) > 0.002));

  /** Has the pages of the block painted, one per frame: what comes into view under it first, then its face that turns up. */
  const queuePages = (): void => {
    if (!book || !bundle) return;
    const { lo, hi, forward } = bundle;
    const want = forward ? [hi * 2 + 1, hi * 2, lo * 2 + 1, lo * 2] : [lo * 2, lo * 2 + 1, hi * 2, hi * 2 + 1];
    pending = want.filter((page) => page >= 1 && page <= book!.dims.leaves * 2 && !cache.has(page));
  };

  /**
   * The fore-edge of a page stack under a point of the window: the side (1 = right) and the leaves from the top
   * of that stack down to the place. Null anywhere else, and where that is fewer than a block.
   *
   * The edge is the one the stack has as it lies. A block that is lifted counts as lying, so the place under a
   * pointer does not move away when the block rises.
   */
  const pickEdge = (x: number, y: number): { side: 1 | -1; count: number } | null => {
    if (!book || !(calm() || (lifted() && bundle!.progress === 0))) return null;
    const v = book.volume;
    const rect = ctx.canvas.getBoundingClientRect();
    const up = lifted() ? bundle : null;
    for (const side of [1, -1] as const) {
      const which = side === 1 ? 1 : 0;
      const own = up && (up.forward ? 1 : -1) === side ? up.hi - up.lo : 0;
      const here = (side === 1 ? book.dims.leaves - (up ? up.hi : spread) : up ? up.lo : spread) + own;
      if (here < 2) continue;
      const thick = v.stackThickness(which) + (own / book.dims.leaves) * v.dims.blockT;
      let before = 0;
      for (let i = 0; i <= EDGE_STEPS; i++) {
        // The edge of the leaf at this depth, from the foot of the page to its head, on the screen.
        const e = v.edgeAt(which, (i / EDGE_STEPS) * thick);
        v.group.localToWorld(edgeA.set(e.x, -v.dims.pageH / 2, e.z)).project(ctx.camera);
        v.group.localToWorld(edgeB.set(e.x, v.dims.pageH / 2, e.z)).project(ctx.camera);
        const ax = rect.left + (edgeA.x * 0.5 + 0.5) * rect.width;
        const ay = rect.top + (0.5 - edgeA.y * 0.5) * rect.height;
        const ux = rect.left + (edgeB.x * 0.5 + 0.5) * rect.width - ax;
        const uy = rect.top + (0.5 - edgeB.y * 0.5) * rect.height - ay;
        const length = Math.hypot(ux, uy) || 1;
        const along = ((x - ax) * ux + (y - ay) * uy) / (length * length);
        // Which side of that line the pointer is on, in pixels.
        const off = ((x - ax) * uy - (y - ay) * ux) / length;
        if (i > 0 && along >= -0.01 && along <= 1.01 && before !== 0 && off !== before && before > 0 !== off > 0) {
          const depth = (i - 1 + before / (before - off)) / EDGE_STEPS;
          const count = bundleCount(depth, here, bundleTune);
          return count ? { side, count } : null;
        }
        before = off;
      }
    }
    return null;
  };

  /** Lifts the top `count` leaves of a stack as a block, or changes the leaves of the block that is lifted there. */
  const gather = (side: 1 | -1, count: number, hover: boolean): void => {
    if (!book) return;
    if (bundle) {
      if (!lifted() || bundle.progress !== 0 || (bundle.forward ? 1 : -1) !== side) return;
      // A block that was sinking back is taken up again.
      bundle.phase = 'gather';
      bundle.missing = false;
      bundle.lost = 0;
      bundle.hover = bundle.hover && hover;
      if (count !== bundle.hi - bundle.lo) {
        if (bundle.forward) bundle.hi = bundle.lo + count;
        else bundle.lo = bundle.hi - count;
        bundle.steady = 0;
        paintSpread();
      }
      return;
    }
    if (!calm()) return;
    // Sheets that lay on the stacks for the corner curl go: the block takes their place.
    for (const leaf of leaves) retire(leaf);
    hovered = null;
    const lo = side === 1 ? spread : spread - count;
    bundle = { lo, hi: lo + count, forward: side === 1, source: 'hand', phase: 'gather', progress: 0, goal: 0, counted: false, elapsed: 0, turn: side === 1 ? 0 : 1, lift: 0, landed: false, hover, missing: false, lost: 0, steady: 0 };
    paintSpread();
  };

  /** Sends a lifted block over: from here on its leaves count where they are going. */
  const send = (): void => {
    if (!book || !bundle || !lifted()) return;
    bundle.phase = 'release';
    bundle.goal = 1;
    bundle.counted = true;
    spread = bundle.forward ? bundle.hi : bundle.lo;
    queuePages();
    ctx.events.emit('page-turn', { slug: book.record.slug, leaf: bundle.lo, direction: bundle.forward ? 1 : -1, leaves: bundle.hi - bundle.lo });
    paintSpread();
    emitView();
  };

  /** Lets a lifted block sink back onto its stack. */
  const drop = (): void => {
    if (!bundle || !lifted()) return;
    bundle.phase = 'release';
    bundle.goal = 0;
  };

  /** Takes a lifted block away at once, for a press that wants a single page. */
  const unlift = (): void => {
    if (!book || !lifted()) return;
    bundle = null;
    book.bundle = null;
    paintSpread();
  };

  /** A mouse moved with no button down: a block lifts under it on the fore-edge of a stack, and sinks when it has left. */
  const hoverEdge = (x: number, y: number, blocked: boolean): void => {
    if (drag || brake || edgePress || bundleTune.handLift <= 0) return;
    if (bundle && !(lifted() && bundle.hover)) return;
    const at = blocked ? null : where(x, y);
    // Measured: only the outer fifth of a page looks for the edge.
    const hit = at && at.u > 0.8 ? pickEdge(x, y) : null;
    if (hit && (!bundle || (bundle.forward ? 1 : -1) === hit.side)) gather(hit.side, hit.count, true);
    else if (bundle) bundle.missing = true;
  };

  /** Sends the top `count` leaves of a stack across as one block, on a clock: 1 = off the right stack, -1 = off the left. */
  const takeBundle = (side: 1 | -1, count: number): boolean => {
    if (!book || !calm()) return false;
    const n = Math.min(Math.floor(count), side === 1 ? book.dims.leaves - spread : spread);
    if (n < 2) return n === 1 && launch(side);
    for (const leaf of leaves) retire(leaf);
    hovered = null;
    const lo = side === 1 ? spread : spread - n;
    const hi = lo + n;
    bundle = { lo, hi, forward: side === 1, source: 'auto', phase: 'turn', progress: 0, goal: 1, counted: true, elapsed: 0, turn: side === 1 ? 0 : 1, lift: 0, landed: false, hover: false, missing: false, lost: 0, steady: 0 };
    spread = side === 1 ? hi : lo;
    queuePages();
    ctx.events.emit('page-turn', { slug: book.record.slug, leaf: lo, direction: side, leaves: n });
    paintSpread();
    emitView();
    return true;
  };

  // ---------------------------------------------------------------- the opening riffle (SPEC S-RD-1, S-RD-6)
  // Until the pages part, every leaf lies on the back board. The top leaves of both stacks are live from the
  // start: they lie there too, rise with the block direction as the book falls open, and settle one by one.

  /** Seconds since the leaves started to go limp, and since they started to settle. Negative before. */
  let riffle: { drop: number; settle: number } | null = null;

  /** Dresses the leaves of the riffle in the pages that are painted so far. */
  const dress = (): void => {
    for (const leaf of leaves) if (leaf.active && leaf.script) leaf.setPages(cache.get(leaf.index * 2 + 1) ?? blank!, cache.get(leaf.index * 2 + 2) ?? blank!);
  };

  /** Puts the top leaves of both stacks into the pool for an opening from the closed book. */
  const castRiffle = (): void => {
    riffle = null;
    pending = [];
    if (!book || ctx.still || pages > 1e-3 || leaves.some((l) => l.active)) return;
    const cast = riffleCast(spread, book.dims.leaves, Math.min(riffleTune.leaves, ctx.lowPower ? 2 : RIFFLE_MAX));
    if (!cast.length) return;
    for (const [n, part] of cast.entries()) {
      const leaf = leaves[n]!;
      leaf.active = true;
      leaf.index = part.index;
      leaf.side = part.side;
      leaf.script = part;
      leaf.dragTarget = null;
      leaf.limp = 0;
      leaf.motion.angle = leaf.motion.shown = leaf.motion.velocity = 0;
      leaf.motion.target = part.side;
      leaf.motion.resting = false;
      resetCurl(leaf.curl);
      leaf.mesh.visible = true;
    }
    riffle = { drop: -1, settle: -1 };
    // The front of the top leaf is the page under the opening cover: it is painted now. The others follow one
    // per frame, in the order they come into view: the pages under the leaves, their fronts, the backs of
    // those that turn over.
    const first = cast[0]!.index;
    const last = cast[cast.length - 1]!.index;
    texture(first * 2 + 1);
    const order = [last * 2 + 3, first * 2, ...cast.map((p) => p.index * 2 + 1), ...cast.filter((p) => p.side === 1).map((p) => p.index * 2 + 2)];
    pending = order.filter((page) => page >= 1 && page <= book!.dims.leaves * 2 && !cache.has(page));
    dress();
  };

  /** Paints the next waiting page and runs the clocks of the riffle. */
  const stepRiffle = (dt: number): void => {
    if (pending.length) {
      texture(pending.shift()!);
      dress();
      paintSpread();
    }
    if (!riffle) return;
    riffle.drop = riffle.drop < 0 ? (pages >= riffleTune.dropStart ? 0 : -1) : riffle.drop + dt;
    riffle.settle = riffle.settle < 0 ? (pages >= riffleTune.start ? 0 : -1) : riffle.settle + dt;
    if (!leaves.some((l) => l.script)) riffle = null;
  };

  /** Moves a leaf of the riffle: it stands on the block direction until its turn, then settles onto its side. */
  const ride = (leaf: Leaf, frames: number): void => {
    const part = leaf.script!;
    const m = leaf.motion;
    const settled = riffle ? riffleReveal(riffle.settle, part.rank, riffleTune) : 1;
    // The block direction: the share of the leaves that lie on the left so far.
    const block = book && book.dims.leaves ? (spread / book.dims.leaves) * pages : 0;
    const before = m.angle;
    m.angle = m.shown = Math.PI * riffleTurn(block, part, settled, riffleTune.fan);
    m.velocity = (m.angle - before) / Math.max(1e-3, frames);
    leaf.limp = riffle ? riffleDrop(riffle.drop, part.order, riffleTune) : 1;
    if (settled >= 1) {
      // Down. From here it is a leaf like any other: the next frame finds it at rest. A leaf of the riffle was
      // dressed only on the side it showed; a hand can take it in this very frame, so it gets both pages now.
      leaf.script = null;
      m.velocity = 0;
      leaf.setPages(texture(leaf.index * 2 + 1), texture(leaf.index * 2 + 2));
    }
  };

  /** Counts, for every live leaf, the live leaves that lie under it on either side. Leaves keep their order in the book. */
  const stack = (): void => {
    for (const leaf of leaves) {
      if (!leaf.active) continue;
      leaf.below[0] = leaf.below[1] = 0;
      for (const other of leaves) if (other.active && other.index !== leaf.index) leaf.below[other.index > leaf.index ? 0 : 1] += 1;
    }
  };

  // ---------------------------------------------------------------- turning a page by hand (SPEC S-RD-10)
  let drag: { leaf: Leaf; id: number; startX: number; startAngle: number; remembered: 0 | 1; half: 1 | -1; travel: number; dx: number } | null = null;
  /**
   * A press on a leaf in the air, before it is known whether the hand moves. The leaf is braked, not held: a move
   * of the hand catches it, and without one it is let go on (SPEC S-RD-10a).
   */
  let brake: { leaf: Leaf; id: number; startX: number; half: 1 | -1; elapsed: number } | null = null;
  const centre = new Vector3();
  const ignore = opts.ignore ?? 'button, a, input, select, textarea, label, aside, header, footer, nav, [role="toolbar"], [role="dialog"]';

  /**
   * Where a point of the window lies on the spread: the half (1 = right, -1 = left), how far from the spine
   * (0, to 1 at the fore-edge) and how high on the page (0 at the foot, 1 at the head).
   */
  const where = (x: number, y: number): { half: 1 | -1; u: number; v: number; inside: boolean } | null => {
    if (!book || !opening || pages < 0.9) return null;
    book.root.getWorldPosition(centre);
    const perWorld = ctx.size.y / ctx.visibleHeightAt(centre.z);
    centre.project(ctx.camera);
    const rect = ctx.canvas.getBoundingClientRect();
    const dx = x - (rect.left + (centre.x * 0.5 + 0.5) * rect.width);
    const dy = y - (rect.top + (0.5 - centre.y * 0.5) * rect.height);
    const scale = book.root.scale.x * perWorld;
    const w = book.dims.pageW * scale;
    const h = book.dims.pageH * scale;
    return { half: dx >= 0 ? 1 : -1, u: clamp(Math.abs(dx) / w, 0, 1), v: clamp(0.5 - dy / h, 0, 1), inside: Math.abs(dx) <= w * 1.06 && Math.abs(dy) <= h * 0.56 };
  };

  /** Which half of the spread lies under a point of the window: 1 = right, -1 = left, 0 = neither. */
  const halfAt = (x: number, y: number): 1 | -1 | 0 => {
    const at = where(x, y);
    return at && at.inside ? at.half : 0;
  };

  /** The leaf a hand reaches on a half of the spread: one in the air over it, whichever way it was going. Otherwise the top of the stack. */
  const reach = (half: 1 | -1, steal = true): Leaf | null => {
    const near: 0 | 1 = half === 1 ? 0 : 1;
    const far = outer(near === 1 ? 0 : 1);
    const over = far && (half === 1 ? far.motion.angle < Math.PI / 2 : far.motion.angle > Math.PI / 2) ? far : undefined;
    return outer(near) ?? over ?? take(half, steal);
  };

  // ---------------------------------------------------------------- corner curl (SPEC S-RD-11)
  /** The last place a mouse was seen, and whether it was over something that is not the book. */
  let point: { x: number; y: number; blocked: boolean } | null = null;
  /** The leaf the pointer rests on. */
  let hovered: Leaf | null = null;
  /** Where on the page the pointer is. */
  const grab = { u: 1, v: 0.5 };
  /** True once the pointer has moved since a press was last let go. */
  let stirred = true;

  /**
   * Finds the leaf under the pointer, once a frame. A corner can only lift on a live sheet, so if the page under
   * the pointer is the top of a stack, a sheet is mounted there. It lies exactly on the stack, shows the same
   * pages and is counted where it lies, so the page count does not move.
   */
  const lookUnder = (): void => {
    const at = point && !ctx.still ? where(point.x, point.y) : null;
    if (at && (drag || at.inside)) {
      grab.u = at.u;
      grab.v = at.v;
    }
    if (drag) hovered = drag.leaf;
    else hovered = at && at.inside && !point!.blocked && !reader.handsOff && curlTune.amount > 0 && curlTune.hover > 0 ? reach(at.half, false) : null;
  };

  /** Advances the curl of one leaf. */
  const bend = (leaf: Leaf, dt: number): void => {
    // A leaf taken out of the opening riffle before it was limp goes limp by itself.
    if (leaf.limp < 1) leaf.limp = Math.min(1, leaf.limp + dt / Math.max(0.05, riffleTune.dropSeconds));
    const m = leaf.motion;
    if (ctx.still) resetFlop(leaf.flop);
    else stepFlop(leaf.flop, m.shown / Math.PI, leaf.dragTarget, dt, curlTune);
    if (ctx.still || curlTune.amount <= 0) {
      resetCurl(leaf.curl);
      return;
    }
    stepCurl(
      leaf.curl,
      {
        pages,
        held: leaf.dragTarget !== null,
        // Measured: a leaf in the air counts as under the pointer only once the pointer has moved since it was
        // let go. Until then it carries the curl of a leaf in the air.
        hovered: leaf === hovered && (stirred || m.resting || leaf.dragTarget !== null),
        covered: outer(leaf.side) !== leaf,
        grabU: grab.u,
        grabV: grab.v,
        pointerY: ctx.pointer?.y ?? 0,
        angle: m.angle,
        velocity: m.velocity,
        target: m.target,
        shown: m.shown,
      },
      dt,
      curlTune,
    );
  };

  /** Notes where on the page a hand holds it. A finger has no resting place the frame could look up, so a press and every move say it. */
  const gripAt = (x: number, y: number): void => {
    const at = where(x, y);
    if (!at) return;
    grab.u = at.u;
    grab.v = at.v;
  };

  /** True for a sheet that stays mounted on its stack: the pointer rests on it, or its corner is still coming down. */
  const lying = (leaf: Leaf): boolean => !ctx.still && (leaf === hovered || !curlFlat(leaf.curl));

  /** How far a pull of `px` pixels turns the leaf, 0..1: a quick start, then in step with the hand. */
  const pull = (px: number): number => Math.min(1, 0.08 * (1 - Math.exp(-px / 12)) + (0.92 * px) / Math.max(1, window.innerWidth * t.dragWidth * (ctx.compact ? 2 : 1)));

  /** Puts a leaf into the hand. */
  const hold = (leaf: Leaf, id: number, x: number, half: 1 | -1): void => {
    unscript(leaf);
    // Whatever the leaf was doing, in the hand it shows both its pages.
    leaf.setPages(texture(leaf.index * 2 + 1), texture(leaf.index * 2 + 2));
    // A sheet lifted off its stack starts straight: the air only presses on it once it moves.
    if (Math.abs(leaf.motion.velocity) < 1e-3) {
      leaf.wind = 0;
      // Lying on its stack it is in the hand at once: both rules have it there.
      if (Math.abs(leaf.motion.shown - leaf.side * Math.PI) < 0.02) leaf.held = 1;
    }
    drag = { leaf, id, startX: x, startAngle: leaf.motion.angle, remembered: leaf.side, half, travel: 0, dx: 0 };
    leaf.dragTarget = leaf.motion.angle;
    leaf.toss = null;
    leaf.motion.resting = false;
    document.documentElement.style.cursor = 'grabbing';
  };

  /** Ends the wait of a press on a flying leaf that saw no move: the leaf is thrown on and the hand takes the page under it. */
  const letGo = (): void => {
    if (!brake) return;
    const { leaf, id, startX, half } = brake;
    brake = null;
    if (leaf.active && !leaf.motion.resting) leaf.motion.velocity = leafTune.kick * (leaf.side === 1 ? 1 : -1);
    // A leaf on its way to the side of the hand lands on the page the hand would take: there is none to hold yet.
    if (leaf.side === (half === 1 ? 0 : 1)) return;
    const next = take(half, false);
    if (next) hold(next, id, startX, half);
  };

  const onDown = (ev: PointerEvent): void => {
    if (reader.handsOff) return;
    if (drag || brake || edgePress || ev.button !== 0 || !ev.isPrimary) return;
    if (ev.target instanceof Element && ev.target.closest(ignore)) return;
    // A block that stands lifted under the pointer is the one that goes: what was shown is what turns. The book
    // leans toward the pointer, so the place under a resting pointer may have left the edge by a pixel or two.
    const up = bundle && lifted() && bundle.phase === 'gather' ? bundle : null;
    const here = up ? where(ev.clientX, ev.clientY) : null;
    const edge = up && here && here.u > 0.8 && here.half === (up.forward ? 1 : -1) ? { side: here.half, count: up.hi - up.lo } : pickEdge(ev.clientX, ev.clientY);
    if (edge) gather(edge.side, edge.count, false);
    if (edge && bundle && lifted() && bundle.phase === 'gather') {
      // A press on the fore-edge takes no leaf into the hand. The block lifts, and goes when the hand lets go.
      edgePress = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, startX: ev.clientX, startY: ev.clientY, time: ev.timeStamp || performance.now(), speed: 0, moved: 0, spent: false };
      ev.preventDefault();
      ctx.invalidate();
      return;
    }
    // A press anywhere else wants a page: a block that was lifted is down at once.
    unlift();
    const half = halfAt(ev.clientX, ev.clientY);
    if (!half) return;
    // Catch a leaf that is in the air over this half, whichever way it was going. Otherwise lift the top one.
    const leaf = reach(half);
    if (!leaf || leaf.dragTarget !== null) return;
    gripAt(ev.clientX, ev.clientY);
    const m = leaf.motion;
    if (!leaf.script && !m.resting && Math.abs(m.velocity) > 0.004 && Math.abs(m.angle - leaf.side * Math.PI) > 0.05) {
      // Measured: a leaf in the air is braked first. It is caught only if the hand moves.
      brake = { leaf, id: ev.pointerId, startX: ev.clientX, half, elapsed: 0 };
      document.documentElement.style.cursor = 'grabbing';
    } else hold(leaf, ev.pointerId, ev.clientX, half);
    ev.preventDefault();
    ctx.invalidate();
  };

  const onMove = (ev: PointerEvent): void => {
    const blocked = ev.target instanceof Element && !!ev.target.closest(ignore);
    point = ev.pointerType === 'mouse' ? { x: ev.clientX, y: ev.clientY, blocked } : null;
    stirred = true;
    if (edgePress && ev.pointerId === edgePress.id) {
      const p = edgePress;
      const now = ev.timeStamp || performance.now();
      const ms = Math.max(4, now - p.time);
      const step = Math.hypot(ev.clientX - p.x, ev.clientY - p.y);
      p.time = now;
      p.x = ev.clientX;
      p.y = ev.clientY;
      p.speed = 0.6 * p.speed + (step / ms) * 0.4;
      p.moved = Math.max(p.moved, Math.hypot(ev.clientX - p.startX, ev.clientY - p.startY));
      if (!p.spent && p.moved >= t.tapPx && p.speed > bundleTune.flick) {
        // A flick sends the block without waiting for the hand to let go.
        send();
        p.spent = true;
      } else if (!p.spent && p.speed < bundleTune.flick / 2 && step <= 12) {
        // A slow hand along the edge takes more leaves, or fewer.
        const hit = pickEdge(ev.clientX, ev.clientY);
        if (hit) gather(hit.side, hit.count, false);
      }
      ctx.invalidate();
      return;
    }
    if (ev.pointerType === 'mouse' && ev.buttons === 0 && opening && !reader.handsOff) {
      hoverEdge(ev.clientX, ev.clientY, blocked);
      if (bundle) ctx.invalidate();
    }
    if (brake && ev.pointerId === brake.id && Math.abs(ev.clientX - brake.startX) >= t.tapPx) {
      // The hand moved in time: it has the leaf.
      const { leaf, id, startX, half } = brake;
      brake = null;
      if (leaf.active && leaf.dragTarget === null) hold(leaf, id, startX, half);
    }
    if (!drag) {
      if (brake) return;
      if (opening && ev.pointerType === 'mouse') {
        const over = !blocked && halfAt(ev.clientX, ev.clientY) !== 0;
        // Over a block that stands lifted the cursor says that a click sends it. A tool that has the pointer
        // sets the cursor itself.
        if (!reader.handsOff) document.documentElement.style.cursor = lifted() ? 'pointer' : over ? 'grab' : '';
      }
      return;
    }
    if (ev.pointerId !== drag.id) return;
    gripAt(ev.clientX, ev.clientY);
    drag.dx = ev.clientX - drag.startX;
    drag.travel = Math.max(drag.travel, Math.abs(drag.dx));
    // Pulling to the left raises the angle, which turns the leaf forward.
    drag.leaf.dragTarget = clamp(drag.startAngle - Math.sign(drag.dx) * Math.PI * pull(Math.abs(drag.dx)), 0, Math.PI);
    ctx.invalidate();
  };

  const onUp = (ev: PointerEvent): void => {
    if (edgePress && ev.pointerId === edgePress.id) {
      const press = edgePress;
      edgePress = null;
      // Read in the reference: a block in a hand always goes when the hand lets go.
      if (!press.spent) {
        if (ev.type === 'pointercancel') drop();
        else send();
      }
      ctx.invalidate();
      return;
    }
    if (brake && ev.pointerId === brake.id) {
      // Let go before the wait was over: a tap. The leaf goes on, and one more page turns like the button does.
      const { half } = brake;
      brake = null;
      stirred = false;
      document.documentElement.style.cursor = '';
      if (ev.type !== 'pointercancel') launch(half);
      ctx.invalidate();
      return;
    }
    if (!drag || ev.pointerId !== drag.id) return;
    const { leaf, travel, dx, startAngle, remembered, half } = drag;
    drag = null;
    stirred = false;
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

  /** The mouse left the window: nothing is under it any more. */
  const onLeave = (): void => {
    point = null;
    if (!edgePress) drop();
    ctx.invalidate();
  };

  window.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  document.documentElement.addEventListener('pointerleave', onLeave);

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
        next.overlayFor = (map) => {
          const page = pageOf.get(map);
          return page !== undefined && reader.overlay ? reader.overlay(page) : null;
        };
        source = opts.pages?.(next) ?? paginate(next.record, next.dims.leaves * 2, (paragraphs, heading) => flowPages(paragraphs, heading, next.dims.pageW / next.dims.pageH, next.faces));
        blank = next.paintPage({ folio: null, left: true }, 64);
        leaves = Array.from({ length: LIVE_LEAVES + RIFFLE_MAX * 2 }, () => new Leaf(next, engine.fx, blank!));
        // Measured: without a page in the address the reference opens a book at its middle leaf.
        spread = clamp(Math.round((page ?? Math.round(next.dims.leaves / 2) * 2) / 2), 0, next.dims.leaves);
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
      castRiffle();
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
    overlay: null,
    refreshOverlays: () => {
      book?.refreshOverlays();
      for (const leaf of leaves) leaf.refreshOverlays();
      ctx.invalidate();
    },
    pageAt: (x, y) => {
      if (!book || !opening || pages < 0.9) return null;
      const rect = ctx.canvas.getBoundingClientRect();
      pick.setFromCamera(pickAt.set(((x - rect.left) / Math.max(1, rect.width)) * 2 - 1, 1 - ((y - rect.top) / Math.max(1, rect.height)) * 2), ctx.camera);
      const v = book.volume;
      const meshes: Mesh[] = [v.leftBlock, v.rightBlock, v.chunkBlock, ...leaves.filter((l) => l.active).map((l) => l.mesh)].filter((m) => m.visible);
      // The vertices of all of them are rewritten in place whenever the book moves.
      for (const m of meshes) m.geometry.computeBoundingSphere();
      const hit = pick.intersectObjects(meshes, false)[0];
      if (!hit || !hit.uv || !hit.face) return null;
      const face = hit.face.materialIndex ?? 0;
      let page = 0;
      if (hit.object === v.leftBlock) page = face === 0 ? shown.left : 0;
      else if (hit.object === v.rightBlock) page = face === 0 ? shown.right : 0;
      else if (hit.object === v.chunkBlock) page = face === 0 ? shown.top : face === 2 ? shown.under : 0;
      else {
        const leaf = leaves.find((l) => l.mesh === hit.object);
        page = leaf ? leaf.index * 2 + 1 + face : 0;
      }
      if (page < 1 || page > book.dims.leaves * 2) return null;
      return { page, u: hit.uv.x, v: hit.uv.y, point: hit.point.clone(), normal: hit.face.normal.clone().transformDirection(hit.object.matrixWorld) };
    },
    handsOff: false,
    turnLeaves: (count) => (Math.abs(count) < 2 ? count !== 0 && launch(count > 0 ? 1 : -1) : takeBundle(count > 0 ? 1 : -1, Math.abs(count))),
    goTo: (page) => {
      if (!book) return;
      spread = clamp(Math.round(page / 2), 0, book.dims.leaves);
      for (const leaf of leaves) retire(leaf);
      bundle = null;
      edgePress = null;
      book.bundle = null;
      riffle = null;
      pending = [];
      drag = null;
      brake = null;
      hovered = null;
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
      document.documentElement.removeEventListener('pointerleave', onLeave);
      ctx.registry.remove('reader');
      ctx.registry.remove('reader.leaf');
      ctx.registry.remove('reader.curl');
      ctx.registry.remove('reader.riffle');
      ctx.registry.remove('reader.bundle');
    },
  };

  function finish(): void {
    if (!book) return;
    for (const leaf of leaves) leaf.dispose();
    leaves = [];
    riffle = null;
    pending = [];
    drag = null;
    brake = null;
    hovered = null;
    bundle = null;
    edgePress = null;
    book.bundle = null;
    document.documentElement.style.cursor = '';
    for (const tex of cache.values()) tex.dispose();
    cache.clear();
    pageOf.clear();
    book.overlayFor = null;
    blank?.dispose();
    blank = null;
    book.held = false;
    book.poised = false;
    book.push = 0;
    Object.assign(push, createPush());
    readingShown = -1;
    book.setOpen(0, 0.5, 1);
    book = null;
    cover = 0;
    pages = 0;
    engine.state.inside = 0;
    engine.state.parted = 0;
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
    engine.state.parted = pages;

    // Leaves in the air.
    const frames = 60 * Math.min(f.dt, 0.05);
    stepRiffle(f.dt);
    lookUnder();
    if (brake) {
      brake.elapsed += f.dt;
      if (brake.elapsed >= BRAKE_HOLD || !brake.leaf.active || brake.leaf.motion.resting) letGo();
    }
    for (const leaf of leaves) {
      if (!leaf.active) continue;
      // The air presses on a sheet by how fast it moves. The leaves of the opening keep their own rule.
      if (!leaf.script) {
        leaf.wind = ctx.still ? 0 : approach(leaf.wind, windOf(leaf.motion.velocity), 14, f.dt);
        leaf.held = approach(leaf.held, leaf.dragTarget !== null ? 1 : 0, 10, f.dt);
      }
      if (leaf.script) {
        ride(leaf, frames);
        continue;
      }
      if (leaf.dragTarget !== null) {
        // Held: the leaf follows the hand with a little lag. Its speed only tells the sheet which way to bow.
        const m = leaf.motion;
        const before = m.angle;
        m.angle += (leaf.dragTarget - m.angle) * (1 - Math.pow(t.dragFollow, frames));
        m.velocity = (m.angle - before) / Math.max(1e-3, frames);
        m.shown += (m.angle - m.shown) * (1 - Math.pow(leafTune.follow, frames));
        bend(leaf, f.dt);
        continue;
      }
      const tune = { ...LEAF_DEFAULT, ...leafTune };
      stepLeaf(leaf.motion, f.dt, brake && brake.leaf === leaf ? braked(tune, brake.elapsed) : tune);
      if (leaf.toss !== null && throwLeaf(leaf.motion, leaf.toss, leafTune.kick)) leaf.toss = null;
      bend(leaf, f.dt);
      if (leaf.motion.resting || ctx.still) {
        leaf.motion.angle = leaf.motion.shown = leaf.side * Math.PI;
        if (lying(leaf)) {
          // It stays as a sheet on its stack. One that came down in the opening riffle may lack a page.
          leaf.setPages(texture(leaf.index * 2 + 1), texture(leaf.index * 2 + 2));
          continue;
        }
        retire(leaf);
        paintSpread();
        emitView();
      }
    }

    // Where the book is open, as the case sees it. A leaf in the air counts by how far it has come, so the
    // boards move with it instead of jumping when it starts.
    let onLeft = spread;
    for (const leaf of leaves) if (leaf.active && !leaf.script) onLeft += clamp(leaf.motion.shown / Math.PI, 0, 1) - leaf.side;
    // A bundle turns on a clock. Like a leaf it counts by how far it has come.
    if (bundle) {
      const n = bundle.hi - bundle.lo;
      let turned = 0;
      if (bundle.source === 'auto') {
        bundle.elapsed += f.dt;
        turned = ctx.still ? 1 : bundleTurn(bundle.elapsed, n, bundleTune);
        bundle.lift = ctx.still ? 0 : bundleLift(bundle.elapsed, turned, bundleTune) * bundleTune.lift;
        bundle.landed = turned >= 1;
      } else {
        if (bundle.phase === 'gather') {
          // Under the pointer the block lifts and waits. Its pages are painted once its leaves hold still.
          bundle.steady += 1;
          if (bundle.steady === 4) queuePages();
          bundle.lift = approach(bundle.lift, bundleTune.handLift, bundleTune.liftRate, f.dt);
          if (bundle.hover && bundle.missing && !edgePress) {
            bundle.lost += f.dt;
            if (bundle.lost > bundleTune.leave) drop();
          }
        } else {
          bundle.progress = ctx.still ? bundle.goal : stepRelease(bundle.progress, bundle.goal, f.dt, bundleTune);
          bundle.lift = ctx.still ? 0 : approach(bundle.lift, releaseLift(bundle.progress, bundle.goal) * bundleTune.handLift, bundleTune.dropRate, f.dt);
          bundle.landed = bundle.goal === 1 && bundle.progress === 1 && bundle.lift < 0.01;
        }
        turned = bundleShown(bundle.progress);
      }
      bundle.turn = bundle.forward ? turned : 1 - turned;
      onLeft += n * (bundle.turn - (bundle.counted === bundle.forward ? 1 : 0));
      if (bundle.source === 'hand' && bundle.phase === 'release' && bundle.goal === 0 && bundle.progress === 0 && bundle.lift < 0.004) {
        // Back on its stack: it was never counted anywhere else.
        bundle = null;
        paintSpread();
      }
    }
    const reading = book.dims.leaves ? clamp(onLeft / book.dims.leaves, 0, 1) : 0.5;
    readingShown = readingShown < 0 || ctx.still ? reading : readingShown + (reading - readingShown) * (1 - Math.pow(1 - t.readingFollow, frames));
    if (Math.abs(reading - readingShown) < 5e-4) readingShown = reading;
    if (bundle && bundle.landed && readingShown === reading) {
      // Down, and the case has caught up: from here on its leaves are part of the stack.
      bundle = null;
      paintSpread();
      emitView();
    }
    book.bundle =
      bundle && book.dims.leaves
        ? {
            under: bundle.lo / book.dims.leaves,
            share: (bundle.hi - bundle.lo) / book.dims.leaves,
            turn: bundle.turn,
            lift: bundle.lift,
            twist: bundleTune.twist,
            // Like a sheet it bows back against the air, the way it came from.
            bow: -0.42 * bundleTune.bow * (bundle.forward ? 1 : -1),
          }
        : null;

    // The weight of the book follows the pointer across the spread; its pitch follows the pointer's height.
    const offset = opts.centreOffsetPx?.() ?? { x: 0, y: 0 };
    const px = (ctx.pointer?.x ?? 0) - offset.x / Math.max(1, ctx.size.x / 2);
    const py = ctx.pointer?.y ?? 0;
    const pushTune = { ...PUSH_DEFAULT, max: t.push, edge: t.pushEdge, rate: t.pushRate, swap: t.pushSwap };
    book.push = stepPush(push, px, readingShown, ctx.still ? 1e3 : f.dt, pushTune, drag !== null);
    pitch.v = ctx.still ? 0 : approach(pitch.v, py > 0 ? py * t.pitchUp : py * t.pitchDown, t.pitchRate, f.dt);
    book.setOpen(cover, readingShown, pages);
    stack();
    for (const leaf of leaves) if (leaf.active) leaf.update();

    // Until its cover moves the book is still the shelf's to turn toward the pointer: the reader takes over the
    // tilt it has at that moment.
    book.poised = opening && cover <= 1e-4;
    if (book.poised) tiltFrom.copy(book.tilt.quaternion);

    // From where the shelf keeps the book to the reading position.
    const home = book.home;
    const z = home.position.z + t.forward;
    const worldPerPx = ctx.visibleHeightAt(z) / Math.max(1, ctx.size.y);
    goalPos.set(offset.x * worldPerPx, ctx.camera.position.y - offset.y * worldPerPx + t.rise, z);
    // Measured: position and turn follow the cover's own progress, with no second easing on top.
    const blend = cover;
    book.root.position.copy(home.position).lerp(goalPos, blend);
    // Measured on a book opened from the row: of the way toward the camera it takes a first step while it waits
    // for its cover (4.25 of 18 units), eased, and the rest with the cover.
    if (t.forward > 0) {
      const waited = opening ? (delay > 0 ? easeOutCubic(clamp(elapsed / delay, 0, 1)) : 1) : blend;
      book.root.position.z = home.position.z + t.forward * (t.forwardFirst * waited + (1 - t.forwardFirst) * blend);
    }
    q.setFromEuler(e.set(-(t.pitch - pitch.v) * DEG, 0, 0));
    book.root.quaternion.copy(home.quaternion).slerp(q, blend);
    book.root.scale.setScalar(lerp(home.scale, home.scale * t.scale * (opts.fit?.() ?? 1), blend));
    // The lean toward the pointer that the book had on the shelf fades as the cover opens.
    book.tilt.quaternion.copy(tiltFrom).slerp(upright, blend);
  });

  return reader;
}
