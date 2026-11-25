import { describe, expect, it } from 'vitest';
import type { BookRecord } from '../book/book';
import { CHARS_PER_PAGE, bookOf, isZine, zinePages, zineRecord, zineSlug } from './record';

const book = (zine?: BookRecord['zine']): BookRecord => ({
  slug: 'candle',
  title: 'The Chemical History of a Candle',
  author: 'Michael Faraday',
  year: 1861,
  pages: 240,
  paper: '#e9e2cd',
  cover: { cloth: '#1c1a18', ink: '#e7a43a', accent: '#f3d79a', pattern: 'rays', foil: '#d9a441', grain: 'buckram' },
  text: Array.from({ length: 30 }, (_, i) => `Paragraph ${i}. ` + 'word '.repeat(190)),
  headings: { 0: 'Lecture one', 11: 'Lecture two' },
  zine,
});

describe('the slug of a zine', () => {
  it('is the slug of its book and a suffix, and goes back to it', () => {
    expect(zineSlug('walden')).toBe('walden:zine');
    expect(isZine('walden:zine')).toBe(true);
    expect(isZine('walden')).toBe(false);
    expect(bookOf('walden:zine')).toBe('walden');
    expect(bookOf('walden')).toBe('walden');
  });
});

describe('the pages of a zine', () => {
  it('come in fours, two sheets at least and eight at most', () => {
    expect(zinePages(0)).toBe(8);
    expect(zinePages(CHARS_PER_PAGE * 9)).toBe(12);
    expect(zinePages(CHARS_PER_PAGE * 12)).toBe(12);
    expect(zinePages(CHARS_PER_PAGE * 500)).toBe(32);
  });
});

describe('the record of a zine', () => {
  it('is null for a book that has none', () => {
    expect(zineRecord(book())).toBeNull();
  });

  it('is a pamphlet of the book, with every default, from two braces', () => {
    const z = zineRecord(book({}))!;
    expect(z.slug).toBe('candle:zine');
    expect(z.binding).toBe('pamphlet');
    expect(z.title).toBe('The Chemical History of a Candle');
    expect(z.author).toBe('Michael Faraday');
    expect(z.paper).toBe('#e9e2cd');
    expect(z.text).toHaveLength(12);
    expect(z.text![0]).toMatch(/^Paragraph 0\./);
    expect(z.zine).toBeUndefined();
  });

  it('takes the stretch of text it is told to, and brings the headings that fall in it along', () => {
    const z = zineRecord(book({ from: 9, paragraphs: 4 }))!;
    expect(z.text!.map((p) => p.slice(0, 13))).toEqual(['Paragraph 9. ', 'Paragraph 10.', 'Paragraph 11.', 'Paragraph 12.']);
    expect(z.headings).toEqual({ 2: 'Lecture two' });
  });

  it('stops at the end of the text', () => {
    expect(zineRecord(book({ from: 28, paragraphs: 12 }))!.text).toHaveLength(2);
    expect(zineRecord(book({ from: 99 }))!.text).toHaveLength(1);
  });

  it('has as many pages as its text fills, unless it is told a number', () => {
    const chars = book().text!.slice(0, 12).reduce((n, p) => n + p.length, 0);
    expect(zineRecord(book({}))!.pages).toBe(zinePages(chars));
    expect(zineRecord(book({ pages: 20 }))!.pages).toBe(20);
  });

  it('wears the colours of its book the other way round, on plain paper without foil', () => {
    const z = zineRecord(book({}))!;
    expect(z.cover).toMatchObject({ cloth: '#f3d79a', ink: '#1c1a18', pattern: 'plain', foil: 'none', grain: 'paper' });
    const own = zineRecord(book({ paper: '#112233', ink: '#ffeedd', title: 'The Flame', line: 'From the first lecture' }))!;
    expect(own.cover).toMatchObject({ cloth: '#112233', ink: '#ffeedd' });
    expect(own.title).toBe('The Flame');
    expect(own.subtitle).toBe('From the first lecture');
  });
});
