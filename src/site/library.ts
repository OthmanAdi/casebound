/**
 * Loads the content folder: `content/library.json` names the books, each `content/books/<slug>/book.json`
 * describes one, and an optional `text.json` beside it holds its text.
 * To add a book, add a folder. Nothing here needs to change.
 */
import type { BookRecord } from '../engine';
import library from '../../content/library.json';

const records = import.meta.glob<BookRecord>('../../content/books/*/book.json', { eager: true, import: 'default' });
const texts = import.meta.glob<{ paragraphs: string[] }>('../../content/books/*/text.json', { eager: true, import: 'default' });

export interface Library {
  name: string;
  tagline: string;
  /** Slugs of the books shown one per panel, in order. */
  featured: string[];
  /** Slugs of further books. */
  shelf: string[];
  /** Names of files in `extensions/` to load at start. */
  extensions: string[];
  books: BookRecord[];
}

const slugOf = (path: string): string => path.split('/').at(-2)!;

export function loadLibrary(): Library {
  const bySlug = new Map<string, BookRecord>();
  for (const [path, record] of Object.entries(records)) {
    const slug = slugOf(path);
    if (record.slug !== slug) throw new Error(`content: ${path} has slug "${record.slug}" but lives in folder "${slug}"`);
    bySlug.set(slug, { ...record });
  }
  for (const [path, text] of Object.entries(texts)) {
    const record = bySlug.get(slugOf(path));
    if (record && !record.text) record.text = text.paragraphs;
  }
  const order = [...library.featured, ...library.shelf];
  for (const slug of order) if (!bySlug.has(slug)) throw new Error(`content: library.json lists "${slug}" but content/books/${slug}/book.json does not exist`);
  const books = [...order.map((s) => bySlug.get(s)!), ...[...bySlug.values()].filter((b) => !order.includes(b.slug))];
  return { name: library.name, tagline: library.tagline, featured: library.featured, shelf: library.shelf, extensions: (library as { extensions?: string[] }).extensions ?? [], books };
}
