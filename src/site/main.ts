/**
 * The demo site: the engine plus an ordinary page around it. Shelf, reader, detail column, themes, deep links.
 * The page is deliberately thin: everything it shows comes from the content folder and the engine's state.
 */
import '@fontsource-variable/newsreader/opsz.css';
import '@fontsource-variable/newsreader/opsz-italic.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './site.css';
import { createEngine, type BookRecord, type Extension } from '../engine';
import { fan } from '../../extensions/fan';
import { approach } from '../engine/core/math';
import { createMagnifier } from '../engine/effects/magnifier';
import { createSurfaceEffects } from '../engine/effects/surface-effects';
import { createReader } from '../engine/reader/reader';
import { createShelf } from '../engine/shelf/shelf';
import { themeForHour, type ThemeName } from '../engine/stage/presets';
import { paintBackdrop } from './backdrop';
import { loadLibrary } from './library';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const html = document.documentElement;
const query = new URLSearchParams(location.search);

async function boot(): Promise<void> {
  // Covers and pages are painted with these faces, so they have to be loaded first.
  await Promise.all([document.fonts.load('500 54px "Newsreader Variable"'), document.fonts.load('italic 400 20px "Newsreader Variable"'), document.fonts.load('500 11px "IBM Plex Mono"')]).catch(() => undefined);

  const library = loadLibrary();
  const featured = library.featured.map((slug) => library.books.find((b) => b.slug === slug)!);
  document.title = library.name;
  $('wordmark').textContent = library.name;

  const forced = query.has('midday') ? 'light' : (query.get('theme') as ThemeName | null);
  const engine = createEngine({ canvas: $<HTMLCanvasElement>('stage'), books: library.books, theme: forced ?? themeForHour(new Date().getHours()) });
  const { ctx } = engine;

  // ---------------------------------------------------------------- page furniture
  const panels = $('panels');
  const marquee = $('marquee');
  const track = document.createElement('div');
  track.className = 'marquee-track';
  marquee.append(track);
  const titles: HTMLElement[] = [];
  for (const book of featured) {
    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.dataset.slug = book.slug;
    panel.setAttribute('aria-label', `${book.title} by ${book.author}`);
    panel.style.backgroundImage = `url(${paintBackdrop(book.background ?? '#77808a', book.slug)})`;
    const lens = document.createElement('button');
    lens.type = 'button';
    lens.className = 'panel-lens';
    lens.textContent = '⌕';
    lens.setAttribute('aria-label', 'Turn on magnifier');
    lens.setAttribute('aria-pressed', 'false');
    lens.addEventListener('click', () => setLens(!magnifier.on));
    panel.append(lens);
    panels.append(panel);

    const t = document.createElement('span');
    t.className = 'm-title';
    t.textContent = book.title;
    if (book.year) {
      const sup = document.createElement('sup');
      sup.textContent = `(${book.year})`;
      t.append(sup);
    }
    track.append(t);
    titles.push(t);
  }

  // ---------------------------------------------------------------- views
  /** How far the canvas content is shifted left to make room for the detail column, 0..1. */
  let shift = 0;
  let detailOpen = false;
  const offset = (): { x: number; y: number } => {
    const nav = parseFloat(getComputedStyle(html).getPropertyValue('--nav')) || 162;
    const panelH = innerHeight - nav - 24;
    return { x: -0.2 * innerWidth * shift, y: nav + panelH / 2 - innerHeight / 2 };
  };
  const slotPx = (): number => (panels.firstElementChild as HTMLElement).offsetHeight + 16;

  const shelf = createShelf(engine, { featured: library.featured, slotPx, centreOffsetPx: offset, layout: query.get('layout') === 'fan' ? fan : undefined });
  const reader = createReader(engine, { centreOffsetPx: offset });
  const magnifier = createMagnifier(engine);
  const effects = createSurfaceEffects(engine);

  // Extensions: any file in `extensions/` with a default export. Listed in content/library.json or in `?ext=a,b`.
  const available = import.meta.glob<{ default: Extension }>('../../extensions/*.ts');
  for (const name of [...library.extensions, ...(query.get('ext')?.split(',') ?? [])].filter(Boolean)) {
    const load = available[`../../extensions/${name}.ts`];
    if (!load) console.warn(`bindery: no extension "${name}". Available: ${Object.keys(available).map((p) => p.split('/').at(-1)!.replace('.ts', '')).join(', ')}`);
    else engine.use((await load()).default);
  }

  const current = (): BookRecord => engine.books[engine.state.active]!.record;

  function setLens(on: boolean): void {
    magnifier.set(on);
    for (const b of document.querySelectorAll<HTMLButtonElement>('.panel-lens, #lens')) {
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', on ? 'Turn off magnifier' : 'Turn on magnifier');
    }
  }

  function setDetail(on: boolean): void {
    detailOpen = on;
    const d = $('detail');
    if (on) {
      const book = current();
      $('detail-title').textContent = book.title;
      $('detail-author').textContent = `by ${book.author}${book.year ? `, ${book.year}` : ''}`;
      $('detail-blurb').textContent = book.blurb ?? '';
      const ebook = $<HTMLAnchorElement>('row-ebook');
      const audio = $<HTMLAnchorElement>('row-audio');
      ebook.href = book.source?.id ? `https://www.gutenberg.org/ebooks/${book.source.id}` : 'https://www.gutenberg.org/';
      ebook.setAttribute('aria-label', `E-book of ${book.title} at Project Gutenberg`);
      audio.href = `https://librivox.org/search?q=${encodeURIComponent(book.title)}&search_form=advanced`;
      audio.setAttribute('aria-label', `Audiobook of ${book.title} at LibriVox`);
      $('detail-source').textContent = book.source ? `Text: ${book.source.name}. ${book.source.note ?? ''}` : '';
    }
    d.hidden = !on;
    html.toggleAttribute('data-detail', on);
    $('details').textContent = on ? 'Close details [-]' : 'View details [+]';
    sync();
  }

  function setReading(on: boolean, page?: number): void {
    if (on) reader.open(current().slug, page);
    else reader.close();
    sync();
  }

  /** Brings the page furniture in line with the engine state. */
  function sync(): void {
    const reading = reader.isOpen;
    $('toolbar').hidden = !reading;
    $('open').textContent = reading ? 'Close book [-]' : 'Open book [+]';
    $('open').setAttribute('aria-label', reading ? 'Close book' : `Open book: ${current().title}`);
    $('details').setAttribute('aria-label', detailOpen ? 'Close details' : `View details: ${current().title}`);
    $('home-link').hidden = !(reading || detailOpen);
    html.toggleAttribute('data-lock', reading || detailOpen);
    $('bar-title').textContent = `[▸] ${current().title}`;
    if (reading) $('folio').textContent = `${Math.max(1, reader.page)} · ${Math.min(reader.pageCount, reader.page + 1)}`;
    const slug = current().slug;
    const view = reading ? `/book/${slug}/page/${Math.max(1, reader.page)}` : detailOpen ? `/book/${slug}` : '/';
    html.dataset.binderyView = view;
    const hash = '#' + view;
    if (location.hash !== hash && !(view === '/' && location.hash === '')) history.replaceState(null, '', location.pathname + location.search + (view === '/' ? '' : hash));
  }

  function home(): void {
    if (reader.isOpen) reader.close();
    setLens(false);
    setDetail(false);
  }

  // ---------------------------------------------------------------- theme
  const themes: ThemeName[] = ['light', 'colour', 'dark'];
  const themeNames: Record<ThemeName, string> = { light: 'Morning', colour: 'Noon', dark: 'Night' };
  function applyTheme(): void {
    const theme = engine.rig.theme;
    const book = current();
    const bg = theme === 'light' ? '#e6e5de' : theme === 'dark' ? '#17141c' : `color-mix(in srgb, ${book.background ?? '#77808a'} 62%, #4b463f)`;
    const ink = theme === 'light' ? '#1d1d1b' : '#ead9a6';
    html.dataset.theme = theme;
    html.style.setProperty('--bg', bg);
    html.style.setProperty('--ink', ink);
    const b = $('theme');
    b.textContent = themeNames[theme];
    b.setAttribute('aria-label', `Theme: ${themeNames[theme]}, change theme`);
  }
  $('theme').addEventListener('click', () => {
    engine.setTheme(themes[(themes.indexOf(engine.rig.theme) + 1) % themes.length]!);
    applyTheme();
  });

  // ---------------------------------------------------------------- controls
  $('open').addEventListener('click', () => setReading(!reader.isOpen));
  $('details').addEventListener('click', () => setDetail(!detailOpen));
  $('row-read').addEventListener('click', () => setReading(true));
  $('prev').addEventListener('click', () => reader.previous());
  $('next').addEventListener('click', () => reader.next());
  $('close').addEventListener('click', () => setReading(false));
  $('lens').addEventListener('click', () => setLens(!magnifier.on));
  $('home-link').addEventListener('click', (e) => {
    e.preventDefault();
    home();
  });
  $('wordmark').addEventListener('click', (e) => {
    e.preventDefault();
    home();
    scrollTo({ top: 0, behavior: ctx.still ? 'auto' : 'smooth' });
  });
  // The two rows that show the page light effects: e-book and audiobook.
  for (const [id, fn] of [['row-ebook', effects.hologram], ['row-audio', effects.radio]] as const) {
    const row = $(id);
    row.addEventListener('pointerenter', () => fn(true));
    row.addEventListener('pointerleave', () => fn(false));
    row.addEventListener('focus', () => fn(true));
    row.addEventListener('blur', () => fn(false));
  }

  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (e.key === ' ' && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLAnchorElement)) {
      e.preventDefault();
      if (!e.repeat) setReading(!reader.isOpen);
    } else if (e.key === 'Escape') home();
    else if (e.key === 'ArrowRight' && reader.isOpen) reader.next();
    else if (e.key === 'ArrowLeft' && reader.isOpen) reader.previous();
    else if (e.key === 'm') setLens(!magnifier.on);
  });

  ctx.events.on('view', () => sync());
  ctx.events.on('book-focus', () => {
    applyTheme();
    sync();
  });

  // ---------------------------------------------------------------- per frame
  let trackX = 0;
  ctx.onFrame('before-render', (f) => {
    const before = shift;
    shift = ctx.still ? (detailOpen ? 1 : 0) : approach(shift, detailOpen && !ctx.compact ? 1 : 0, 7, f.dt);
    if (Math.abs(shift - before) > 1e-4) ctx.invalidate();
    html.style.setProperty('--shift', `${offset().x}px`);

    // Marquee: the current title sits at the centre of the picture; neighbours slide with the scroll.
    const p = shelf.state.progress;
    const i = Math.max(0, Math.min(titles.length - 1, Math.floor(p)));
    const j = Math.min(titles.length - 1, i + 1);
    const centre = (el: HTMLElement): number => el.offsetLeft + el.offsetWidth / 2;
    const x = centre(titles[i]!) + (centre(titles[j]!) - centre(titles[i]!)) * (p - i);
    const goal = innerWidth / 2 + offset().x - x;
    if (Math.abs(goal - trackX) > 0.05) {
      trackX = goal;
      track.style.transform = `translate3d(${trackX.toFixed(1)}px,0,0)`;
    }
    const active = Math.round(p);
    for (const [k, el] of titles.entries()) el.classList.toggle('is-current', k === active);
  });

  // ---------------------------------------------------------------- deep links
  function route(hash: string): void {
    const m = /^#\/book\/([a-z0-9-]+)(?:\/page\/(\d+))?/.exec(hash);
    if (!m) return;
    const index = engine.books.findIndex((b) => b.record.slug === m[1]);
    if (index < 0) return;
    const slot = library.featured.indexOf(m[1]!);
    if (slot >= 0) scrollTo(0, slot * slotPx());
    engine.state.active = index;
    shelf.state.active = Math.max(0, slot);
    setDetail(true);
    if (m[2]) setReading(true, Number(m[2]));
  }

  // Read the address before the first sync, which rewrites it.
  const entry = location.hash;
  applyTheme();
  sync();
  engine.start();
  route(entry);
  Object.assign(window, { bindery: { engine, shelf, reader, magnifier, effects, library } });
  // Tell tools the page has settled: after the intro, or at once on a deep link.
  setTimeout(() => (html.dataset.binderyReady = 'true'), entry.startsWith('#/book/') || ctx.still ? 300 : 2100);
}

void boot();
