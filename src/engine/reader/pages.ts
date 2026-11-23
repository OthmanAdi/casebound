/**
 * Turns a book's text into numbered pages. With a flow function the text is set line by line and every page
 * is full. Without one, paragraphs are packed by length. A book can supply its own `PageSource` instead.
 */
import type { BookRecord } from '../book/book';
import type { FlowedPage, PageContent } from '../book/painter';

/** Returns what is printed on a page. Page 1 is the first right-hand page. */
export type PageSource = (page: number) => PageContent;

const FILLER = [
  'This book has no text yet. Give its record a `text` array, one string per paragraph, and the reader will flow it over these pages.',
  'Until then the pages show this note, so that turning, lighting and the magnifier can be tried on something that looks like print.',
];

/** Sets paragraphs in pages. The reader passes the painter's `flowPages`, which measures real words. */
export type Flow = (paragraphs: string[], heading: (index: number) => string | undefined) => FlowedPage[];

export function paginate(record: BookRecord, pageCount: number, flow?: Flow, charsPerPage = 1500): PageSource {
  const paragraphs = record.text?.length ? record.text : FILLER;
  const flowed = flow?.(paragraphs, (i) => (record.text?.length ? record.headings?.[i] : undefined));
  if (flowed?.length) {
    // The text repeats through a thick book. A last page that is mostly empty would come round as a hole, so it is left out.
    const full = Math.max(...flowed.map((p) => p.lines.length));
    if (flowed.length > 1 && flowed[flowed.length - 1]!.lines.length < full * 0.7) flowed.pop();
    return (page) => {
      const left = page % 2 === 0;
      if (page < 1 || page > pageCount) return { folio: null, left };
      // Short texts repeat so every page of a thick book has print on it.
      const body = flowed[(page - 1) % flowed.length]!;
      return { folio: page, left, head: left ? record.title : (body.heading ?? record.author), heading: body.heading, lines: body.lines };
    };
  }
  const pages: { paragraphs: string[]; heading?: string }[] = [];
  let current: { paragraphs: string[]; heading?: string } = { paragraphs: [] };
  let used = 0;
  for (const [i, para] of paragraphs.entries()) {
    const heading = record.headings?.[i];
    if (heading && current.paragraphs.length) {
      pages.push(current);
      current = { paragraphs: [] };
      used = 0;
    }
    if (heading) {
      current.heading = heading;
      used += 260;
    }
    if (used + para.length > charsPerPage && current.paragraphs.length) {
      pages.push(current);
      current = { paragraphs: [] };
      used = 0;
    }
    current.paragraphs.push(para);
    used += para.length + 60;
  }
  if (current.paragraphs.length) pages.push(current);

  return (page) => {
    const left = page % 2 === 0;
    if (page < 1 || page > pageCount) return { folio: null, left };
    // Short texts repeat so every page of a thick book has print on it.
    const body = pages[(page - 1) % pages.length]!;
    return {
      folio: page,
      left,
      head: left ? record.title : (body.heading ?? record.author),
      heading: body.heading,
      paragraphs: body.paragraphs,
    };
  };
}
