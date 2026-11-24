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
import { easeInOutQuad } from '../engine/core/math';
import { createMagnifier, type Magnifier } from '../engine/effects/magnifier';
import { createMarker, type Marker } from '../engine/marker/marker';
import { createSurfaceEffects } from '../engine/effects/surface-effects';
import { createReader, type Reader } from '../engine/reader/reader';
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
    const slot = titles.length;
    t.addEventListener('click', () => {
      if (!reader.isOpen && !detailOpen) stepTo(slot);
    });
    titles.push(t);
  }

  // One more picture and title for the row, where every book of the library stands spine to the front.
  {
    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.dataset.slug = '';
    panel.setAttribute('aria-label', `All ${library.books.length} books`);
    panel.style.backgroundImage = `url(${paintBackdrop('#7d838c', 'the whole shelf')})`;
    panels.append(panel);
    const t = document.createElement('span');
    t.className = 'm-title';
    t.textContent = 'The whole shelf';
    const sup = document.createElement('sup');
    sup.textContent = `(${library.books.length})`;
    t.append(sup);
    track.append(t);
    const slot = titles.length;
    t.addEventListener('click', () => {
      if (!reader.isOpen && !detailOpen) stepTo(slot);
    });
    titles.push(t);
  }

  // ---------------------------------------------------------------- views
  /** How far the canvas content is shifted left to make room for the detail column, 0..1. */
  let shift = 0;
  let shiftFrom = 0;
  let shiftClock = 1;
  /** On a narrow screen the details take the lower half: how far the book has moved up into the rest, 0..1. */
  let lift = 0;
  let detailOpen = false;
  const offset = (): { x: number; y: number } => {
    const nav = parseFloat(getComputedStyle(html).getPropertyValue('--nav')) || 162;
    const panelH = innerHeight - nav - 24;
    const whole = nav + panelH / 2;
    const upper = nav + (innerHeight * 0.46 - nav) / 2;
    return { x: -0.2 * innerWidth * shift, y: whole + (upper - whole) * lift - innerHeight / 2 };
  };
  const slotPx = (): number => (panels.firstElementChild as HTMLElement).offsetHeight + 16;

  const shelf = createShelf(engine, { featured: library.featured, slotPx, centreOffsetPx: offset, fit: () => 1 - 0.5 * lift, row: true, peek: () => detailOpen, layout: query.get('layout') === 'fan' ? fan : undefined });
  /** Scales the open book down where the spread is wider than the room it has: beside the detail column, or on a narrow screen. */
  const fit = (): number => {
    const book = reader.book;
    if (!book) return 1;
    // A book opened from the row comes forward and grows, so it is measured where it will lie.
    const forward = Number(ctx.registry.getParam('reader', 'forward') ?? 0);
    const grown = Number(ctx.registry.getParam('reader', 'scale') ?? 1);
    const perWorld = ctx.size.y / ctx.visibleHeightAt(book.home.position.z + forward);
    // The open case is what has to fit: two boards and the spine between them, a little nearer than the plane
    // it is measured at because the book leans back.
    const spread = (2 * book.dims.coverW + book.dims.thickness) * book.home.scale * grown * perWorld * 1.04;
    const room = innerWidth * (1 - 0.4 * shift) - (ctx.compact ? 16 : 48);
    return Math.min(1, room / spread);
  };
  const reader: Reader = createReader(engine, { centreOffsetPx: offset, fit });
  const magnifier: Magnifier = createMagnifier(engine, { centreOffsetPx: offset, onToggle: (on) => setLens(on) });
  const marker: Marker = createMarker(engine, reader, { onChange: () => syncPens() });
  const effects = createSurfaceEffects(engine);

  // Extensions: any file in `extensions/` with a default export. Listed in content/library.json or in `?ext=a,b`.
  const available = import.meta.glob<{ default: Extension }>('../../extensions/*.ts');
  for (const name of [...library.extensions, ...(query.get('ext')?.split(',') ?? [])].filter(Boolean)) {
    const load = available[`../../extensions/${name}.ts`];
    if (!load) console.warn(`casebound: no extension "${name}". Available: ${Object.keys(available).map((p) => p.split('/').at(-1)!.replace('.ts', '')).join(', ')}`);
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

  /** Shows which pen is out of its holder. */
  function syncPens(): void {
    for (const slot of $('pens').children) slot.setAttribute('aria-pressed', String(marker.on && (slot as HTMLElement).dataset.pen === marker.color));
  }

  function setDetail(on: boolean): void {
    if (on !== detailOpen) {
      shiftFrom = shift;
      // Measured against the reference: the move is already one frame along on the first frame after the press.
      shiftClock = 1 / 60 / 0.64;
    }
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
    if (on) {
      // Measured: a book opened from the row comes forward and grows a little; a featured book stays where it is.
      const fromRow = shelf.row?.settled ?? false;
      ctx.registry.set('reader', 'forward', fromRow ? 18 : 0);
      ctx.registry.set('reader', 'scale', fromRow ? 1.1 : 1);
      reader.open(current().slug, page);
    } else {
      marker.set(false);
      reader.close();
    }
    sync();
  }

  /** Brings the page furniture in line with the engine state. */
  function sync(): void {
    const reading = reader.isOpen;
    // Measured: the reader's controls appear when the pages have parted, not at the click.
    $('toolbar').hidden = !(reading && (reader.parted >= 0.985 || ctx.still));
    $('open').textContent = reading ? 'Close book [-]' : 'Open book [+]';
    $('open').setAttribute('aria-label', reading ? 'Close book' : `Open book: ${current().title}`);
    $('details').setAttribute('aria-label', detailOpen ? 'Close details' : `View details: ${current().title}`);
    $('home-link').hidden = !(reading || detailOpen);
    html.toggleAttribute('data-lock', reading || detailOpen);
    html.toggleAttribute('data-reading', reading);
    $('bar-title').textContent = `[▸] ${current().title}`;
    if (reading) $('folio').textContent = `${Math.max(1, reader.page)} · ${Math.min(reader.pageCount, reader.page + 1)}`;
    const slug = current().slug;
    const view = reading ? `/book/${slug}/page/${Math.max(1, reader.page)}` : detailOpen ? `/book/${slug}` : '/';
    html.dataset.caseboundView = view;
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
  /** Leaves that a button or a key turns as one block. */
  const BLOCK = 10;
  $('open').addEventListener('click', () => setReading(!reader.isOpen));
  $('details').addEventListener('click', () => setDetail(!detailOpen));
  $('row-read').addEventListener('click', () => setReading(true));
  $('prev').addEventListener('click', () => reader.previous());
  $('next').addEventListener('click', () => reader.next());
  // Many leaves as one block. The edge of a page stack does the same under the pointer, but nothing on the page
  // says so, and a finger has no pointer to rest there.
  $('back-many').addEventListener('click', () => reader.turnLeaves(-BLOCK));
  $('on-many').addEventListener('click', () => reader.turnLeaves(BLOCK));
  $('close').addEventListener('click', () => setReading(false));
  $('lens').addEventListener('click', () => setLens(!magnifier.on));
  for (const pen of marker.colors) {
    const slot = document.createElement('button');
    slot.type = 'button';
    slot.className = 'pen-slot';
    slot.dataset.pen = pen.name;
    slot.style.setProperty('--pen', pen.body);
    slot.setAttribute('aria-label', `${pen.name[0]!.toUpperCase()}${pen.name.slice(1)} highlighter`);
    slot.setAttribute('aria-pressed', 'false');
    // Measured: a click takes that pen, changes to it, or puts it back if it is the one that is out.
    slot.addEventListener('click', () => marker.pick(pen.name));
    $('pens').append(slot);
  }
  $('home-link').addEventListener('click', (e) => {
    e.preventDefault();
    home();
  });
  $('wordmark').addEventListener('click', (e) => {
    e.preventDefault();
    home();
    scrollTo({ top: 0, behavior: ctx.still ? 'auto' : 'smooth' });
  });
  // The two rows that show the page light effects. Measured: the audiobook row runs the hologram too, with the
  // radio rings on top of it.
  const both = (on: boolean): void => {
    effects.hologram(on);
    effects.radio(on);
  };
  for (const [id, fn] of [['row-ebook', effects.hologram], ['row-audio', both]] as const) {
    const row = $(id);
    row.addEventListener('pointerenter', () => fn(true));
    row.addEventListener('pointerleave', () => fn(false));
    row.addEventListener('focus', () => fn(true));
    row.addEventListener('blur', () => fn(false));
  }

  // ---------------------------------------------------------------- leafing with a key held down
  // Measured: the first repeat comes after 300 ms, and over a hold of 3 s the pause shrinks to 50 ms.
  const held = { key: '', since: 0, timer: 0 };
  const stopLeafing = (): void => {
    clearTimeout(held.timer);
    held.key = '';
  };
  const leaf = (direction: 1 | -1, key: string): void => {
    stopLeafing();
    held.key = key;
    held.since = performance.now();
    const turn = (): void => {
      if (!reader.isOpen) return stopLeafing();
      if (direction === 1) reader.next();
      else reader.previous();
      const k = Math.min(1, (performance.now() - held.since) / 3000);
      held.timer = window.setTimeout(turn, 300 - 250 * k);
    };
    turn();
  };

  // ---------------------------------------------------------------- along the shelf without the wheel
  /** A scroll the page makes by itself. A wheel, a touch, a press or a scroll of the reader's own takes it back. */
  let glide: { from: number; to: number; start: number; ms: number; wrote: number } | null = null;
  const glideTo = (to: number, ms: number): void => {
    if (ctx.still || ms <= 0) {
      scrollTo(0, to);
      return;
    }
    const mine = (glide = { from: scrollY, to, start: performance.now(), ms, wrote: scrollY });
    const step = (): void => {
      if (glide !== mine || Math.abs(scrollY - mine.wrote) > 2) {
        if (glide === mine) glide = null;
        return;
      }
      const k = Math.min(1, (performance.now() - mine.start) / mine.ms);
      scrollTo(0, mine.from + (mine.to - mine.from) * (0.5 - 0.5 * Math.cos(Math.PI * k)));
      mine.wrote = scrollY;
      if (k < 1) requestAnimationFrame(step);
      else glide = null;
    };
    requestAnimationFrame(step);
  };
  /** Brings a featured book to the centre. Measured: one second per screen height under a square root, 0.4 to 1.8 s. */
  function stepTo(slot: number, ms?: number): void {
    const to = Math.max(0, Math.min(library.featured.length, slot)) * slotPx();
    glideTo(to, ms ?? Math.max(400, Math.min(1800, 1000 * Math.sqrt(Math.abs(to - scrollY) / Math.max(1, innerHeight)))));
  }
  const letGo = (): void => {
    glide = null;
  };
  for (const type of ['wheel', 'touchstart', 'pointerdown'] as const) addEventListener(type, letGo, { passive: true });

  // Left alone, the shelf shows its books one after another. Measured: after 3 s of quiet, a move of 1 s.
  // Any input ends it for good, and a browser driven by a script never sees it.
  let showing = !ctx.still && !navigator.webdriver && !query.has('quiet');
  let showTimer = 0;
  const endShow = (): void => {
    showing = false;
    clearTimeout(showTimer);
  };
  const showNext = (): void => {
    if (!showing) return;
    const slot = Math.round(scrollY / slotPx());
    if (Math.abs(scrollY - slot * slotPx()) > 50 || slot >= library.featured.length) return endShow();
    if (!document.hidden && !reader.isOpen && !detailOpen) stepTo(slot + 1, 1000);
    showTimer = window.setTimeout(showNext, 4000);
  };
  if (showing) {
    showTimer = window.setTimeout(showNext, 5000);
    for (const type of ['wheel', 'touchmove', 'keydown', 'pointerdown'] as const) addEventListener(type, endShow, { passive: true, once: true });
  }

  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !reader.isOpen && !detailOpen) {
      // One press brings the next book to the centre. A key held down scrolls the page as usual.
      if (e.repeat) glide = null;
      else {
        e.preventDefault();
        stepTo(Math.round((glide?.to ?? scrollY) / slotPx()) + (e.key === 'ArrowDown' ? 1 : -1));
      }
      return;
    }
    if (e.key === ' ' && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLAnchorElement)) {
      e.preventDefault();
      if (!e.repeat) setReading(!reader.isOpen);
    } else if (e.key === 'Escape') {
      // One step back at a time: out of the book first, then out of the details.
      // Measured: with a pen out, Escape puts it away and the book stays open.
      if (marker.on) marker.set(false);
      else if (reader.isOpen) {
        setLens(false);
        setReading(false);
      } else home();
    }
    else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !reader.isOpen && shelf.row?.settled) {
      // In the row the arrows choose the next book.
      e.preventDefault();
      shelf.row.step(e.key === 'ArrowRight' ? 1 : -1);
    } else if (reader.isOpen && ((e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) || e.key === 'PageDown' || e.key === 'PageUp')) {
      // Shift with an arrow, or Page Down and Page Up: ten leaves as one block.
      e.preventDefault();
      if (!e.repeat) reader.turnLeaves(e.key === 'ArrowRight' || e.key === 'PageDown' ? BLOCK : -BLOCK);
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && reader.isOpen) {
      e.preventDefault();
      if (!e.repeat) leaf(e.key === 'ArrowRight' ? 1 : -1, e.key);
    } else if (e.key === 'm' && !e.repeat) setLens(!magnifier.on);
    else if (e.key === 'h' && !e.repeat && reader.isOpen) marker.toggle();
    else if (e.key === 'z' && (e.ctrlKey || e.metaKey) && marker.on) {
      e.preventDefault();
      marker.undo();
    }
  });
  addEventListener('keyup', (e) => {
    if (e.key === held.key) stopLeafing();
  });
  addEventListener('blur', () => stopLeafing());

  ctx.events.on('view', () => sync());
  // A press on the centred book that did not turn it opens its details.
  ctx.events.on('book-click', () => {
    if (!detailOpen && !reader.isOpen) setDetail(true);
  });
  ctx.events.on('book-focus', () => {
    applyTheme();
    // The details follow the choice in the row.
    if (detailOpen) setDetail(true);
    else sync();
  });

  // ---------------------------------------------------------------- per frame
  const sectionLabel = $('section-label');
  let trackX = 0;
  ctx.onFrame('before-render', (f) => {
    // Measured: the book moves aside in 0.64 s, slow at both ends.
    const before = shift;
    const aside = detailOpen && !ctx.compact ? 1 : 0;
    shiftClock = ctx.still ? 1 : Math.min(1, shiftClock + f.dt / 0.64);
    shift = shiftFrom + (aside - shiftFrom) * easeInOutQuad(shiftClock);
    const up = detailOpen && ctx.compact && !reader.isOpen ? 1 : 0;
    const liftBefore = lift;
    lift = ctx.still ? up : lift + (up - lift) * (1 - Math.exp(-7 * Math.min(f.dt, 0.05)));
    if (Math.abs(lift - up) < 1e-3) lift = up;
    if (lift !== liftBefore) ctx.invalidate();
    if (Math.abs(shift - before) > 1e-4 || shiftClock < 1) ctx.invalidate();
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
    const label = active >= library.featured.length ? 'All books' : 'Featured';
    if (sectionLabel.textContent !== label) sectionLabel.textContent = label;
  });

  // ---------------------------------------------------------------- deep links
  function route(hash: string): void {
    const m = /^#\/book\/([a-z0-9-]+)(?:\/page\/(\d+))?/.exec(hash);
    if (!m) return;
    const index = engine.books.findIndex((b) => b.record.slug === m[1]);
    if (index < 0) return;
    const slot = library.featured.indexOf(m[1]!);
    if (slot >= 0) scrollTo(0, slot * slotPx());
    else {
      // A book that is not featured lives in the row.
      scrollTo(0, library.featured.length * slotPx());
      shelf.row?.select(m[1]!);
    }
    engine.state.active = index;
    shelf.state.active = slot >= 0 ? slot : library.featured.length;
    setDetail(true);
    if (m[2]) setReading(true, Number(m[2]));
  }

  // Read the address before the first sync, which rewrites it.
  const entry = location.hash;
  applyTheme();
  sync();
  engine.start();
  route(entry);
  Object.assign(window, { casebound: { engine, shelf, reader, magnifier, marker, effects, library } });
  // Tell tools the page has settled: after the intro, or at once on a deep link.
  setTimeout(() => (html.dataset.caseboundReady = 'true'), entry.startsWith('#/book/') || ctx.still ? 300 : 2100);
}

void boot();
