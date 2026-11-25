/**
 * The zine of a book in the scene (SPEC S-ZINE-3..7).
 *
 * A zine is a `Book` with the pamphlet binding, built from the record `zineRecord` derives. It is added to the
 * engine the first time it is asked for, after the shelf has taken its books, so the shelf never places it. This
 * unit flies it in from the right, lays it closed over the picture, hands it to the reader when its cover is
 * turned, and flies it out again. Reading it is the reader's business: leaves, bar, lens and pens are the book's.
 *
 * While the reader holds it, this unit steers what makes a zine other than a book: its cover is a leaf of its own
 * paper that turns over a booklet already lying open, the booklet comes to the reading place on a quick curve of
 * its own (`Reader.carry`), it lies as a shallow V that turns about its spine as it is read, its leaves turn with
 * their own paper values, and after the last leaf its back cover comes over and it lies closed on its face.
 */
import { Euler, Vector3 } from 'three';
import type { Book } from '../book/book';
import { DEG, clamp, frameFactor, smoothstep } from '../core/math';
import { tunable } from '../core/tune';
import type { Engine } from '../index';
import type { Reader } from '../reader/reader';
import { LEAF_DEFAULT, createLeafMotion, sendLeaf, sheetTurn, stepLeaf, type LeafMotion, type LeafTuning } from '../reader/leaf-physics';
import { ZINE_PAPER, ZINE_POSE, flyOffset, flyTurn, stepPresence, zineLast, zineLean, zineNumber, zineOnBack, zinePage } from './pose';
import { bookOf, isZine, zineRecord, zineSlug } from './record';

export type ZineState = 'away' | 'coming' | 'lying' | 'reading' | 'going';

export interface ZineOptions {
  /** Offset of the middle of the picture from the canvas centre, in CSS pixels. The same the reader is given. */
  centreOffsetPx?: () => { x: number; y: number };
  /**
   * A sideways shift of the open zine's reading place, in units of its page width: on a narrow screen the site shows
   * one page side at a time and moves the booklet to bring that side into the middle. Default none.
   */
  side?: () => number;
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
  /** The number the bar shows: 1 closed, then the sides turned, the cover counted. */
  readonly number: number;
  /** True while the zine lies closed on its back after its last leaf. */
  readonly onBack: boolean;
  /** How far its front cover has turned as a leaf, 0 to 1 (the sheet follows `sheetTurn` of it). */
  readonly cover: number;
  /** True for a book whose record has a zine. */
  has(slug: string): boolean;
  /** Brings the zine of a book in. With a number above 1 it is opened there once it lies. False: the book has none. */
  open(slug: string, number?: number): boolean;
  /** Turns the cover of the zine that lies closed, or goes to a number in the one that is open. */
  read(number?: number): void;
  /** Shuts the cover of the open zine again. It stays, lying closed. */
  shut(): void;
  /** Closes the open zine onto its back from its last spread (true), or opens it again from there (false). False when it cannot. */
  back(on: boolean): boolean;
  /** Closes it and sends it away. */
  close(): void;
  /** The box of the zine in the window, CSS pixels: left, top, width, height. Null while none is drawn. */
  rect(): [number, number, number, number] | null;
  dispose(): void;
}

/** What the reader is lent while it holds a zine, and given back afterwards: tunable and key. */
const LENT = [
  ['reader', 'forward'],
  ['reader', 'scale'],
  ['reader', 'openDelay'],
  ['reader', 'coverSeconds'],
  ['reader', 'pageDelay'],
  ['reader', 'pageSeconds'],
  ['reader', 'push'],
  ['reader', 'pushEdge'],
  ['reader', 'pitch'],
  ['reader', 'pitchUp'],
  ['reader', 'pitchDown'],
  ['reader.leaf', 'damping'],
  ['reader.leaf', 'follow'],
  ['reader.leaf', 'kick'],
  ['reader.riffle', 'leaves'],
] as const;

/** Time for the reader to let go of a zine whose cover has already come down, seconds. Nothing moves in it. */
const LET_GO = 0.05;
/** Share of the reader's pitch a zine keeps on a narrow screen. Read in the reference: 0.4. */
const PHONE_PITCH = 0.4;
/** Share of the way to the reading place the shut zine may still have to go when the reader lets go of it. */
const LET_GO_BLEND = 0.005;

export function createZines(engine: Engine, reader: Reader, opts: ZineOptions = {}): Zines {
  const { ctx } = engine;
  const t = tunable(ctx.registry, {
    id: 'zine',
    label: 'Zine',
    kind: 'view',
    tags: ['animation', 'book', 'interaction', 'paper'],
    describe: 'The pamphlet cut from a book: how it flies in, where it lies closed, where it is read, how it lies open and the paper of its leaves.',
    source: 'src/engine/zine/zine.ts',
    params: {
      flyFrom: { value: ZINE_POSE.flyFrom, min: 0, max: 120, help: 'How far to the right it starts, world units. Measured: 45' },
      flyRate: { value: ZINE_POSE.flyRate, min: 0.01, max: 1, help: 'Share of the remaining way it closes in a frame of 1/60 s: coming, going, to the reading place and back, its turn about the spine. Measured: 0.12' },
      liePitch: { value: ZINE_POSE.liePitch, min: -90, max: 30, unit: 'deg', help: 'How far the closed zine leans back at rest. Fitted to a still: -21' },
      lieYaw: { value: ZINE_POSE.lieYaw, min: -60, max: 60, unit: 'deg', help: 'Its turn about the upright at rest: the fore-edge goes back. Fitted to a still: 33' },
      lieRoll: { value: ZINE_POSE.lieRoll, min: -45, max: 45, unit: 'deg', help: 'Its turn in the picture plane at rest. Fitted to a still: 11' },
      lieLeft: { value: -0.3, min: -20, max: 20, help: 'How far left of the reading place the fold of the closed zine lies. Fitted to a still: 0.3 to the right of it' },
      lieUp: { value: 0.18, min: -10, max: 10, help: 'How far above the reading place it lies. Measured: 0.18' },
      lieForward: { value: 3.56, min: 0, max: 30, help: 'How far in front of its book the closed zine lies. Measured: 3.56' },
      lieScale: { value: 0.88, min: 0.2, max: 2, help: 'Scale of the closed zine. Fitted to a still: 0.88' },
      forward: { value: 5, min: 0, max: 30, help: 'How far in front of its book the zine is read. Measured: 5' },
      scale: { value: 0.896, min: 0.2, max: 2, help: 'Scale of the open zine. Measured: a page 12.11 wide, which is 0.896 of ours' },
      phoneFill: { value: 0.95, min: 0.3, max: 1.5, help: 'On a narrow screen: the share of the window width the closed cover fills, and one open page. Measured: a page 373 px wide in a window of 390' },
      phonePitch: { value: -9, min: -60, max: 30, unit: 'deg', help: 'On a narrow screen: how far the closed zine leans back. Measured: -8.8' },
      open: { value: 83.5, min: 60, max: 100, unit: 'deg', help: 'Opening angle of each half of the open zine at its middle; 90 lies flat. Measured: the two halves lie 13 degrees short of flat' },
      lean: { value: 6.5, min: 0, max: 30, unit: 'deg', help: 'How far the open zine turns about its spine at its first leaf, and back the other way at its last: the side with fewer leaves lies higher. Measured: 6.5' },
      pointerLean: { value: 3, min: 0, max: 15, unit: 'deg', help: 'And up to this much toward the side the pointer is on. Read in the reference: 3' },
      damping: { value: ZINE_PAPER.damping, min: 0.005, max: 0.9, help: "Speed a leaf of the zine loses per 60 Hz frame while it turns; the book's is 0.131. Fitted to the reference's zine: 0.16" },
      follow: { value: ZINE_PAPER.follow, min: 0.001, max: 0.95, help: "How far the drawn leaf trails the simulated one; the book's is 0.15. Fitted: 0.05" },
      kick: { value: ZINE_PAPER.kick, min: 0, max: 0.5, help: "Starting speed of a leaf turned by key or button, radians per 60 Hz frame; the book's is 0.08. Fitted: 0.2" },
      coverKick: { value: ZINE_PAPER.coverKick, min: 0, max: 0.5, help: 'Starting speed of its cover. Fitted to the reference: 0.08' },
      linkWait: { value: 2, min: 0, max: 10, unit: 's', help: 'A zine opened at a page by its address lies closed this long first. Read in the reference: 2' },
      awaySeconds: { value: 0.25, min: 0.02, max: 3, unit: 's', help: 'Time for the cover of an open zine to shut when it is sent away. Measured: it is out of the picture within ten frames' },
      bookAwayX: { value: 19, min: 0, max: 60, help: 'How far to the left its book goes to make room' },
      bookAwayY: { value: 5, min: -30, max: 30, help: 'And how far down' },
    },
    onChange: () => {
      if (saved) lent();
      ctx.invalidate();
    },
  });
  /** Where the zine lies and where it is read, in world units and degrees. */
  interface Place {
    pitch: number;
    yaw: number;
    roll: number;
    left: number;
    forward: number;
    scale: number;
    readForward: number;
    readScale: number;
  }
  /**
   * Beside the details these are the measured tunables. On a narrow screen the reference fits the zine to the width
   * of the window at its book's own depth: closed, its cover fills the width, nearly facing the window; open, one
   * page does, and the site shows one side of the spread at a time (`ZineOptions.side`).
   */
  const place = (depth: number, book: Book): Place => {
    if (!ctx.compact) return { pitch: t.liePitch, yaw: t.lieYaw, roll: t.lieRoll, left: t.lieLeft, forward: t.lieForward, scale: t.lieScale, readForward: t.forward, readScale: t.scale };
    const width = (ctx.visibleHeightAt(depth) * ctx.size.x) / Math.max(1, ctx.size.y);
    return { pitch: t.phonePitch, yaw: 0, roll: 0, left: 0, forward: 0, scale: (t.phoneFill * width) / book.dims.coverW, readForward: 0, readScale: (t.phoneFill * width) / book.dims.pageW };
  };
  /** The place worked out in the last frame, for what is lent to the reader. */
  let where: Place | null = null;
  const pose = (at: Place): typeof ZINE_POSE => ({ flyFrom: t.flyFrom, flyRate: t.flyRate, shown: ZINE_POSE.shown, liePitch: at.pitch, lieYaw: at.yaw, lieRoll: at.roll });
  const paper = (): LeafTuning => ({ ...LEAF_DEFAULT, damping: t.damping, follow: t.follow });

  const pamphlets = new Map<string, Book>();
  let out: { slug: string; book: Book } | null = null;
  let state: ZineState = 'away';
  let p = 0;
  /** A number to open at once the zine lies, and how long it has lain. */
  let pending: number | null = null;
  let lain = 0;
  let saved: Map<string, number> | null = null;
  /** The front cover and the back cover, each a leaf: 0 lying right, pi turned over to the left. */
  const coverLeaf: LeafMotion = createLeafMotion(0);
  const backLeaf: LeafMotion = createLeafMotion(0);
  /** Where the open zine is on its way to the reading place, its turn about the spine in degrees, its sideways shift. */
  const motion = { blend: 0, lean: 0, shift: 0 };
  const carry = { blend: 0, shift: 0, open: 1 };
  /** True while this unit, not a pen, keeps the reader's hands off the leaves. */
  let handsMine = false;
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

  /** Puts a leaf of the zine down on a side at once. */
  const rest = (m: LeafMotion, side: 0 | 1): void => {
    m.angle = m.shown = side * Math.PI;
    m.velocity = 0;
    m.target = side;
    m.resting = true;
  };

  /** What the reader is lent; set again whenever a tunable of the zine changes. */
  const lent = (): void => {
    const lend = (id: string, key: string, value: number): void => void ctx.registry.set(id, key, value);
    const at = where ?? { forward: t.lieForward, scale: t.lieScale, readForward: t.forward, readScale: t.scale };
    lend('reader', 'forward', at.readForward - at.forward);
    lend('reader', 'scale', at.readScale / at.scale);
    // Measured: the cover moves in the frame after the key, over a booklet that lies open under it from the start.
    lend('reader', 'openDelay', 0);
    lend('reader', 'pageDelay', 0);
    lend('reader', 'pageSeconds', 0.05);
    // Read in the reference: the weight of a zine does not follow the pointer, no leaves riffle as it opens, and its
    // leaves are of its own paper.
    lend('reader', 'push', 0);
    lend('reader', 'pushEdge', 0);
    // Read in the reference: on a narrow screen the open zine leans back and follows the pointer's height less.
    const keep = ctx.compact ? PHONE_PITCH : 1;
    for (const key of ['pitch', 'pitchUp', 'pitchDown']) {
      const had = saved?.get(`reader/${key}`);
      if (had !== undefined && Number.isFinite(had)) lend('reader', key, had * keep);
    }
    lend('reader.leaf', 'damping', t.damping);
    lend('reader.leaf', 'follow', t.follow);
    lend('reader.leaf', 'kick', t.kick);
    lend('reader.riffle', 'leaves', 0);
  };
  /** Gives the reader the zine's reading place and paper, and keeps what it had for the books. */
  const lend = (): void => {
    if (saved) return;
    saved = new Map();
    for (const [id, key] of LENT) saved.set(`${id}/${key}`, Number(ctx.registry.getParam(id, key)));
    lent();
  };
  const giveBack = (): void => {
    reader.carry = null;
    if (handsMine) reader.handsOff = false;
    handsMine = false;
    if (out) {
      out.book.coverTurn = 1;
      out.book.backShut = 0;
      out.book.lean = 0;
    }
    if (!saved) return;
    for (const [id, key] of LENT) {
      const value = saved.get(`${id}/${key}`);
      if (value !== undefined && Number.isFinite(value)) ctx.registry.set(id, key, value);
    }
    saved = null;
  };

  const hide = (): void => {
    if (!out) return;
    out.book.root.visible = false;
    giveBack();
    out = null;
    p = 0;
    pending = null;
    rest(coverLeaf, 0);
    rest(backLeaf, 0);
    set('away');
  };

  const holding = (): boolean => !!out && reader.book === out.book;

  /** Turns the back cover over onto the last leaf, or back. */
  const toBack = (on: boolean): boolean => {
    if (!out || state !== 'reading' || !holding()) return false;
    if (on && reader.page < out.book.dims.leaves * 2) return false;
    if ((backLeaf.target === 1) === on) return true;
    sendLeaf(backLeaf, on ? 1 : 0, t.kick);
    // Closed on its back, no leaf is in reach of a hand: the back cover lies over them.
    if (on && !reader.handsOff) {
      reader.handsOff = true;
      handsMine = true;
    } else if (!on && handsMine) {
      reader.handsOff = false;
      handsMine = false;
    }
    opts.onChange?.();
    ctx.invalidate();
    return true;
  };

  const read = (number?: number): void => {
    if (!out || state === 'going' || state === 'away') return;
    const n = number ?? 2;
    const leaves = out.book.dims.leaves;
    const back = zineOnBack(n, leaves);
    const page = back ? leaves * 2 : (zinePage(n, leaves) ?? 0);
    if (state === 'reading') {
      if (!back) toBack(false);
      if (reader.page !== page) reader.goTo(page);
      if (back) toBack(true);
      opts.onChange?.();
      return;
    }
    // On its way in it finishes the way first.
    if (state === 'coming') {
      pending = n;
      return;
    }
    const active = engine.state.active;
    if (!holding()) {
      // From lying closed: the cover is down, the booklet where it lies, turned as it lies.
      rest(coverLeaf, 0);
      rest(backLeaf, 0);
      motion.blend = 0;
      motion.lean = t.lean;
      motion.shift = 0;
    }
    lend();
    if (!holding() || !reader.isOpen) reader.open(zineSlug(out.slug), page);
    if (reader.page !== page) reader.goTo(page);
    // The book it was cut from stays the one the page is about.
    engine.state.active = active;
    pending = null;
    sendLeaf(coverLeaf, 1, t.coverKick);
    set('reading');
    if (back) toBack(true);
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

  /** Where the pointer is across the open zine: -1 over the left fore-edge to 1 over the right one. 0 without a mouse. */
  const pointerSide = (book: Book): number => {
    const ptr = ctx.pointer;
    if (!ptr) return 0;
    v.copy(book.root.position).project(ctx.camera);
    const perPx = ctx.size.y / Math.max(1e-6, ctx.visibleHeightAt(book.root.position.z));
    const half = (book.dims.pageW * book.root.scale.x * perPx) / Math.max(1, ctx.size.x / 2);
    return half > 0 ? clamp((ptr.x - v.x) / half, -1, 1) : 0;
  };

  /** The parts of the zine the reader does not move, while the reader holds it. Runs before the reader's frame. */
  const steer = (book: Book, dt: number): void => {
    const tune = paper();
    for (const m of [coverLeaf, backLeaf]) {
      if (ctx.still) rest(m, m.target === 1 ? 1 : 0);
      else stepLeaf(m, dt, tune);
    }
    const cover = coverLeaf.shown / Math.PI;
    // Drawn as the sheet of a leaf is: off its stack late, down by nine tenths of its turn.
    book.coverTurn = sheetTurn(cover);
    book.backShut = sheetTurn(backLeaf.shown / Math.PI);
    const k = frameFactor(t.flyRate, dt);
    // Read in the reference: from the key it comes to the reading place by 0.12 of the way a frame, whatever its
    // cover does; shut again, it goes back with its cover. Sent away it goes with the reader's quick close.
    const going = state === 'going' || !reader.isOpen;
    const blend = going ? reader.openness : state === 'reading' ? 1 : smoothstep(0, 1, cover);
    motion.blend = ctx.still || going ? blend : motion.blend + (blend - motion.blend) * k;
    const turned = (coverLeaf.target === 1 ? 1 : 0) + reader.page / 2 + (backLeaf.target === 1 ? 1 : 0);
    const lean = zineLean(turned, book.dims.leaves + 2, t.lean, t.pointerLean, pointerSide(book));
    motion.lean = ctx.still ? lean : motion.lean + (lean - motion.lean) * k;
    book.lean = motion.lean * DEG;
    const shift = (opts.side?.() ?? 0) * book.dims.pageW * book.root.scale.x;
    motion.shift = ctx.still ? shift : motion.shift + (shift - motion.shift) * k;
    carry.blend = motion.blend;
    carry.shift = motion.shift;
    reader.carry = carry;
  };

  const unsub = ctx.onFrame('layout', (f) => {
    if (!out) return;
    const book = out.book;
    book.openAngle = t.open * DEG;
    const coming = state === 'coming' || state === 'lying' || state === 'reading';
    const before = p;
    p = ctx.still ? (coming ? 1 : 0) : stepPresence(p, coming, f.dt, { ...ZINE_POSE, flyRate: t.flyRate });

    // The reading place, as the reader will work it out, and the place to lie relative to it.
    const parent = engine.book(out.slug);
    const depth = parent ? parent.home.position.z : book.home.position.z;
    const at = (where = place(depth, book));
    const zRead = depth + at.readForward;
    const offset = opts.centreOffsetPx?.() ?? { x: 0, y: 0 };
    const perPx = ctx.visibleHeightAt(zRead) / Math.max(1, ctx.size.y);
    const turn = flyTurn(p, pose(at));
    book.home.position.set(offset.x * perPx - at.left + flyOffset(p, pose(at)), ctx.camera.position.y - offset.y * perPx + Number(ctx.registry.getParam('reader', 'rise') ?? 0) + t.lieUp, depth + at.forward);
    book.home.quaternion.setFromEuler(e.set(turn.pitch, turn.yaw, turn.roll));
    book.home.scale = at.scale;
    if (!book.held) {
      book.root.position.copy(book.home.position);
      book.root.quaternion.copy(book.home.quaternion);
      book.root.scale.setScalar(book.home.scale);
    }
    book.root.visible = p > ZINE_POSE.shown;

    if (holding()) steer(book, f.dt);
    let moving = holding() && (!coverLeaf.resting || !backLeaf.resting || Math.abs(motion.blend - Math.round(motion.blend)) > 1e-4);

    if (state === 'coming' && p >= 1) {
      lain = 0;
      set('lying');
    }
    if (state === 'lying' && pending !== null && !holding()) {
      lain += f.dt;
      if (lain >= t.linkWait || ctx.still) read(pending);
    }
    // Shut again and back where it lies: the reader lets it go. Nothing moves in that. A leaf of this paper creeps
    // down for seconds, so only its sheet is waited for, which lies down before it.
    if (state === 'lying' && holding() && reader.isOpen && coverLeaf.target === 0 && sheetTurn(coverLeaf.shown / Math.PI) <= 0 && motion.blend < LET_GO_BLEND) {
      ctx.registry.set('reader', 'coverSeconds', LET_GO);
      reader.close();
    }
    if (state === 'lying' && !holding() && saved) giveBack();
    // The reader was closed by someone else: by its bar, or by a key.
    if (state === 'reading' && (!holding() || !reader.isOpen) && !book.held) set('going');
    if (state === 'going' && !holding() && !book.held) {
      giveBack();
      if (p <= 0) hide();
    }
    moving ||= p !== before || state === 'coming' || state === 'going';
    if (moving) ctx.invalidate();
  });

  const ignore = opts.ignore ?? 'button, a, input, select, textarea, label, aside, header, footer, nav, [role="toolbar"], [role="dialog"]';
  const onDown = (ev: PointerEvent): void => {
    if (ev.button !== 0 || !ev.isPrimary) return;
    const closedOnBack = state === 'reading' && backLeaf.target === 1;
    if (state !== 'lying' && !closedOnBack) return;
    if (ev.target instanceof Element && ev.target.closest(ignore)) return;
    const box = rect();
    if (!box || ev.clientX < box[0] || ev.clientX > box[0] + box[2] || ev.clientY < box[1] || ev.clientY > box[1] + box[3]) return;
    // A press on the closed zine opens it: by its front cover, or by its back when it lies on its face.
    if (closedOnBack) toBack(false);
    else read();
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
      if (!out || state !== 'reading' || !holding()) return 1;
      return backLeaf.target === 1 ? zineLast(out.book.dims.leaves) : zineNumber(reader.page / 2);
    },
    get cover() {
      return coverLeaf.shown / Math.PI;
    },
    get onBack() {
      return !!out && state === 'reading' && backLeaf.target === 1;
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
      toBack(false);
      sendLeaf(coverLeaf, 0, t.coverKick);
      pending = null;
      lain = 0;
      set('lying');
    },
    back: toBack,
    close: () => {
      if (!out || state === 'away' || state === 'going') return;
      if (reader.book === out.book) {
        // The reader lets a book go with its cover: a quick cover, so the zine is gone as fast as it came.
        if (saved) ctx.registry.set('reader', 'coverSeconds', t.awaySeconds);
        reader.close();
      }
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
