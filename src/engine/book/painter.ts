/**
 * Everything a book shows is painted here, in code: the cover atlas (colour, emboss height, foil mask),
 * the tiled cloth and paper grain, the page-edge stripes, the endpapers and the pages. No image files.
 * A book's look comes from its `CoverDesign`, so a new book is a few lines of data.
 */
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { hashString, seeded } from '../core/math';
import { GRAIN_TILE } from './surface';
import { EDGE_TEXTURE_LEAVES } from './volume';

export type Grain = 'buckram' | 'paper' | 'cardboard';
export type CoverPattern = 'plain' | 'marble' | 'rules' | 'grid' | 'rays' | 'strata' | 'dots';

export interface CoverDesign {
  /** Cloth or paper colour of the case. */
  cloth: string;
  /** Colour of printed type and ornaments. */
  ink: string;
  /** Second colour for patterns. */
  accent?: string;
  pattern?: CoverPattern;
  /** Foil for the title: a colour, or "none". */
  foil?: string;
  /** 0 = plain metal foil, 1 = iridescent. */
  foilRainbow?: number;
  grain?: Grain;
  /** Seed for the generated pattern. Defaults to a hash of the title. */
  seed?: number;
}

export interface CoverText {
  title: string;
  subtitle?: string;
  author: string;
  /** Short imprint mark for the foot of the spine and the back cover. */
  imprint?: string;
}

export interface AtlasLayout {
  back: [number, number];
  spine: [number, number];
  front: [number, number];
  /** Width divided by height of the whole strip. */
  aspect: number;
}

export interface CoverTextures {
  map: Texture;
  emboss: Texture;
  finish: Texture;
}

/**
 * Shape of the relief that is painted into a cover: the walls of stamped type. The engine registers these as
 * `book.relief`; changing one repaints the covers.
 */
export interface CoverRelief {
  /** How far type is pressed in, as a share of the relief map's range below the level of the cloth. Range 0 to 0.5. Ornaments go 0.65 as deep. */
  press: number;
  /** Half width of the wall of a stamped letter, in texels of a relief map 2048 wide (one texel is about 0.014 world units). Range 0.6 to 6. */
  wall: number;
}

/**
 * Defaults. Measured on stamped type at shelf distance: on a spine the lit wall is 21 to 27 percent brighter than
 * the cloth and the shaded wall 11 to 17 percent darker, on a front cover 5 to 8 and 7 to 13, each about two
 * pixels wide.
 */
export const COVER_RELIEF: Readonly<CoverRelief> = { press: 0.36, wall: 1.5 };

/** A grey for the relief map: 0.5 is the level of the cloth, lower is pressed in. */
export const reliefLevel = (height: number): string => {
  const v = Math.round(Math.max(0, Math.min(1, height)) * 255);
  return `rgb(${v},${v},${v})`;
};

export interface Typefaces {
  display: string;
  text: string;
  mono: string;
}

export const DEFAULT_FACES: Typefaces = {
  display: '"Newsreader Variable", "Newsreader", "Iowan Old Style", Georgia, serif',
  text: '"Newsreader Variable", "Newsreader", Georgia, serif',
  mono: '"IBM Plex Mono", ui-monospace, Consolas, monospace',
};

const canvas = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(w));
  c.height = Math.max(2, Math.round(h));
  const g = c.getContext('2d');
  if (!g) throw new Error('casebound: 2D canvas is not available');
  return [c, g];
};

const texture = (c: HTMLCanvasElement, opts: { repeat?: boolean; srgb?: boolean; anisotropy?: number } = {}): CanvasTexture => {
  const t = new CanvasTexture(c);
  t.colorSpace = opts.srgb ? SRGBColorSpace : NoColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = opts.anisotropy ?? 8;
  if (opts.repeat) t.wrapS = t.wrapT = RepeatWrapping;
  t.needsUpdate = true;
  return t;
};

/** Breaks a title into lines no wider than the box, largest type size first. */
function fitLines(g: CanvasRenderingContext2D, text: string, font: (px: number) => string, maxW: number, maxH: number, startPx: number, lineH = 1.04): { px: number; lines: string[] } {
  const words = text.split(/\s+/).filter(Boolean);
  for (let px = startPx; px > 12; px -= Math.max(2, Math.round(px * 0.04))) {
    g.font = font(px);
    const lines: string[] = [];
    let line = '';
    let ok = true;
    for (const w of words) {
      const next = line ? line + ' ' + w : w;
      if (g.measureText(next).width <= maxW) line = next;
      else {
        if (!line || g.measureText(w).width > maxW) {
          ok = false;
          break;
        }
        lines.push(line);
        line = w;
      }
    }
    if (line) lines.push(line);
    if (ok && lines.length * px * lineH <= maxH) return { px, lines };
  }
  g.font = font(14);
  return { px: 14, lines: [text] };
}

function drawPattern(g: CanvasRenderingContext2D, pattern: CoverPattern, x: number, y: number, w: number, h: number, ink: string, accent: string, rnd: () => number): void {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.strokeStyle = ink;
  g.fillStyle = accent;
  switch (pattern) {
    case 'marble': {
      // Combed marbling: nested teardrop bands fanned from the foot of the board.
      const cx = x + w * (0.35 + rnd() * 0.3);
      const cy = y + h * 1.02;
      for (let i = 46; i > 0; i--) {
        const r = (i / 46) * h * 1.15;
        g.beginPath();
        g.ellipse(cx + Math.sin(i * 0.7) * w * 0.035, cy, r * 0.56, r, 0, Math.PI, 0);
        g.fillStyle = i % 3 === 0 ? accent : i % 3 === 1 ? ink : 'rgba(0,0,0,0.22)';
        g.globalAlpha = 0.32 + 0.5 * rnd();
        g.fill();
      }
      g.globalAlpha = 0.55;
      g.lineWidth = Math.max(1, w * 0.0025);
      for (let i = 0; i < 28; i++) {
        const a = Math.PI * (1 + (i + 0.5) / 28);
        g.beginPath();
        g.moveTo(cx, cy);
        g.quadraticCurveTo(cx + Math.cos(a) * h * 0.5, cy + Math.sin(a) * h * 0.7, cx + Math.cos(a) * h * 1.1 + (rnd() - 0.5) * w * 0.1, cy + Math.sin(a) * h * 1.25);
        g.stroke();
      }
      break;
    }
    case 'rules': {
      g.globalAlpha = 0.85;
      const m = w * 0.07;
      g.lineWidth = Math.max(2, w * 0.006);
      g.strokeRect(x + m, y + m, w - 2 * m, h - 2 * m);
      g.lineWidth = Math.max(1, w * 0.002);
      g.strokeRect(x + m * 1.35, y + m * 1.35, w - 2.7 * m, h - 2.7 * m);
      break;
    }
    case 'grid': {
      g.globalAlpha = 0.22;
      g.lineWidth = Math.max(1, w * 0.002);
      const step = w / (9 + Math.floor(rnd() * 6));
      for (let gx = x + step / 2; gx < x + w; gx += step) {
        g.beginPath();
        g.moveTo(gx, y);
        g.lineTo(gx, y + h);
        g.stroke();
      }
      for (let gy = y + step / 2; gy < y + h; gy += step) {
        g.beginPath();
        g.moveTo(x, gy);
        g.lineTo(x + w, gy);
        g.stroke();
      }
      break;
    }
    case 'rays': {
      const cx = x + w * (0.2 + rnd() * 0.6);
      const cy = y + h * (0.62 + rnd() * 0.2);
      g.globalAlpha = 0.5;
      const n = 40 + Math.floor(rnd() * 30);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        g.lineWidth = Math.max(1, w * (0.0015 + 0.003 * rnd()));
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * w * 0.07, cy + Math.sin(a) * w * 0.07);
        g.lineTo(cx + Math.cos(a) * h * 1.4, cy + Math.sin(a) * h * 1.4);
        g.stroke();
      }
      g.globalAlpha = 0.9;
      g.beginPath();
      g.arc(cx, cy, w * 0.055, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'strata': {
      // Layered ridgelines.
      const layers = 6 + Math.floor(rnd() * 4);
      for (let i = 0; i < layers; i++) {
        const base = y + h * (0.45 + (i / layers) * 0.55);
        g.beginPath();
        g.moveTo(x, y + h);
        g.lineTo(x, base);
        let px = x;
        let py = base;
        while (px < x + w) {
          px += w * (0.03 + rnd() * 0.07);
          py = base + (rnd() - 0.5) * h * 0.09;
          g.lineTo(px, py);
        }
        g.lineTo(x + w, y + h);
        g.closePath();
        g.globalAlpha = 0.18 + (i / layers) * 0.5;
        g.fillStyle = i % 2 ? accent : ink;
        g.fill();
      }
      break;
    }
    case 'dots': {
      g.globalAlpha = 0.55;
      const step = w / 14;
      for (let gy = y + step; gy < y + h; gy += step) {
        for (let gx = x + step; gx < x + w; gx += step) {
          g.beginPath();
          g.arc(gx, gy, step * (0.08 + 0.22 * rnd()), 0, Math.PI * 2);
          g.fill();
        }
      }
      break;
    }
    case 'plain':
      break;
  }
  g.restore();
}

/**
 * Paints the full case as one strip: back cover, spine, front cover, left to right, as a printer lays it out.
 * Returns colour, emboss height and foil mask, all on the same layout.
 */
export function paintCover(design: CoverDesign, text: CoverText, layout: AtlasLayout, faces: Typefaces = DEFAULT_FACES, width = 2048, relief: CoverRelief = COVER_RELIEF): CoverTextures {
  const W = width;
  const H = Math.round(W / layout.aspect);
  const [cc, g] = canvas(W, H);
  const [ec, e] = canvas(W, H);
  const [fc, f] = canvas(W, H);
  const rnd = seeded(design.seed ?? hashString(text.title));
  const accent = design.accent ?? design.ink;
  const foil = design.foil && design.foil !== 'none';

  g.fillStyle = design.cloth;
  g.fillRect(0, 0, W, H);
  e.fillStyle = '#808080';
  e.fillRect(0, 0, W, H);
  f.fillStyle = '#000';
  f.fillRect(0, 0, W, H);

  const span = (r: [number, number]): [number, number] => [r[0] * W, (r[1] - r[0]) * W];
  const [bx, bw] = span(layout.back);
  const [sx, sw] = span(layout.spine);
  const [fx, fw] = span(layout.front);

  drawPattern(g, design.pattern ?? 'plain', fx, 0, fw, H, design.ink, accent, rnd);
  // A printed ornament is stamped too, a little shallower than the title. Marbled paper stays flat.
  // The same seed draws the same lines into the relief.
  if (design.pattern && design.pattern !== 'plain' && design.pattern !== 'marble') {
    const shallow = reliefLevel(0.5 - relief.press * 0.65);
    drawPattern(e, design.pattern, fx, 0, fw, H, shallow, shallow, seeded(design.seed ?? hashString(text.title)));
  }
  drawPattern(g, design.pattern === 'marble' ? 'marble' : 'plain', bx, 0, bw, H, design.ink, accent, rnd);

  // Text is drawn three times: ink on the colour map, pressed into the emboss map, solid on the foil mask.
  // A stamped title sits below the cloth around it, so the light catches the far wall of every letter.
  const layers: [CanvasRenderingContext2D, string][] = [[g, foil ? design.cloth : design.ink], [e, reliefLevel(0.5 - relief.press)], [f, '#ffffff']];
  const drawText = (fn: (c: CanvasRenderingContext2D) => void, withFoil = true): void => {
    for (const [c, style] of layers) {
      if (c === f && !(foil && withFoil)) continue;
      c.save();
      c.fillStyle = c === g && !withFoil ? design.ink : style;
      c.strokeStyle = c.fillStyle;
      c.textBaseline = 'alphabetic';
      fn(c);
      c.restore();
    }
  };

  // Front cover: title block in the upper part, author at the foot.
  const m = fw * 0.11;
  const titleFont = (px: number): string => `500 ${px}px ${faces.display}`;
  const fit = fitLines(g, text.title, titleFont, fw - 2 * m, H * 0.4, Math.round(fw * 0.17));
  drawText((c) => {
    c.font = titleFont(fit.px);
    c.textAlign = 'left';
    fit.lines.forEach((line, i) => c.fillText(line, fx + m, H * 0.2 + (i + 1) * fit.px * 1.04));
  });
  if (text.subtitle) {
    const sub = fitLines(g, text.subtitle, (px) => `400 italic ${px}px ${faces.text}`, fw - 2 * m, H * 0.12, Math.round(fw * 0.045), 1.25);
    drawText((c) => {
      c.font = `400 italic ${sub.px}px ${faces.text}`;
      c.textAlign = 'left';
      const y0 = H * 0.2 + fit.lines.length * fit.px * 1.04 + sub.px * 1.6;
      sub.lines.forEach((line, i) => c.fillText(line, fx + m, y0 + i * sub.px * 1.25));
    }, false);
  }
  drawText((c) => {
    c.font = `400 ${Math.round(fw * 0.052)}px ${faces.text}`;
    c.textAlign = 'left';
    c.fillText(text.author, fx + m, H - m * 1.1);
  }, false);

  // Spine: title reading down, author at the head, imprint at the foot.
  const spineTitle = (c: CanvasRenderingContext2D): void => {
    c.translate(sx + sw / 2, H * 0.14);
    c.rotate(Math.PI / 2);
    const max = H * 0.6;
    let px = Math.round(sw * 0.42);
    c.font = `500 ${px}px ${faces.display}`;
    while (c.measureText(text.title).width > max && px > 10) {
      px -= 2;
      c.font = `500 ${px}px ${faces.display}`;
    }
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText(text.title, 0, 0);
  };
  drawText(spineTitle);
  drawText((c) => {
    c.translate(sx + sw / 2, H * 0.14 + H * 0.64);
    c.rotate(Math.PI / 2);
    c.font = `400 italic ${Math.round(sw * 0.26)}px ${faces.text}`;
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText(text.author, 0, 0, H * 0.18);
  }, false);
  drawText((c) => {
    const r = sw * 0.2;
    c.lineWidth = Math.max(2, sw * 0.03);
    c.beginPath();
    c.arc(sx + sw / 2, H - r * 3.2, r, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.arc(sx + sw / 2, H - r * 3.2, r * 0.35, 0, Math.PI * 2);
    c.fill();
  });

  // Back cover: a small imprint line at the foot.
  drawText((c) => {
    c.font = `500 ${Math.round(bw * 0.03)}px ${faces.mono}`;
    c.textAlign = 'left';
    c.fillText((text.imprint ?? 'CASEBOUND').toUpperCase(), bx + bw * 0.11, H - bw * 0.12);
  }, false);

  // The joints, where each board meets the spine, are not painted: the surface computes their relief (see JOINT
  // in surface.ts), so the lights shade them at any size.

  // A stamp has a wall, not a step: the blur gives it its width. The texture's own smaller copies keep it from
  // flickering when the book is far away.
  const [bc, b] = canvas(W, H);
  b.filter = `blur(${(Math.max(0.3, relief.wall) * W) / 2048}px)`;
  b.drawImage(ec, 0, 0);

  return { map: texture(cc, { anisotropy: 16 }), emboss: texture(bc, { anisotropy: 4 }), finish: texture(fc, { anisotropy: 4 }) };
}

const grainCache = new Map<string, CanvasTexture>();

/** Texels from one thread of the weave to the next. */
export const WEAVE_PERIOD = 8;

/**
 * How much higher the crown of a warp thread stands than that of a weft thread, as a share of the height range.
 * Range 0 to 0.4. This is what is left of a weave from across the room: where the threads themselves are too
 * fine to see, the crossings still alternate in height, and the lights show them as a lattice with a period of
 * two threads (measured: 0.10 to 0.14 world units on cloth spines).
 */
export const WEAVE_CRIMP = 0.2;

/**
 * Height of a plain weave at a texel, from 0.35 in the gaps to 0.95 on the crown of a warp thread. Each crossing
 * is a ridge along the thread that lies on top, and the thread on top alternates from crossing to crossing.
 */
export function weaveHeight(x: number, y: number, crimp = WEAVE_CRIMP): number {
  const p = WEAVE_PERIOD;
  const u = (((x % p) + p) % p) / p;
  const v = (((y % p) + p) % p) / p;
  const warpOnTop = (Math.floor(x / p) + Math.floor(y / p)) % 2 === 0;
  const across = Math.sin(Math.PI * (warpOnTop ? u : v));
  const along = 0.6 + 0.4 * Math.sin(Math.PI * (warpOnTop ? v : u));
  return 0.35 + (warpOnTop ? 0.6 : 0.6 - crimp) * across * along;
}

/** Tiled height map of the binding material. Bright = thread, dark = gap. */
export function grainTexture(kind: Grain, size = kind === 'buckram' ? GRAIN_TILE * 2 : GRAIN_TILE): CanvasTexture {
  const hit = grainCache.get(kind + size);
  if (hit) return hit;
  const [c, g] = canvas(size, size);
  const img = g.createImageData(size, size);
  const rnd = seeded(hashString(kind));
  const jitter = new Float32Array(size * size);
  for (let i = 0; i < jitter.length; i++) jitter[i] = rnd();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let h: number;
      const n = jitter[y * size + x]!;
      if (kind === 'buckram') {
        // Plain weave, with a little unevenness from thread to thread.
        h = weaveHeight(x, y) * 0.9 + n * 0.1;
      } else if (kind === 'cardboard') {
        h = 0.55 + 0.25 * Math.sin((y / size) * Math.PI * 2 * 24) * 0.3 + (n - 0.5) * 0.5;
      } else {
        // Paper: fine fibre noise, slightly longer along x.
        const a = jitter[y * size + ((x + 1) % size)]!;
        const b = jitter[y * size + ((x + 2) % size)]!;
        h = 0.5 + ((n + a + b) / 3 - 0.5) * 0.9;
      }
      const o = (y * size + x) * 4;
      const val = Math.max(0, Math.min(255, Math.round(h * 255)));
      img.data[o] = img.data[o + 1] = img.data[o + 2] = val;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = texture(c, { repeat: true, anisotropy: 4 });
  grainCache.set(kind + size, t);
  return t;
}

/**
 * How many times the grain tile repeats across one world unit of surface. Measured on cloth spines facing the
 * camera: the weave shows as a lattice with a period of 0.10 to 0.14 world units, three to four pixels across
 * the room. That period is two threads, and a buckram tile holds 64 threads, so it spans 3.8 units. Paper and
 * board have no period; their tiles are as fine as the measured maps, about 77 texels to the unit.
 */
export const GRAIN_PER_UNIT: Readonly<Record<Grain, number>> = { buckram: 0.2625, paper: 0.3, cardboard: 0.3 };

/**
 * Page edges: one stripe per leaf, with darker gaps and the odd cooler or warmer sheet (SPEC S-BOOK-9).
 * u runs across the leaves, v along the edge.
 */
export function edgeTexture(seed: number, paper = '#f6f4ee'): CanvasTexture {
  const W = 1024;
  const H = 256;
  const [c, g] = canvas(W, H);
  const rnd = seeded(seed);
  g.fillStyle = paper;
  g.fillRect(0, 0, W, H);
  const per = W / EDGE_TEXTURE_LEAVES;
  for (let i = 0; i < EDGE_TEXTURE_LEAVES; i++) {
    const x = i * per;
    const r = rnd();
    const tone = r < 0.1 ? 'rgba(120,140,170,0.10)' : r < 0.15 ? 'rgba(190,150,100,0.12)' : `rgba(0,0,0,${0.02 * rnd()})`;
    g.fillStyle = tone;
    g.fillRect(x, 0, per, H);
    g.fillStyle = `rgba(40,34,26,${0.08 + 0.32 * rnd()})`;
    g.fillRect(x + per * (0.72 + 0.1 * rnd()), 0, Math.max(0.6, per * 0.22), H);
  }
  // Low-frequency unevenness along the edge.
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(0,0,0,${0.015 * rnd()})`;
    g.fillRect(0, rnd() * H, W, 2 + rnd() * 18);
  }
  return texture(c, { repeat: true, srgb: true });
}

/** Endpaper: a quiet two-tone pattern in the book's colours. */
export function endpaperTexture(design: CoverDesign, seed: number): CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S, S);
  const rnd = seeded(seed ^ 0x9e3779b9);
  g.fillStyle = '#ece6d8';
  g.fillRect(0, 0, S, S);
  g.strokeStyle = design.cloth;
  g.globalAlpha = 0.42;
  g.lineWidth = 2;
  const step = S / 8;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const cx = x * step + step / 2;
      const cy = y * step + step / 2;
      g.beginPath();
      g.arc(cx, cy, step * 0.34, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.arc(cx, cy, step * (0.08 + 0.1 * rnd()), 0, Math.PI * 2);
      g.stroke();
    }
  }
  return texture(c, { repeat: true });
}

export interface PageContent {
  /** Page number printed at the foot, or null. */
  folio: number | null;
  /** Running head. */
  head?: string;
  /** Paragraphs of body text. */
  paragraphs?: string[];
  /** A heading at the top of the text block. */
  heading?: string;
  /** Lines that were set beforehand by `flowPages`. They replace `paragraphs`. */
  lines?: PageLine[];
  /** Left pages put the folio at the outer left. */
  left: boolean;
}

/** One set line of body text. */
export interface PageLine {
  words: string[];
  /** First line of a paragraph: it starts with an indent. */
  indent: boolean;
  /** Spread to the full measure. The last line of a paragraph is not. */
  justify: boolean;
}

/** What `flowPages` puts on one page. */
export interface FlowedPage {
  heading?: string;
  lines: PageLine[];
}

/** Proportions of a page, as shares of its width or height. */
// Text size, weight and leading were set beside a page of the reference at reading distance: its lines stand
// closer and its strokes are heavier than a book face at its regular weight, which thins to grey when a page
// is drawn a few hundred pixels high.
const PAGE = { inner: 0.15, outer: 0.11, top: 0.105, bottom: 0.9, text: 0.0152, weight: 520, lead: 1.36, indent: 1.4, heading: 0.034, headingRoom: 0.16, headingGap: 0.03 };

/**
 * Sets a text in pages the way a compositor would: lines are broken by the real width of the words in the
 * book's typeface, a paragraph runs on over the page break, and a heading starts a new page. Every page is
 * full except the last of a chapter. The result does not depend on the size the pages are painted at.
 */
export function flowPages(paragraphs: string[], heading: (index: number) => string | undefined, pageAspect: number, faces: Typefaces = DEFAULT_FACES): FlowedPage[] {
  const H = 1000;
  const W = H * pageAspect;
  const [, g] = canvas(8, 8);
  const measure = W * (1 - PAGE.inner - PAGE.outer);
  const px = H * PAGE.text;
  const lead = px * PAGE.lead;
  const body = `${PAGE.weight} ${px}px ${faces.text}`;
  const widths = new Map<string, number>();
  const widthOf = (word: string): number => {
    let w = widths.get(word);
    if (w === undefined) {
      w = g.measureText(word).width;
      widths.set(word, w);
    }
    return w;
  };
  g.font = body;
  const space = g.measureText(' ').width;
  const fullRoom = Math.floor((H * (PAGE.bottom - PAGE.top)) / lead);

  const pages: FlowedPage[] = [];
  let page: FlowedPage = { lines: [] };
  let room = fullRoom;
  const turn = (): void => {
    if (page.lines.length || page.heading) pages.push(page);
    page = { lines: [] };
    room = fullRoom;
  };

  for (const [i, para] of paragraphs.entries()) {
    const title = heading(i);
    if (title) {
      turn();
      page.heading = title;
      const hpx = H * PAGE.heading;
      const fit = fitLines(g, title, (p) => `500 ${p}px ${faces.display}`, measure, H * PAGE.headingRoom, hpx, 1.12);
      room = Math.floor((H * (PAGE.bottom - PAGE.top) - fit.lines.length * fit.px * 1.12 - H * PAGE.headingGap) / lead);
      g.font = body;
    }
    const words = para.split(/\s+/).filter(Boolean);
    let line: string[] = [];
    let width = 0;
    let first = true;
    const put = (justify: boolean): void => {
      if (!line.length) return;
      if (page.lines.length >= room) turn();
      // The first paragraph under a heading starts flush, like the first line of a chapter.
      page.lines.push({ words: line, indent: first && !(page.heading && page.lines.length === 0), justify });
      first = false;
      line = [];
      width = 0;
    };
    for (const word of words) {
      const w = widthOf(word);
      const indent = first && !(page.heading && page.lines.length === 0) ? px * PAGE.indent : 0;
      if (line.length && width + space + w > measure - indent) put(true);
      width += w + (line.length ? space : 0);
      line.push(word);
    }
    put(false);
  }
  turn();
  return pages;
}

/**
 * Paints one page: running head, body text set justified, folio. Returns a texture in page proportions.
 * Pages are painted when they are about to be seen and can be disposed afterwards.
 */
export function paintPage(content: PageContent, pageAspect: number, faces: Typefaces = DEFAULT_FACES, height = 1536, paper = '#eff1f5'): CanvasTexture {
  const H = height;
  const W = Math.round(H * pageAspect);
  const [c, g] = canvas(W, H);
  g.fillStyle = paper;
  g.fillRect(0, 0, W, H);
  const ink = '#221f1c';
  const inner = W * 0.15;
  const outer = W * 0.11;
  const left = content.left ? outer : inner;
  const right = W - (content.left ? inner : outer);
  const top = H * 0.105;
  const bottom = H * 0.9;
  const measure = right - left;
  g.fillStyle = ink;
  g.textBaseline = 'alphabetic';

  if (content.head) {
    g.font = `500 ${Math.round(H * 0.0105)}px ${faces.mono}`;
    g.textAlign = 'center';
    g.globalAlpha = 0.75;
    g.fillText(content.head.toUpperCase(), (left + right) / 2, H * 0.062);
    g.globalAlpha = 1;
  }

  let y = top;
  if (content.heading) {
    const px = Math.round(H * 0.034);
    g.font = `500 ${px}px ${faces.display}`;
    g.textAlign = 'left';
    const fit = fitLines(g, content.heading, (p) => `500 ${p}px ${faces.display}`, measure, H * 0.16, px, 1.12);
    g.font = `500 ${fit.px}px ${faces.display}`;
    for (const line of fit.lines) {
      y += fit.px * 1.12;
      g.fillText(line, left, y);
    }
    y += H * 0.03;
  }

  const px = H * PAGE.text;
  const lead = px * PAGE.lead;
  g.font = `${PAGE.weight} ${px}px ${faces.text}`;
  const space = g.measureText(' ').width;
  g.textAlign = 'left';
  for (const line of content.lines ?? []) {
    if (y + lead > bottom + 1) break;
    y += lead;
    const indent = line.indent ? px * PAGE.indent : 0;
    const natural = line.words.reduce((a, w) => a + g.measureText(w).width, 0);
    const gaps = line.words.length - 1;
    // A line that would have to stretch far (a single long word, a short measure) is left ragged.
    const stretch = gaps > 0 ? (measure - indent - natural) / gaps : space;
    const gap = line.justify && gaps > 0 && stretch < space * 3 ? Math.max(space * 0.6, stretch) : space;
    let x = left + indent;
    for (const w of line.words) {
      g.fillText(w, x, y);
      x += g.measureText(w).width + gap;
    }
  }
  for (const [pi, para] of (content.lines ? [] : (content.paragraphs ?? [])).entries()) {
    const words = para.split(/\s+/).filter(Boolean);
    let line: string[] = [];
    let width = 0;
    let first = true;
    const flush = (justify: boolean): void => {
      if (!line.length || y + lead > bottom) return;
      y += lead;
      const indent = first && (pi > 0 || !content.heading) ? px * 1.4 : 0;
      const natural = line.reduce((a, w) => a + g.measureText(w).width, 0);
      const gaps = line.length - 1;
      const gap = justify && gaps > 0 ? (measure - indent - natural) / gaps : space;
      let x = left + indent;
      g.textAlign = 'left';
      for (const w of line) {
        g.fillText(w, x, y);
        x += g.measureText(w).width + gap;
      }
      first = false;
      line = [];
      width = 0;
    };
    for (const w of words) {
      const ww = g.measureText(w).width;
      const indent = first && (pi > 0 || !content.heading) ? px * 1.4 : 0;
      if (width + ww + (line.length ? space : 0) > measure - indent) flush(true);
      width += ww + (line.length ? space : 0);
      line.push(w);
    }
    flush(false);
    if (y + lead > bottom) break;
  }

  if (content.folio !== null) {
    g.font = `500 ${Math.round(H * 0.0115)}px ${faces.mono}`;
    g.textAlign = content.left ? 'left' : 'right';
    g.fillText(String(content.folio), content.left ? left : right, H * 0.945);
  }
  return texture(c, { anisotropy: 16 });
}
