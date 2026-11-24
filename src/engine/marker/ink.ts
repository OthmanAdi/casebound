/**
 * The marks a pen leaves on the pages of one book.
 *
 * A mark is a stroke: the path of the nib across one page, in the page's own picture space (u from the left edge,
 * v from the foot, both 0 to 1). Each page that carries strokes has a picture of them the size of a painted page;
 * the reader lays it over the print (see `Reader.overlay`). The strokes themselves are plain data, so marks can
 * be saved, loaded and drawn again at another size.
 *
 * Two nibs. The round one is the reference's (SPEC S-RD-13): a line as wide as one line of print is high, with
 * round ends, drawn through the points of the hand as a smooth curve. The chisel is ours: a short straight edge
 * that keeps its direction while the hand moves, so a stroke across the page is a band and a stroke along the
 * edge a thin line. Either way a stroke is drawn as one shape, no darker where it crosses itself, and two strokes
 * that cross are darker there, as two layers of ink are.
 */
import { clamp } from '../core/math';

export interface Stroke {
  /** Ink colour as `#rrggbb`. */
  color: string;
  /** Width of the line, or the length of a chisel's edge, as a share of the height of the picture. */
  width: number;
  /** How strongly this ink colours the paper, 0 to 1. Default: the tuning's `opacity`. */
  strength?: number;
  /** The path of the middle of the nib: u, v, u, v ... */
  points: number[];
}

/** What a page of strokes is painted on: a 2D canvas context, or anything that draws like one. */
export interface InkSurface {
  readonly width: number;
  readonly height: number;
  clear(): void;
  /** Lays the finished strokes under the one being drawn. */
  copy(from: InkSurface): void;
  /** Fills closed outlines as one shape. Each outline is x, y, x, y ... in pixels, all wound the same way. */
  fill(outlines: number[][], color: string, opacity: number): void;
  /**
   * Draws one line with round ends and joins through a curve: its start x, y, then for every step the two handles
   * and the end of a cubic, six numbers. A curve of a start alone is a dot.
   */
  line(curve: number[], width: number, color: string, opacity: number): void;
  /** Called after painting, so a texture made from the surface can be sent to the GPU again. */
  touch(): void;
}

export interface InkTuning {
  /** True: the round nib of the reference. False: the chisel. */
  round: boolean;
  /** A stroke of a single point, a press without a move, leaves nothing. */
  dropTaps: boolean;
  /** Round nib: the longest a curve's handle may be, as a share of its step. */
  smooth: number;
  /** Round nib: where the path turns by more than `cornerFrom` radians the handles are shortened, by up to `cornerCut` of their length. */
  cornerFrom: number;
  cornerCut: number;
  /** How strongly the ink colours the paper, 0 to 1. The print under it stays as dark as it was. */
  opacity: number;
  /** Direction of the nib's edge, radians from straight up the page, turning toward the right. */
  nibAngle: number;
  /** Thickness of the nib across its edge, as a share of its length: the width of a line drawn along the edge. */
  nibThin: number;
  /** A new point nearer than this to the last one, as a share of the height of the picture, is dropped. Measured: half a pixel of 1024. */
  step: number;
}

export const INK_DEFAULT: InkTuning = { round: true, dropTaps: true, smooth: 0.45, cornerFrom: (36 * Math.PI) / 180, cornerCut: 0.65, opacity: 0.6, nibAngle: 0.26, nibThin: 0.16, step: 0.5 / 1024 };

/**
 * The curve a round nib draws through the points of a stroke, in pixels of a picture `width` by `height`: the
 * start, then two handles and an end per step. Read on the reference: a handle points along the chord between
 * the two neighbours of its point and is a sixth of it long, never longer than `smooth` of its own step, and
 * shorter where the path turns sharply, so a corner stays a corner. Past the last point the path is taken to go
 * straight on.
 */
export function strokeCurve(stroke: Stroke, width: number, height: number, t: InkTuning = INK_DEFAULT): number[] {
  const p = stroke.points;
  const n = p.length / 2;
  const x = (i: number): number => p[i * 2]! * width;
  const y = (i: number): number => (1 - p[i * 2 + 1]!) * height;
  if (n < 1) return [];
  const out = [x(0), y(0)];
  // A point before the first and after the last, mirrored through the end.
  const px = (i: number): number => (i < 0 ? 2 * x(0) - x(1) : i >= n ? 2 * x(n - 1) - x(n - 2) : x(i));
  const py = (i: number): number => (i < 0 ? 2 * y(0) - y(1) : i >= n ? 2 * y(n - 1) - y(n - 2) : y(i));
  /** How much of a handle is left at point i, by how sharply the path turns there. */
  const kept = (i: number): number => {
    if (i <= 0 || i >= n - 1) return 1;
    const ax = x(i) - x(i - 1), ay = y(i) - y(i - 1);
    const bx = x(i + 1) - x(i), by = y(i + 1) - y(i);
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la < 1e-9 || lb < 1e-9) return 1;
    const turn = Math.acos(clamp((ax * bx + ay * by) / (la * lb), -1, 1));
    return 1 - t.cornerCut * clamp((turn - t.cornerFrom) / (Math.PI - t.cornerFrom), 0, 1);
  };
  for (let i = 0; i < n - 1; i++) {
    const step = Math.hypot(x(i + 1) - x(i), y(i + 1) - y(i));
    const limit = t.smooth * step;
    const handle = (hx: number, hy: number, keep: number): [number, number] => {
      const len = Math.hypot(hx, hy);
      const k = (len > limit && len > 0 ? limit / len : 1) * keep;
      return [hx * k, hy * k];
    };
    const [ax, ay] = handle((px(i + 1) - px(i - 1)) / 6, (py(i + 1) - py(i - 1)) / 6, kept(i));
    const [bx, by] = handle((px(i + 2) - px(i)) / 6, (py(i + 2) - py(i)) / 6, kept(i + 1));
    out.push(x(i) + ax, y(i) + ay, x(i + 1) - bx, y(i + 1) - by, x(i + 1), y(i + 1));
  }
  return out;
}

/** Twice the signed area of a closed outline. Positive: wound counter-clockwise in a frame with y up. */
const area2 = (o: number[]): number => {
  let sum = 0;
  for (let i = 0; i < o.length; i += 2) {
    const j = (i + 2) % o.length;
    sum += o[i]! * o[j + 1]! - o[j]! * o[i + 1]!;
  }
  return sum;
};

/** The same outline, wound so that its area is positive. Outlines wound alike fill as one shape. */
const wound = (o: number[]): number[] => {
  if (area2(o) >= 0) return o;
  const back: number[] = [];
  for (let i = o.length - 2; i >= 0; i -= 2) back.push(o[i]!, o[i + 1]!);
  return back;
};

/**
 * The shape a stroke leaves, as closed outlines in pixels of a picture `width` by `height`. One outline per
 * segment of the path, the band the nib's edge sweeps, and one for the nib itself at every point, which closes
 * the joints and gives a stroke of a single point a shape. Pixels have y down; v has it up.
 */
export function strokeOutlines(stroke: Stroke, width: number, height: number, t: InkTuning = INK_DEFAULT): number[][] {
  const half = (stroke.width * height) / 2;
  const thin = half * t.nibThin;
  // The edge of the nib and the direction across it, in pixels.
  const ex = Math.sin(t.nibAngle) * half;
  const ey = -Math.cos(t.nibAngle) * half;
  const ax = Math.cos(t.nibAngle) * thin;
  const ay = Math.sin(t.nibAngle) * thin;
  const out: number[][] = [];
  const p = stroke.points;
  const at = (i: number): [number, number] => [p[i]! * width, (1 - p[i + 1]!) * height];
  for (let i = 0; i < p.length; i += 2) {
    const [x, y] = at(i);
    out.push(wound([x - ex - ax, y - ey - ay, x + ex - ax, y + ey - ay, x + ex + ax, y + ey + ay, x - ex + ax, y - ey + ay]));
    if (i + 2 < p.length) {
      const [nx, ny] = at(i + 2);
      out.push(wound([x - ex, y - ey, x + ex, y + ey, nx + ex, ny + ey, nx - ex, ny - ey]));
    }
  }
  return out;
}

/** Adds a point to a stroke unless it lies too near the last one. Returns true when it was added. */
export function extendStroke(stroke: Stroke, u: number, v: number, aspect: number, t: InkTuning = INK_DEFAULT): boolean {
  const p = stroke.points;
  const cu = clamp(u, 0, 1);
  const cv = clamp(v, 0, 1);
  if (p.length >= 2) {
    // Distances in shares of the page height: u covers `aspect` of it.
    const du = (cu - p[p.length - 2]!) * aspect;
    const dv = cv - p[p.length - 1]!;
    if (Math.hypot(du, dv) < t.step) return false;
  }
  p.push(cu, cv);
  return true;
}

/** The marks of one book as plain data: strokes by page number. */
export type InkData = Record<string, Stroke[]>;

interface PageInk {
  strokes: Stroke[];
  /** The finished strokes, and those with the one being drawn on top: the picture the page shows. */
  base: InkSurface;
  shown: InkSurface;
}

export class InkBook {
  tuning: InkTuning = { ...INK_DEFAULT };
  private readonly pages = new Map<number, PageInk>();
  private live: { page: number; stroke: Stroke } | null = null;

  /**
   * @param aspect width of a page over its height
   * @param height height of a page's picture of marks in pixels
   * @param surface makes a surface to paint on
   */
  constructor(
    readonly aspect: number,
    readonly height: number,
    private readonly surface: (width: number, height: number) => InkSurface,
  ) {}

  /** The pages that carry marks. */
  get marked(): number[] {
    return [...this.pages.entries()].filter(([page, ink]) => ink.strokes.length > 0 || this.live?.page === page).map(([page]) => page);
  }

  /** The picture of the marks on a page, or null for a page without any. */
  shown(page: number): InkSurface | null {
    return this.pages.get(page)?.shown ?? null;
  }

  strokes(page: number): readonly Stroke[] {
    return this.pages.get(page)?.strokes ?? [];
  }

  private page(page: number): PageInk {
    let ink = this.pages.get(page);
    if (!ink) {
      const width = Math.max(1, Math.round(this.height * this.aspect));
      ink = { strokes: [], base: this.surface(width, this.height), shown: this.surface(width, this.height) };
      this.pages.set(page, ink);
    }
    return ink;
  }

  private paint(stroke: Stroke, onto: InkSurface): void {
    const strength = stroke.strength ?? this.tuning.opacity;
    if (this.tuning.round) onto.line(strokeCurve(stroke, onto.width, onto.height, this.tuning), stroke.width * onto.height, stroke.color, strength);
    else onto.fill(strokeOutlines(stroke, onto.width, onto.height, this.tuning), stroke.color, strength);
  }

  /** Paints the finished strokes of a page again, and the one being drawn over them. */
  private redraw(page: number): void {
    const ink = this.pages.get(page);
    if (!ink) return;
    ink.base.clear();
    for (const stroke of ink.strokes) this.paint(stroke, ink.base);
    ink.base.touch();
    this.show(page);
  }

  private show(page: number): void {
    const ink = this.pages.get(page);
    if (!ink) return;
    ink.shown.clear();
    ink.shown.copy(ink.base);
    if (this.live && this.live.page === page) this.paint(this.live.stroke, ink.shown);
    ink.shown.touch();
  }

  /** Puts the nib down on a page. Returns true when the page had no picture of marks before: its overlay is new. */
  begin(page: number, u: number, v: number, color: string, width: number, strength?: number): boolean {
    this.end();
    const fresh = !this.pages.has(page);
    this.page(page);
    this.live = { page, stroke: strength === undefined ? { color, width, points: [] } : { color, width, strength, points: [] } };
    extendStroke(this.live.stroke, u, v, this.aspect, this.tuning);
    this.show(page);
    return fresh;
  }

  /** Moves the nib on the page it is on. */
  move(u: number, v: number): void {
    if (!this.live) return;
    if (extendStroke(this.live.stroke, u, v, this.aspect, this.tuning)) this.show(this.live.page);
  }

  /** The page the nib is on, or null. */
  get drawing(): number | null {
    return this.live ? this.live.page : null;
  }

  /** Lifts the nib: the stroke is finished. */
  end(): void {
    if (!this.live) return;
    const { page, stroke } = this.live;
    this.live = null;
    const ink = this.page(page);
    // Measured: a press that did not move leaves nothing, so a stray click never dirties a page.
    if (!(this.tuning.dropTaps && stroke.points.length < 4)) {
      ink.strokes.push(stroke);
      this.paint(stroke, ink.base);
      ink.base.touch();
    }
    this.show(page);
  }

  /** Takes the last stroke of a page away. Returns false when there was none. */
  undo(page: number): boolean {
    const ink = this.pages.get(page);
    if (!ink || !ink.strokes.length) return false;
    ink.strokes.pop();
    this.redraw(page);
    return true;
  }

  /** Wipes one page, or every page. */
  clear(page?: number): void {
    this.live = null;
    for (const [n, ink] of this.pages) {
      if (page !== undefined && n !== page) continue;
      ink.strokes = [];
      this.redraw(n);
    }
  }

  toJSON(): InkData {
    const data: InkData = {};
    for (const [page, ink] of this.pages) {
      if (!ink.strokes.length) continue;
      data[String(page)] = ink.strokes.map((s) => ({ color: s.color, width: s.width, ...(s.strength === undefined ? {} : { strength: s.strength }), points: s.points.map((n) => Math.round(n * 1e4) / 1e4) }));
    }
    return data;
  }

  /** Replaces all marks with saved ones. Anything that is not a stroke is left out. */
  load(data: unknown): void {
    this.live = null;
    for (const ink of this.pages.values()) ink.strokes = [];
    if (data && typeof data === 'object') {
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        const page = Number(key);
        if (!Number.isInteger(page) || page < 1 || !Array.isArray(value)) continue;
        const strokes = value.filter(
          (s): s is Stroke =>
            !!s && typeof s === 'object' && typeof (s as Stroke).color === 'string' && /^#[0-9a-f]{6}$/i.test((s as Stroke).color) && Number.isFinite((s as Stroke).width) && Array.isArray((s as Stroke).points) && (s as Stroke).points.length >= 2 && (s as Stroke).points.length % 2 === 0 && (s as Stroke).points.every((n) => Number.isFinite(n)),
        );
        if (strokes.length) {
          this.page(page).strokes = strokes.map((s) => ({
            color: s.color,
            width: clamp(s.width, 0.001, 0.2),
            ...(Number.isFinite(s.strength) ? { strength: clamp(s.strength!, 0, 1) } : {}),
            points: s.points.map((n) => clamp(n, 0, 1)),
          }));
        }
      }
    }
    for (const page of this.pages.keys()) this.redraw(page);
  }
}
