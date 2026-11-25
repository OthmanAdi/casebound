import { describe, expect, it } from 'vitest';
import type { BookRecord } from '../book/book';
import { paginate } from './pages';

const record = (binding?: BookRecord['binding']): BookRecord => ({
  slug: 'short',
  title: 'A Short Text',
  author: 'Nobody',
  binding,
  cover: { cloth: '#223344', ink: '#eeddcc' },
  text: ['one '.repeat(300), 'two '.repeat(300), 'three '.repeat(200)],
});

/** Paragraphs printed on each page, packed by length: about 1500 characters a page. */
const printed = (source: ReturnType<typeof paginate>, pages: number): (string | null)[] =>
  Array.from({ length: pages }, (_, i) => {
    const page = source(i + 1);
    return page.folio === null ? null : (page.paragraphs?.[0]?.slice(0, 3) ?? '');
  });

describe('the pages of a book', () => {
  it('repeat a short text, so that a thick book has print on every page', () => {
    const pages = printed(paginate(record(), 8), 8);
    expect(pages.slice(0, 3)).toEqual(['one', 'two', 'thr']);
    expect(pages.slice(3, 6)).toEqual(['one', 'two', 'thr']);
    expect(pages.every((p) => p !== null)).toBe(true);
  });

  it('are bare outside the book', () => {
    const source = paginate(record(), 8);
    expect(source(0).folio).toBeNull();
    expect(source(9).folio).toBeNull();
  });
});

describe('the pages of a pamphlet', () => {
  it('hold the text once and are bare after it', () => {
    const pages = printed(paginate(record('pamphlet'), 8), 8);
    expect(pages.slice(0, 3)).toEqual(['one', 'two', 'thr']);
    expect(pages.slice(3)).toEqual([null, null, null, null, null]);
  });

  it('keep left and right as in a book', () => {
    const source = paginate(record('pamphlet'), 8);
    expect(source(1).left).toBe(false);
    expect(source(2).left).toBe(true);
    expect(source(6).left).toBe(true);
  });
});
