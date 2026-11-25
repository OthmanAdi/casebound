/**
 * The details as one long page: every book of the library one after another, each with what its record holds.
 *
 * Measured on the reference: the details are a page of their own that runs from one book into the next. Each book
 * begins with its picture and the book itself standing on the left while a column on the right scrolls past: a
 * label, the title and the author, the description, the ways to read it. Then come sections across the whole width,
 * and then the next book. Every section opens with a full rule and its label 7 px below it.
 *
 * Ours holds, for each book: in the column, the title block, the description with the ways to read it, and an
 * excerpt, the opening lines of its text set in the book's own typeface; across the width, a colophon written from
 * the record (year, pages, binding, paper, source of the text) with its links.
 */
import type { BookRecord } from '../engine';

/** The colophon of a book, in our own words, from what its record says. */
export function facts(book: BookRecord): string[] {
  const out: string[] = [];
  if (book.year) out.push(`First published ${book.year}`);
  if (book.pages) out.push(`${book.pages} pages`);
  const grain = book.cover.grain ?? 'buckram';
  out.push(grain === 'buckram' ? 'Bound in buckram cloth' : grain === 'paper' ? 'Bound in paper over boards' : 'Bound in board');
  out.push(book.cover.foil && book.cover.foil !== 'none' ? 'Title stamped in foil' : 'Title printed in ink');
  out.push(book.paper ? 'Printed on cream paper' : 'Printed on white paper');
  return out;
}

/** The opening of a text: whole paragraphs up to about `words` words, the last one cut at a sentence. */
export function excerpt(paragraphs: readonly string[] | undefined, words = 220): string[] {
  const out: string[] = [];
  let count = 0;
  for (const p of paragraphs ?? []) {
    const n = p.split(/\s+/).length;
    if (count + n <= words) {
      out.push(p);
      count += n;
      continue;
    }
    // Cut the last paragraph after the last full sentence that still fits; if none fits, stop before it.
    const sentences = p.match(/[^.!?]+[.!?]+["'’”)]*\s*/g) ?? [];
    let part = '';
    for (const s of sentences) {
      if (count + (part + s).split(/\s+/).length > words) break;
      part += s;
    }
    if (part.trim()) out.push(part.trim());
    break;
  }
  return out;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
};

const section = (label: string, className = 'd-sec'): HTMLElement => {
  const s = el('section', className);
  s.dataset.section = label;
  s.append(el('p', 'label', label));
  return s;
};

/** Builds the article of one book. `next` is the book that follows it on the page. */
export function bookArticle(book: BookRecord, next: BookRecord | undefined): HTMLElement {
  const article = el('article', 'dp-book');
  article.dataset.slug = book.slug;
  article.setAttribute('aria-label', `${book.title}, details`);

  const hero = el('div', 'dp-hero');
  const col = el('div', 'dp-col');
  const head = section('Book');
  const title = el('h2', 'dp-title', book.title);
  title.id = `detail-title-${book.slug}`;
  head.append(title, el('p', 'byline', `by ${book.author}${book.year ? `, ${book.year}` : ''}`));
  const about = section('About');
  about.append(el('p', 'blurb', book.blurb ?? ''));
  const rows = el('div', 'rows');
  const read = el('button', 'row row-read');
  read.type = 'button';
  read.append('Read it here ', el('span', undefined, 'open'));
  const ebook = el('a', 'row row-ebook');
  ebook.href = book.source?.id ? `https://www.gutenberg.org/ebooks/${book.source.id}` : 'https://www.gutenberg.org/';
  ebook.target = '_blank';
  ebook.rel = 'noopener noreferrer';
  ebook.setAttribute('aria-label', `E-book of ${book.title} at Project Gutenberg`);
  ebook.append('E-book ', el('span', undefined, 'Project Gutenberg ↗'));
  const audio = el('a', 'row row-audio');
  audio.href = `https://librivox.org/search?q=${encodeURIComponent(book.title)}&search_form=advanced`;
  audio.target = '_blank';
  audio.rel = 'noopener noreferrer';
  audio.setAttribute('aria-label', `Audiobook of ${book.title} at LibriVox`);
  audio.append('Audiobook ', el('span', undefined, 'LibriVox ↗'));
  rows.append(read, ebook, audio);
  about.append(rows);
  if (book.zine) {
    // Measured: a pill under the rows takes the zine out and puts it away again.
    const zine = el('button', 'pill row-zine', '+ Open zine +');
    zine.type = 'button';
    zine.setAttribute('aria-label', 'Open the zine');
    about.append(zine);
  }
  col.append(head, about);
  // The opening of the text, in the column: the part of the page the book and its picture stand beside.
  const lines = excerpt(book.text);
  if (lines.length) {
    const ex = section('Excerpt');
    const body = el('div', 'dp-excerpt');
    for (const p of lines) body.append(el('p', undefined, p));
    ex.append(body);
    col.append(ex);
  }
  hero.append(col);

  const parts: HTMLElement[] = [];
  const colophon = section('Colophon', 'd-sec dp-wide');
  const grid = el('div', 'dp-colophon');
  const group = (label: string, items: (string | HTMLElement)[]): void => {
    grid.append(el('p', 'label dp-sub', label));
    const list = el('ul', 'facts');
    for (const item of items) {
      const li = el('li');
      li.append(item);
      list.append(li);
    }
    grid.append(list);
  };
  group('Details', facts(book));
  if (book.source) {
    const link = el('a', undefined, `${book.source.name}${book.source.id ? `, number ${book.source.id}` : ''}`);
    link.href = ebook.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    group('Text', [link, ...(book.source.note ? [book.source.note.replace(/\.$/, '')] : [])]);
  }
  colophon.append(grid);
  parts.push(colophon);

  const end = el('nav', 'dp-end');
  end.setAttribute('aria-label', 'More books');
  if (next) {
    const on = el('button', 'label dp-next', 'Next →');
    on.type = 'button';
    on.setAttribute('aria-label', `Next book: ${next.title}`);
    end.append(on);
  }
  const all = el('button', 'label dp-all', '↙ All books');
  all.type = 'button';
  end.append(all);

  article.append(hero, ...parts, end);
  return article;
}
