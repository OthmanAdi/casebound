/**
 * The marker: highlighter pens for the pages of the open book (SPEC S-RD-13). While a pen is out, a press on a
 * page takes no leaf; it puts the nib down, and the marks stay on that page through page turns, closing the book
 * and coming back.
 *
 * The marks are data (ink.ts), the pen is an object in the scene (pen.ts). This unit is the hand: it owns the
 * pointer while a pen is out, keeps one set of marks per book, hands the reader their pictures as overlays, and
 * saves them.
 */
import { CanvasTexture, LinearFilter, NoColorSpace } from 'three';
import type { Engine } from '../index';
import { tunable } from '../core/tune';
import type { Reader } from '../reader/reader';
import { INK_DEFAULT, InkBook, type InkData, type InkSurface } from './ink';
import { createPenObject, type PenColor, type PenHand } from './pen';
import { createScratch } from './scratch';

export type { PenColor } from './pen';

export interface Marker {
  /** True while a pen is out. */
  readonly on: boolean;
  /** Takes the pen that was used last, or puts the pen away. */
  set(on: boolean): void;
  toggle(): boolean;
  /** The pens there are. */
  readonly colors: readonly PenColor[];
  /** Name of the pen in use, or of the one that was used last. Setting it changes pens without taking one out. */
  color: string;
  /** What a click on a pen's place in its holder does: takes that pen, changes to it, or puts it back if it is the one that is out. */
  pick(name: string): void;
  /** Takes the last stroke off the page that was marked last. False when there is none. */
  undo(): boolean;
  /** Wipes one page of the open book, or all of them. */
  clear(page?: number): void;
  /** The marks of the open book as plain data, or null when no book is open. */
  marks(): InkData | null;
  dispose(): void;
}

export interface MarkerStore {
  load(slug: string): unknown;
  save(slug: string, data: InkData): void;
}

export interface MarkerOptions {
  /** The pens. Default: pink and yellow, as measured. The last one is the one a first `set(true)` takes. */
  colors?: PenColor[];
  /** A press that starts inside an element matching this selector never marks a page. */
  ignore?: string;
  /** Where marks are kept between visits. Default: the browser's local storage. Null: nowhere. */
  store?: MarkerStore | null;
  /** Called when a pen is taken, changed or put away. */
  onChange?: (on: boolean, color: PenColor) => void;
}

/**
 * The two pens of the reference: the colours of their parts as read there. The ink is set so that paper and
 * print under it come out as they do there: yellow takes paper from 190, 188, 185 to 186, 165, 82.
 */
export const MARKER_COLORS: PenColor[] = [
  { name: 'pink', body: '#ff5fa8', collar: '#e8458c', nib: '#ff8fc1', ink: '#e697c5', strength: 0.48 },
  { name: 'yellow', body: '#f4e400', collar: '#e6b800', nib: '#f0a83c', ink: '#f8d84e', strength: 0.8 },
];

/** Marks in the browser's local storage, one entry per book. Storage that is full or switched off is not an error. */
export const localMarks: MarkerStore = {
  load: (slug) => {
    try {
      const raw = localStorage.getItem(`casebound.marks.${slug}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  save: (slug, data) => {
    try {
      if (Object.keys(data).length) localStorage.setItem(`casebound.marks.${slug}`, JSON.stringify(data));
      else localStorage.removeItem(`casebound.marks.${slug}`);
    } catch {
      // Private windows and full storage: the marks last as long as the page does.
    }
  },
};

interface CanvasSurface extends InkSurface {
  readonly canvas: HTMLCanvasElement;
  readonly texture: CanvasTexture;
}

const channels = (color: string): [number, number, number] => {
  const n = parseInt(color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** A canvas to paint marks on, and the texture the page shader reads it through. */
function canvasSurface(width: number, height: number): CanvasSurface {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d')!;
  const texture = new CanvasTexture(canvas);
  // The colour is a multiplier and is written out as it is given, like the picture of the page under it.
  texture.colorSpace = NoColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  return {
    width,
    height,
    canvas,
    texture,
    clear: () => g.clearRect(0, 0, width, height),
    copy: (from) => g.drawImage((from as CanvasSurface).canvas, 0, 0),
    line: (curve, lineWidth, color, opacity) => {
      if (curve.length < 2) return;
      const [r, gr, b] = channels(color);
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.lineWidth = lineWidth;
      g.strokeStyle = g.fillStyle = `rgba(${r}, ${gr}, ${b}, ${opacity})`;
      g.beginPath();
      if (curve.length === 2) {
        // A press that has not moved yet: the round end of the nib alone.
        g.arc(curve[0]!, curve[1]!, lineWidth / 2, 0, Math.PI * 2);
        g.fill();
        return;
      }
      g.moveTo(curve[0]!, curve[1]!);
      for (let i = 2; i < curve.length; i += 6) g.bezierCurveTo(curve[i]!, curve[i + 1]!, curve[i + 2]!, curve[i + 3]!, curve[i + 4]!, curve[i + 5]!);
      // One stroke, one shape: where it crosses itself it is no darker. Over older ink it lies as a second layer.
      g.stroke();
    },
    fill: (outlines, color, opacity) => {
      // The colour the paper is multiplied by: white where the ink is thin, the ink's own colour at full strength.
      const mixed = channels(color).map((c) => Math.round(255 - opacity * (255 - c)));
      g.fillStyle = `rgb(${mixed[0]}, ${mixed[1]}, ${mixed[2]})`;
      g.beginPath();
      for (const o of outlines) {
        g.moveTo(o[0]!, o[1]!);
        for (let i = 2; i < o.length; i += 2) g.lineTo(o[i]!, o[i + 1]!);
        g.closePath();
      }
      g.globalCompositeOperation = 'multiply';
      g.fill('nonzero');
      g.globalCompositeOperation = 'source-over';
    },
    touch: () => {
      texture.needsUpdate = true;
    },
  };
}

export function createMarker(engine: Engine, reader: Reader, opts: MarkerOptions = {}): Marker {
  const { ctx } = engine;
  const colors = opts.colors?.length ? [...opts.colors] : [...MARKER_COLORS];
  const ignore = opts.ignore ?? 'button, a, input, select, textarea, label, aside, header, footer, nav, [role="toolbar"], [role="dialog"]';
  const store = opts.store === undefined ? localMarks : opts.store;
  const t = tunable(ctx.registry, {
    id: 'marker',
    label: 'Marker',
    kind: 'view',
    tags: ['interaction', 'paper', 'book'],
    describe: 'Highlighter pens for the pages of the open book. While one is out, a press on a page puts the nib down instead of taking the leaf. Marks stay on their page and are saved per book.',
    source: 'src/engine/marker/marker.ts',
    params: {
      width: { value: 0.024, min: 0.004, max: 0.08, help: 'Width of the line as a share of the page height: a band across the page is that high. Measured: 21 px of 1024, which is 1.17 lines of the reference print. Ours is 1.17 lines of our own print' },
      chisel: { value: 0, min: 0, max: 1, step: 1, help: '0: the round nib of the reference, a smooth line with round ends. 1: a chisel nib, whose stroke is a band across the page and a thin line along its edge' },
      nibAngle: { value: INK_DEFAULT.nibAngle, min: -1.5, max: 1.5, unit: 'rad', help: 'Chisel only: direction of the edge of the nib, from straight up the page toward the right' },
      dropTaps: { value: 1, min: 0, max: 1, step: 1, help: '1: a press that does not move leaves nothing, as measured. 0: it leaves a dot' },
      resolution: { value: 1024, min: 256, max: 2048, step: 1, help: 'Size in pixels of the square picture of marks a page gets. Read when a book is opened. Measured: 1024' },
      saveDelay: { value: 0.4, min: 0, max: 5, unit: 's', help: 'Time between the end of a stroke and the saving of the marks. Measured: 400 ms' },
      scratch: { value: 1, min: 0, max: 4, help: 'Loudness of the scratch of the nib on the paper, as a share of the measured one. 0: silent' },
    },
    onChange: () => {
      if (current) tune(current.ink);
    },
  });
  const tune = (ink: InkBook): void => {
    Object.assign(ink.tuning, { round: t.chisel < 0.5, nibAngle: t.nibAngle, dropTaps: t.dropTaps >= 0.5 });
  };

  let on = false;
  /** The pen in use, or the one used last. Measured: yellow before any choice. */
  let color = colors[colors.length - 1]!;
  /** The marks of every book that was open with a pen at hand. */
  const books = new Map<string, { ink: InkBook; surfaces: CanvasSurface[] }>();
  let current: { slug: string; ink: InkBook; surfaces: CanvasSurface[] } | null = null;
  /** The pointer that has the button down, and the page that was marked last. */
  let pressed: number | null = null;
  let lastPage = 0;
  let pointer: PenHand['pointer'] = null;
  let saving = 0;

  const hand = (): PenHand => ({ on, pressed: pressed !== null, color, pointer, width: t.width });
  const pen = createPenObject(engine, reader, hand);
  const scratch = createScratch();

  /** Makes the marks of the reader's book the current ones. */
  const follow = (): void => {
    // The reader keeps its book until the cover is shut, so the marks stay on the pages while it closes.
    const book = reader.book;
    const slug = book ? book.record.slug : null;
    if (slug === (current?.slug ?? null)) return;
    current?.ink.end();
    pressed = null;
    current = null;
    if (book && slug) {
      let entry = books.get(slug);
      if (!entry) {
        const surfaces: CanvasSurface[] = [];
        // Measured: a square picture stretched over the upright page, so the round nib is a little taller than wide.
        const ink = new InkBook(1, Math.round(t.resolution), (w, h) => {
          const s = canvasSurface(w, h);
          surfaces.push(s);
          return s;
        });
        tune(ink);
        ink.load(store?.load(slug) ?? null);
        entry = { ink, surfaces };
        books.set(slug, entry);
      }
      current = { slug, ...entry };
    }
    reader.refreshOverlays();
  };

  reader.overlay = (page) => (current?.ink.shown(page) as CanvasSurface | null)?.texture ?? null;
  const offView = ctx.events.on('view', () => {
    follow();
    // Measured: closing the book puts the pen away, and a book opens without it.
    if (on && !reader.isOpen) marker.set(false);
  });

  /** What is waiting to be saved. */
  let unsaved: (() => void) | null = null;
  const save = (): void => {
    clearTimeout(saving);
    const target = current;
    if (!target || !store) return;
    unsaved = () => {
      unsaved = null;
      store.save(target.slug, target.ink.toJSON());
    };
    saving = window.setTimeout(() => unsaved?.(), t.saveDelay * 1000);
  };
  /** The page is going away: what waits is saved now. */
  const flush = (): void => {
    clearTimeout(saving);
    unsaved?.();
  };
  window.addEventListener('pagehide', flush);

  /** Puts the nib down at a point of the window, or moves it there. Returns false where there is no page. */
  const touch = (x: number, y: number): boolean => {
    follow();
    if (!current) return false;
    const hit = reader.pageAt(x, y);
    if (!hit) return false;
    if (current.ink.drawing === hit.page) current.ink.move(hit.u, hit.v);
    else {
      // The first stroke on a page gives it a picture of marks: the reader has to be told once.
      if (current.ink.begin(hit.page, hit.u, hit.v, color.ink, t.width, color.strength)) reader.refreshOverlays();
      lastPage = hit.page;
    }
    ctx.invalidate();
    return true;
  };

  const lift = (): void => {
    if (!current || current.ink.drawing === null) return;
    current.ink.end();
    save();
    ctx.invalidate();
  };

  const blockedBy = (ev: PointerEvent): boolean => ev.target instanceof Element && !!ev.target.closest(ignore);

  // Presses are heard before anything else on the page, and kept from it only when they meet a page.
  const onDown = (ev: PointerEvent): void => {
    if (!on || pressed !== null || ev.button !== 0 || !ev.isPrimary) return;
    pointer = { x: ev.clientX, y: ev.clientY, blocked: blockedBy(ev) };
    if (pointer.blocked) return;
    pressed = ev.pointerId;
    if (touch(ev.clientX, ev.clientY)) {
      ev.stopPropagation();
      ev.preventDefault();
    }
    ctx.invalidate();
  };
  const onMove = (ev: PointerEvent): void => {
    if (!on) return;
    const before = pointer;
    pointer = { x: ev.clientX, y: ev.clientY, blocked: blockedBy(ev) };
    ctx.invalidate();
    if (pressed === null || ev.pointerId !== pressed) return;
    // Off the page the nib is up; back on a page it is down again, and a new stroke starts where it came back.
    if (touch(ev.clientX, ev.clientY)) scratch.stroke(Math.abs(ev.clientX - (before?.x ?? ev.clientX)), t.scratch);
    else lift();
  };
  const onUp = (ev: PointerEvent): void => {
    if (pressed === null || ev.pointerId !== pressed) return;
    pressed = null;
    lift();
    ctx.invalidate();
  };
  /** The mouse left the window: the pen is out of sight until it comes back. */
  const onLeave = (): void => {
    pointer = null;
    ctx.invalidate();
  };
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointermove', onMove, { capture: true, passive: true });
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onUp, true);
  document.documentElement.addEventListener('pointerleave', onLeave);

  const changed = (): void => {
    opts.onChange?.(on, color);
    ctx.invalidate();
  };

  const marker: Marker = {
    get on() {
      return on;
    },
    set: (next) => {
      next = next && reader.isOpen;
      if (next === on) return;
      on = next;
      reader.handsOff = on;
      if (on) {
        follow();
        // Until the pointer moves the pen stands where the pointer was seen last, or in the middle of the book.
        const rect = ctx.canvas.getBoundingClientRect();
        pointer ??= ctx.pointer ? { x: ctx.pointerPx.x, y: ctx.pointerPx.y, blocked: false } : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, blocked: false };
      } else {
        pressed = null;
        lift();
      }
      changed();
    },
    toggle: () => {
      marker.set(!on);
      return on;
    },
    colors,
    get color() {
      return color.name;
    },
    set color(name: string) {
      const found = colors.find((c) => c.name === name);
      if (!found || found === color) return;
      color = found;
      changed();
    },
    pick: (name) => {
      const found = colors.find((c) => c.name === name);
      if (!found) return;
      if (on && found === color) return marker.set(false);
      color = found;
      if (on) changed();
      else marker.set(true);
    },
    undo: () => {
      follow();
      if (!current) return false;
      for (const page of [lastPage, ...current.ink.marked.sort((a, b) => b - a)]) {
        if (page && current.ink.undo(page)) {
          save();
          ctx.invalidate();
          return true;
        }
      }
      return false;
    },
    clear: (page) => {
      follow();
      if (!current) return;
      current.ink.clear(page);
      save();
      ctx.invalidate();
    },
    marks: () => {
      follow();
      return current ? current.ink.toJSON() : null;
    },
    dispose: () => {
      marker.set(false);
      offView();
      flush();
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      pen.dispose();
      scratch.dispose();
      reader.overlay = null;
      reader.refreshOverlays();
      for (const entry of books.values()) for (const s of entry.surfaces) s.texture.dispose();
      books.clear();
      ctx.registry.remove('marker');
    },
  };
  return marker;
}
