/**
 * A zine is a pamphlet cut from a book: a stretch of the book's own text in a paper cover (SPEC S-ZINE-2).
 *
 * A book says that it has one with a few lines in its record. From them a second, complete record is made here,
 * and the engine builds that one like any other book. Nothing else has to know what a zine is.
 */
import type { BookRecord } from '../book/book';
import { clamp } from '../core/math';

/** What a book's record says about its zine. Every field has a default, so `"zine": {}` is enough. */
export interface ZineSpec {
  /** Title on its cover. Default: the title of the book. */
  title?: string;
  /** A line under the title, for example "From the first lecture". */
  line?: string;
  /** Index of the first paragraph of the excerpt in the book's `text`. Default 0. */
  from?: number;
  /** How many paragraphs it holds. Default 12. */
  paragraphs?: number;
  /** Pages, the cover not counted. Default: as many as the excerpt fills, in fours, from 8 to 32. */
  pages?: number;
  /** Colour of the cover paper. Default: the accent of the book's cover, or its ink. */
  paper?: string;
  /** Colour of the print on the cover. Default: the cloth of the book, so the two covers are each other's negative. */
  ink?: string;
}

const SUFFIX = '.zine';

/** The slug of a book's zine. Marks and the remembered place are kept under it. */
export const zineSlug = (slug: string): string => slug + SUFFIX;
export const isZine = (slug: string): boolean => slug.endsWith(SUFFIX);
/** The slug of the book a zine was cut from. A book's own slug comes back unchanged. */
export const bookOf = (slug: string): string => (isZine(slug) ? slug.slice(0, -SUFFIX.length) : slug);

/**
 * Characters a page of the trim size holds when the painter sets it, headings and short last lines counted in.
 * Measured in the browser on both demo texts: eight pages hold 19,800 to 20,300 characters, a ninth begins after.
 */
export const CHARS_PER_PAGE = 2500;

/** Pages a text of that many characters fills. A pamphlet is folded sheets: four pages each, two sheets at least. */
export function zinePages(chars: number): number {
  return clamp(Math.ceil(chars / CHARS_PER_PAGE / 4) * 4, 8, 32);
}

/** The record of a book's zine, or null when the book has none. */
export function zineRecord(book: BookRecord): BookRecord | null {
  const spec = book.zine;
  if (!spec) return null;
  const all = book.text ?? [];
  const from = clamp(Math.round(spec.from ?? 0), 0, Math.max(0, all.length - 1));
  const count = Math.max(1, Math.round(spec.paragraphs ?? 12));
  const text = all.slice(from, from + count);
  const headings: Record<number, string> = {};
  for (const [at, heading] of Object.entries(book.headings ?? {})) {
    const k = Number(at) - from;
    if (k >= 0 && k < text.length) headings[k] = heading;
  }
  // Its first page opens with its title, unless the text brings a heading of its own there.
  headings[0] ??= spec.title ?? book.title;
  return {
    slug: zineSlug(book.slug),
    title: spec.title ?? book.title,
    subtitle: spec.line,
    author: book.author,
    pages: spec.pages ?? zinePages(text.reduce((n, p) => n + p.length, 0)),
    binding: 'pamphlet',
    background: book.background,
    paper: book.paper,
    year: book.year,
    source: book.source,
    imprint: book.imprint,
    cover: { cloth: spec.paper ?? book.cover.accent ?? book.cover.ink, ink: spec.ink ?? book.cover.cloth, pattern: 'plain', foil: 'none', grain: 'paper', seed: book.cover.seed },
    text: text.length ? text : undefined,
    headings,
  };
}
