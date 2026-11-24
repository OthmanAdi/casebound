/**
 * The marker: a pen for the pages of the open book. While it is on, a press on a page takes no leaf; it puts the
 * nib down, and the marks stay on that page through page turns, closing and coming back (SPEC S-RD-13).
 *
 * The marks themselves are data (see ink.ts). This unit owns the pointer while the pen is on, keeps one set of
 * marks per book, hands the reader their pictures as overlays, and saves them.
 */
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace } from 'three';
import type { Engine } from '../index';
import { tunable } from '../core/tune';
import type { Reader } from '../reader/reader';
import { INK_DEFAULT, InkBook, type InkData, type InkSurface } from './ink';

export interface Marker {
  readonly on: boolean;
  set(on: boolean): void;
  toggle(): boolean;
  /** The colours the pen comes in, as `#rrggbb`. */
  readonly colors: readonly string[];
  /** The colour in use. Setting one that is not in `colors` is allowed. */
  color: string;
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
  /** Ink colours. Default: yellow, green, pink, blue. */
  colors?: string[];
  /** A press that starts inside an element matching this selector never marks a page. */
  ignore?: string;
  /** Where marks are kept between visits. Default: the browser's local storage. Null: nowhere. */
  store?: MarkerStore | null;
  /** Called when the pen is taken up or put away. */
  onToggle?: (on: boolean) => void;
}

export const MARKER_COLORS = ['#ffe14a', '#8ee66b', '#ff8fc3', '#7cc7ff'];

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

/** A canvas to paint marks on, and the texture the page shader reads it through. */
function canvasSurface(width: number, height: number): CanvasSurface {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d')!;
  const texture = new CanvasTexture(canvas);
  // The colour is a multiplier and is written out as it is given, like the picture of the page under it.
  texture.colorSpace = NoColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 8;
  return {
    width,
    height,
    canvas,
    texture,
    clear: () => g.clearRect(0, 0, width, height),
    copy: (from) => g.drawImage((from as CanvasSurface).canvas, 0, 0),
    fill: (outlines, color, opacity) => {
      // The colour the paper is multiplied by: white where the ink is thin, the ink's own colour at full strength.
      const n = parseInt(color.slice(1), 16);
      const part = (shift: number): number => Math.round(255 - opacity * (255 - ((n >> shift) & 255)));
      g.fillStyle = `rgb(${part(16)}, ${part(8)}, ${part(0)})`;
      g.beginPath();
      for (const o of outlines) {
        g.moveTo(o[0]!, o[1]!);
        for (let i = 2; i < o.length; i += 2) g.lineTo(o[i]!, o[i + 1]!);
        g.closePath();
      }
      // One shape for the whole stroke, laid over what is there like a second layer of dye.
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
    label: 'Marker pen',
    kind: 'view',
    tags: ['interaction', 'paper', 'book'],
    describe: 'A pen for the pages of the open book. While it is on, a press on a page puts the nib down instead of taking the leaf. Marks stay on their page and are saved per book.',
    source: 'src/engine/marker/marker.ts',
    params: {
      width: { value: 0.021, min: 0.004, max: 0.08, help: 'Length of the nib as a share of the page height: the height of a band drawn across the page. About one line of print' },
      opacity: { value: INK_DEFAULT.opacity, min: 0.05, max: 1, help: 'How strongly the ink colours the paper. The print under it stays as dark as it was' },
      nibAngle: { value: INK_DEFAULT.nibAngle, min: -1.5, max: 1.5, unit: 'rad', help: 'Direction of the edge of the nib, from straight up the page toward the right' },
      resolution: { value: 1024, min: 256, max: 2048, step: 1, help: 'Height in pixels of the picture of marks a page gets. Read when a book is opened' },
    },
    onChange: () => {
      if (current) Object.assign(current.ink.tuning, { opacity: t.opacity, nibAngle: t.nibAngle });
    },
  });

  let on = false;
  let color = colors[0]!;
  /** The marks of every book that was open with the pen at hand. */
  const books = new Map<string, { ink: InkBook; surfaces: CanvasSurface[] }>();
  let current: { slug: string; ink: InkBook; surfaces: CanvasSurface[] } | null = null;
  /** The pointer that has the nib down, and the page that was marked last. */
  let drawing: number | null = null;
  let lastPage = 0;

  /** Makes the marks of the reader's book the current ones. */
  const follow = (): void => {
    const book = reader.book;
    const slug = book?.record.slug ?? null;
    if (slug === (current?.slug ?? null)) return;
    current?.ink.end();
    drawing = null;
    current = null;
    if (book && slug) {
      let entry = books.get(slug);
      if (!entry) {
        const surfaces: CanvasSurface[] = [];
        const ink = new InkBook(book.dims.pageW / book.dims.pageH, Math.round(t.resolution), (w, h) => {
          const s = canvasSurface(w, h);
          surfaces.push(s);
          return s;
        });
        Object.assign(ink.tuning, { opacity: t.opacity, nibAngle: t.nibAngle });
        ink.load(store?.load(slug) ?? null);
        entry = { ink, surfaces };
        books.set(slug, entry);
      }
      current = { slug, ...entry };
    }
    reader.refreshOverlays();
  };

  reader.overlay = (page) => (current?.ink.shown(page) as CanvasSurface | null)?.texture ?? null;
  const offView = ctx.events.on('view', follow);

  const save = (): void => {
    if (current) store?.save(current.slug, current.ink.toJSON());
  };

  /** Puts the nib down at a point of the window, or moves it there. Returns false where there is no page. */
  const touch = (x: number, y: number): boolean => {
    follow();
    if (!current) return false;
    const hit = reader.pageAt(x, y);
    if (!hit) return false;
    if (current.ink.drawing === hit.page) current.ink.move(hit.u, hit.v);
    else {
      // The first stroke on a page gives it a picture of marks: the reader has to be told once.
      if (current.ink.begin(hit.page, hit.u, hit.v, color, t.width)) reader.refreshOverlays();
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

  const onDown = (ev: PointerEvent): void => {
    if (!on || drawing !== null || ev.button !== 0 || !ev.isPrimary) return;
    if (ev.target instanceof Element && ev.target.closest(ignore)) return;
    if (!touch(ev.clientX, ev.clientY)) return;
    drawing = ev.pointerId;
    ev.preventDefault();
  };
  const onMove = (ev: PointerEvent): void => {
    if (drawing === null || ev.pointerId !== drawing) return;
    // Off the page the nib is up; back on a page it is down again.
    if (!touch(ev.clientX, ev.clientY)) lift();
  };
  const onUp = (ev: PointerEvent): void => {
    if (drawing === null || ev.pointerId !== drawing) return;
    drawing = null;
    lift();
  };
  window.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  const marker: Marker = {
    get on() {
      return on;
    },
    set: (next) => {
      if (next === on) return;
      on = next;
      reader.handsOff = on;
      if (!on) {
        drawing = null;
        lift();
      } else follow();
      opts.onToggle?.(on);
      ctx.invalidate();
    },
    toggle: () => {
      marker.set(!on);
      return on;
    },
    colors,
    get color() {
      return color;
    },
    set color(next: string) {
      if (/^#[0-9a-f]{6}$/i.test(next)) color = next;
    },
    undo: () => {
      follow();
      if (!current) return false;
      const pages = [lastPage, ...current.ink.marked.sort((a, b) => b - a)];
      for (const page of pages) {
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
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      reader.overlay = null;
      reader.refreshOverlays();
      for (const entry of books.values()) for (const s of entry.surfaces) s.texture.dispose();
      books.clear();
      ctx.registry.remove('marker');
    },
  };
  return marker;
}
