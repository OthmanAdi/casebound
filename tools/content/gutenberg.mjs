// Fetches the plain text of public-domain books from Project Gutenberg and stores a trimmed body next to each
// book record, so the reader has real pages to show.
//
//   node tools/content/gutenberg.mjs [slug ...]
//
// For every `content/books/<slug>/book.json` with `source.name` "Project Gutenberg" and a numeric `source.id`,
// writes `content/books/<slug>/text.json`: { paragraphs: string[], source: {...} }.
// The Project Gutenberg header, footer and licence text are removed; only the work itself is kept.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const booksDir = join(root, 'content', 'books');
const only = process.argv.slice(2);
const MAX_PARAGRAPHS = 140;

const clean = (s) => s.replace(/\r/g, '').replace(/[_*]/g, '').replace(/\s+/g, ' ').trim();

function body(text) {
  const start = text.search(/\*\*\* ?START OF (THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\n/i);
  const end = text.search(/\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG EBOOK/i);
  if (start < 0 || end < 0) throw new Error('start or end marker not found');
  return text.slice(text.indexOf('\n', start) + 1, end);
}

function paragraphs(text) {
  const all = text.replace(/\r/g, '').split(/\n\s*\n/).map(clean).filter(Boolean);
  const prose = all.filter((p) => {
    if (p.length < 220 || p.length > 1700) return false;
    if (/project gutenberg|transcriber|illustration|\[sidenote|copyright|printed by|price \d/i.test(p)) return false;
    const letters = p.replace(/[^A-Za-z]/g, '');
    const upper = p.replace(/[^A-Z]/g, '');
    if (letters.length < 150 || upper.length / letters.length > 0.25) return false;
    // Tables, indexes and lists have many digits or very short words.
    if ((p.match(/\d/g) ?? []).length / p.length > 0.05) return false;
    return /[.!?]["')\]]?$/.test(p);
  });
  // The first few long paragraphs are usually dedication or preface matter; start a little way in.
  return prose.slice(Math.min(6, Math.floor(prose.length / 10))).slice(0, MAX_PARAGRAPHS);
}

let failed = 0;
for (const slug of readdirSync(booksDir)) {
  if (only.length && !only.includes(slug)) continue;
  const recordPath = join(booksDir, slug, 'book.json');
  if (!existsSync(recordPath)) continue;
  const record = JSON.parse(readFileSync(recordPath, 'utf8'));
  const src = record.source;
  if (!src || src.name !== 'Project Gutenberg' || !Number.isInteger(src.id)) continue;
  // The main site refuses scripted downloads; its mirror is the place meant for them.
  const id = String(src.id);
  const dir = `https://gutenberg.pglaf.org/${id.length > 1 ? id.slice(0, -1).split('').join('/') : '0'}/${id}`;
  let url = '';
  try {
    let res = null;
    for (const name of [`${id}-0.txt`, `${id}.txt`, `${id}-8.txt`]) {
      url = `${dir}/${name}`;
      res = await fetch(url, { headers: { 'User-Agent': 'book-text-fetch/1.0' } });
      if (res.ok) break;
    }
    if (!res || !res.ok) throw new Error(`HTTP ${res?.status}`);
    const text = new TextDecoder(url.endsWith('-8.txt') ? 'latin1' : 'utf-8').decode(await res.arrayBuffer());
    const head = text.slice(0, 1500);
    const titleWord = record.title.replace(/^(The|A|On the|On) /i, '').split(/\s+/)[0];
    if (!new RegExp(titleWord, 'i').test(head)) throw new Error(`"${titleWord}" not in the file header: wrong ebook id?`);
    const list = paragraphs(body(text));
    if (list.length < 20) throw new Error(`only ${list.length} usable paragraphs`);
    writeFileSync(join(booksDir, slug, 'text.json'), JSON.stringify({ source: { name: src.name, id: src.id, url, licence: 'Public domain in the USA' }, paragraphs: list }, null, 1) + '\n');
    const chars = list.reduce((a, p) => a + p.length, 0);
    console.log(`${slug}: ${list.length} paragraphs, ${chars} characters. First: "${list[0].slice(0, 70)}..."`);
  } catch (e) {
    failed++;
    console.log(`${slug}: FAILED (${e.message}) ${url}`);
  }
}
process.exit(failed ? 1 : 0);
