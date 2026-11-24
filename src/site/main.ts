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
import { createMenu, type MenuItem } from './menu';
import { bookArticle } from './details';

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
  // Each featured book owns a stretch of the page (a panel) that gives the scroll its length. The pictures are not
  // in those stretches: they are cards in one fixed window below the title row, moved by the shelf's own progress,
  // so a picture dwells and travels with its book and never runs up under the header.
  const panels = $('panels');
  const pictures = $('pictures');
  const cards: { el: HTMLElement; art: HTMLElement; zoom: number; shown: boolean }[] = [];
  $('panel-lens').addEventListener('click', () => setLens(!magnifier.on));
  const marquee = $('marquee');
  const track = document.createElement('div');
  track.className = 'marquee-track snap';
  marquee.append(track);
  for (const book of featured) {
    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.dataset.slug = book.slug;
    panel.setAttribute('aria-label', `${book.title} by ${book.author}`);
    panels.append(panel);
    const card = document.createElement('div');
    card.className = 'card';
    const art = document.createElement('div');
    art.className = 'card-art';
    art.style.backgroundImage = `url(${paintBackdrop(book.background ?? '#77808a', book.slug)})`;
    card.append(art);
    pictures.append(card);
    cards.push({ el: card, art, zoom: 1, shown: true });
  }

  // One more stretch for the row, where every book of the library stands spine to the front. Measured: the row
  // stands on the bare page, with no picture behind it.
  {
    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.dataset.slug = '';
    panel.setAttribute('aria-label', `All ${library.books.length} books`);
    panels.append(panel);
  }

  // ---------------------------------------------------------------- title row
  // Measured: the title row holds every book of the library, the featured ones first, three times over so it never
  // runs out on either side. The current book's title stands upright, the others in italic at 0.8 opacity. It does
  // not slide with the scroll: when the current book changes (with the shelf's own hysteresis) the row glides to the
  // new title in 0.5 s, ease in and out. In the row of spines it holds the books in the row's own order and follows
  // the chosen one.
  const bySlug = new Map(library.books.map((b) => [b.slug, b]));
  const catalogue = [...library.featured, ...library.books.map((b) => b.slug).filter((s) => !library.featured.includes(s))];
  type Entry = { slug: string; el: HTMLElement; up: HTMLElement; wi: number; wu: number };
  let strip: { list: readonly string[]; entries: Entry[]; active: number; x: number; centre: number; width: number } = { list: [], entries: [], active: -1, x: NaN, centre: NaN, width: 0 };
  const buildStrip = (list: readonly string[]): void => {
    track.replaceChildren();
    const entries: Entry[] = [];
    for (let copy = 0; copy < 3; copy++)
      for (const slug of list) {
        const book = bySlug.get(slug)!;
        const el = document.createElement('span');
        el.className = 'm-title';
        const it = document.createElement('span');
        it.className = 't-it';
        const up = document.createElement('span');
        up.className = 't-up';
        for (const face of [it, up]) {
          face.textContent = book.title;
          if (book.year) {
            const sup = document.createElement('sup');
            sup.textContent = `(${book.year})`;
            face.append(sup);
          }
        }
        el.append(it, up);
        el.addEventListener('click', () => goToBook(slug));
        track.append(el);
        entries.push({ slug, el, up, wi: 0, wu: 0 });
      }
    strip = { list, entries, active: -1, x: NaN, centre: NaN, width: 0 };
  };
  /** Places the titles around the current one. `snap` skips the glide: a new list, a new window size. */
  const layoutStrip = (slug: string, snap: boolean): void => {
    const phone = innerWidth <= 899;
    if (strip.width !== innerWidth) {
      for (const e of strip.entries) {
        e.wi = e.el.offsetWidth;
        e.wu = e.up.offsetWidth;
      }
      strip.width = innerWidth;
      snap = true;
    }
    const n = strip.list.length;
    const active = n + Math.max(0, strip.list.indexOf(slug));
    // Measured: the upright title sits with its middle at 47.5 percent of the window (27.5 percent beside the details).
    const centre = innerWidth * (asideShown && !phone ? 0.275 : 0.475);
    if (active === strip.active && centre === strip.centre && !snap) return;
    const gap = phone ? 30 : 72;
    let at = 0;
    let x = 0;
    for (const [k, e] of strip.entries.entries()) {
      if (k === active) x = at;
      e.el.style.transform = `translate3d(${at.toFixed(1)}px,0,0)`;
      e.el.classList.toggle('is-current', k === active);
      at += (k === active ? e.wu : e.wi) + gap;
    }
    const goal = centre - x - strip.entries[active]!.wu / 2;
    track.classList.toggle('snap', snap || ctx.still);
    track.style.transform = `translate3d(${goal.toFixed(1)}px,0,0)`;
    strip.active = active;
    strip.x = goal;
    strip.centre = centre;
  };
  /** Brings a book to the front: a featured one to the centre, any other into the row. */
  const bring = (slug: string, done?: () => void): void => {
    const slot = library.featured.indexOf(slug);
    if (slot >= 0) stepTo(slot, undefined, done);
    else {
      stepTo(library.featured.length, undefined, done);
      shelf.row?.select(slug);
    }
  };
  /** A press on a title brings its book. */
  const goToBook = (slug: string): void => {
    if (!reader.isOpen && !detailOpen) bring(slug);
  };
  // ---------------------------------------------------------------- views
  /** How far the canvas content is shifted left to make room for the detail column, 0..1. */
  let shift = 0;
  let shiftFrom = 0;
  let shiftClock = 1;
  /** On a narrow screen the details take the lower half: how far the book has moved up into the rest, 0..1. */
  let lift = 0;
  let detailOpen = false;
  /** The long page of the details is in the document: from opening until its fade has finished. */
  let detailPage = false;
  /** Which book of the catalogue the details stand at, and where the shelf is held while they are open. */
  let stage = -1;
  let detailY = 0;
  /** How far the book and its picture ride with the top of their part of the details, CSS px. */
  let attach = 0;
  /** The details stand beside the picture: open, and no book open over them. */
  let asideShown = false;
  const offset = (): { x: number; y: number } => {
    const nav = parseFloat(getComputedStyle(html).getPropertyValue('--nav')) || 162;
    const panelH = innerHeight - nav - 24;
    const whole = nav + panelH / 2;
    const upper = nav + (innerHeight * 0.46 - nav) / 2;
    return { x: -0.2 * innerWidth * shift, y: whole + (upper - whole) * lift - innerHeight / 2 };
  };
  /** The pitch of the stretches of the shelf. Kept while the details hide them. */
  let slotSeen = 0;
  const slotPx = (): number => {
    const h = (panels.firstElementChild as HTMLElement).offsetHeight;
    if (h > 0) slotSeen = h + 16;
    return slotSeen || innerHeight - 28;
  };

  /** How far the page has been scrolled past the row, in slots. */
  const pastRow = (): number => scrollY / Math.max(1, slotPx()) - library.featured.length;
  /**
   * The row goes up with the page when the page is scrolled on toward its foot. Measured: it lags at first and
   * then moves a little faster than the page, 1.15 px a pixel: up 109, 334 and 597 px after 230, 460 and 690 px of
   * scroll, settled. Eased like the stack, so a quick scroll does not jerk it.
   */
  let rowLift = 0;
  const rowLiftGoal = (): number => {
    const d = detailPage ? 0 : Math.max(0, pastRow() * slotPx()) * (900 / Math.max(1, innerHeight));
    return (1.15 * d - 196 * (1 - Math.exp(-d / 147))) * (innerHeight / 900);
  };
  const shelfOffset = (): { x: number; y: number } => {
    const o = offset();
    return { x: o.x, y: o.y - rowLift + (detailPage ? attach : 0) };
  };
  /** Where the shelf would be scrolled to show a book: its slot, or the row. */
  const slotY = (slug: string): number => Math.max(0, library.featured.indexOf(slug) < 0 ? library.featured.length : library.featured.indexOf(slug)) * slotPx();
  const shelf = createShelf(engine, { featured: library.featured, slotPx, scrollY: () => (detailPage ? detailY : scrollY), centreOffsetPx: shelfOffset, fit: () => 1 - 0.5 * lift, row: true, peek: () => detailOpen, layout: (book, pose) => {
    if (query.get('layout') === 'fan') fan(book, pose);
    // In the details only the book of the part on the stage stands in the window; the stack around it would ride
    // up and down with the page.
    if (detailPage && book.slug !== catalogue[stage]) pose.visible = false;
  } });
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

  /** Brings the menu of the bar in line with the page; set once the menu exists. */
  let refreshMenu = (): void => undefined;

  /**
   * The details are a page of their own. Opening them puts that page in the place of the shelf, at the book the
   * shelf stood at, and holds the shelf there; closing them fades the page out (0.3 s, measured) and puts the shelf
   * back at the book the details had come to.
   */
  let leaving = 0;
  function setDetail(on: boolean, slug = current().slug): void {
    const was = detailOpen;
    detailOpen = on;
    const d = $('detail');
    clearTimeout(leaving);
    d.classList.remove('leaving');
    if (on && !was) {
      stage = catalogue.indexOf(slug);
      detailY = slotY(slug);
      detailPage = true;
      d.hidden = false;
      html.toggleAttribute('data-detail', true);
      markStage();
      scrollTo(0, articles[stage]!.offsetTop);
      d.classList.toggle('arriving', !ctx.still);
      setTimeout(() => d.classList.remove('arriving'), 1300);
    } else if (!on && was) {
      const back = (): void => {
        d.classList.remove('leaving');
        d.hidden = true;
        detailPage = false;
        attach = 0;
        html.toggleAttribute('data-detail', false);
        scrollTo(0, slotY(current().slug));
        ctx.invalidate();
      };
      if (ctx.still) back();
      else {
        d.classList.add('leaving');
        leaving = window.setTimeout(back, 300);
      }
    }
    $('details').textContent = on ? 'Close details [-]' : 'View details [+]';
    sync();
  }
  /** Gives the rows of the book the details stand at the names tools and keys look for. */
  function markStage(): void {
    for (const [k, a] of articles.entries()) {
      const mine = k === stage;
      a.classList.toggle('is-current', mine);
      const set = (sel: string, id: string): void => {
        const e = a.querySelector<HTMLElement>(sel);
        if (!e) return;
        if (mine) e.id = id;
        else if (e.id === id) e.removeAttribute('id');
      };
      set('.row-read', 'row-read');
      set('.row-ebook', 'row-ebook');
      set('.row-audio', 'row-audio');
      set('.dp-next', 'detail-next');
    }
  }
  /** Brings the part of the details of a book to the top of the window. */
  function toArticle(slug: string): void {
    const a = articles[catalogue.indexOf(slug)];
    if (a) glideTo(a.offsetTop, 900);
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
    // Measured: an open book has the whole picture, even when it was opened from the details; the details wait
    // underneath and come back when it closes.
    const aside = detailOpen && !reading;
    if (aside !== asideShown) {
      shiftFrom = shift;
      // Measured against the reference: the move is already one frame along on the first frame after the press.
      shiftClock = 1 / 60 / 0.64;
      asideShown = aside;
    }
    html.toggleAttribute('data-aside', aside);
    html.toggleAttribute('data-lock', reading);
    html.toggleAttribute('data-reading', reading);
    $('bar-title').textContent = `[▸] ${current().title}`;
    refreshMenu();
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
  // The long page of the details: one article for every book, in the order of the catalogue.
  const articles = catalogue.map((slug, k) => bookArticle(bySlug.get(slug)!, k + 1 < catalogue.length ? bySlug.get(catalogue[k + 1]!) : undefined));
  $('detail').append(...articles);
  $('detail').addEventListener('click', (e) => {
    const t = e.target as Element;
    const article = t.closest<HTMLElement>('.dp-book');
    if (t.closest('.row-read')) setReading(true);
    // Measured: each book's part ends with a way on to the next book and a way to the whole library.
    else if (t.closest('.dp-next') && article) toArticle(catalogue[catalogue.indexOf(article.dataset.slug!) + 1]!);
    else if (t.closest('.dp-all')) {
      setDetail(false);
      setTimeout(() => stepTo(library.featured.length), ctx.still ? 0 : 320);
    }
  });
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
  const effectOf = (t: EventTarget | null): ((on: boolean) => void) | null =>
    t instanceof Element ? (t.closest('.row-ebook') ? effects.hologram : t.closest('.row-audio') ? both : null) : null;
  for (const [type, on] of [['pointerover', true], ['pointerout', false], ['focusin', true], ['focusout', false]] as const)
    $('detail').addEventListener(type, (e) => {
      const fn = effectOf(e.target);
      // Moving within one row is not leaving it.
      if (fn && effectOf((e as PointerEvent | FocusEvent).relatedTarget) !== fn) fn(on);
    });

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
  /** `done` runs when the glide arrives, not when something took it back. */
  const glideTo = (to: number, ms: number, done?: () => void): void => {
    if (ctx.still || ms <= 0) {
      scrollTo(0, to);
      done?.();
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
      else {
        glide = null;
        done?.();
      }
    };
    requestAnimationFrame(step);
  };
  /** Brings a featured book to the centre. Measured: one second per screen height under a square root, 0.4 to 1.8 s. */
  function stepTo(slot: number, ms?: number, done?: () => void): void {
    const to = Math.max(0, Math.min(library.featured.length, slot)) * slotPx();
    glideTo(to, ms ?? Math.max(400, Math.min(1800, 1000 * Math.sqrt(Math.abs(to - scrollY) / Math.max(1, innerHeight)))), done);
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
    } else if ((e.key === 'f' || e.key === 'a' || e.key === 'u') && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !reader.isOpen) {
      // The keys of the page's sections, as the menu shows them.
      pageSections().find((s) => s.key === e.key)?.run();
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

  // ---------------------------------------------------------------- the foot of the page
  // Measured: after the row a dark band holds a row of wide cards, each with a title, a line of who made it, a few
  // sentences and a line of facts below a rule; the card in front is lit, the others stand at 0.55. Ours shows what
  // a visitor can do with the books, each card painted like the pictures of the shelf.
  const howTo = [
    { title: 'The shelf', body: 'Scroll, or press the arrow keys up and down. Each book holds at the centre for a moment, tilts toward the pointer and turns away as it leaves.', meta: 'Keys [ \u2193 \u2191 ]' },
    { title: 'A book in your hand', body: 'Drag the book. It follows through a spring, coasts on when you let go, and the cover that trails the turn lifts off the pages.', meta: 'Pointer [ drag ]' },
    { title: 'The whole library', body: 'Scroll to the end of the shelf and every book stands in a row, spine to the front. The arrow keys, a press on a spine or a pull on the row choose one.', meta: 'Keys [ \u2190 \u2192 ]' },
    { title: 'Reading', body: 'Space or Open book opens it. The arrow keys or a tap turn a leaf; Shift with an arrow, or Page Down and Page Up, turn ten as one block.', meta: 'Keys [ Space \u2190 \u2192 ]' },
    { title: 'The lens', body: 'Press m, or the lens button, and a round magnifier follows the pointer over the print.', meta: 'Key [ M ]' },
    { title: 'Light on the print', body: 'In the details of a book, hover E-book or Audiobook: the print shears under scanlines and splits its colours, or rings ripple the pages.', meta: 'Pointer [ hover ]' },
  ];
  const bandRow = $('band-cards');
  const bandCards: HTMLElement[] = howTo.map((item, k) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'band-card';
    card.setAttribute('aria-label', item.title);
    const book = library.books[k % library.books.length]!;
    card.style.backgroundImage = `url(${paintBackdrop(book.background ?? '#77808a', `${book.slug} card`, 864, 486)})`;
    card.addEventListener('click', () => showCard(k, true));
    bandRow.append(card);
    return card;
  });
  let cardShown = -1;
  function showCard(k: number, bring: boolean): void {
    if (k !== cardShown) {
      cardShown = k;
      for (const [j, c] of bandCards.entries()) c.classList.toggle('is-current', j === k);
      $('band-card-title').textContent = howTo[k]!.title;
      $('band-card-body').textContent = howTo[k]!.body;
      $('band-card-meta').textContent = howTo[k]!.meta;
    }
    if (bring) bandRow.scrollTo({ left: bandCards[k]!.offsetLeft - bandRow.offsetLeft, behavior: ctx.still ? 'auto' : 'smooth' });
  }
  showCard(0, false);
  bandRow.addEventListener(
    'scroll',
    () => {
      const at = (c: HTMLElement): number => Math.abs(c.offsetLeft - bandRow.offsetLeft - bandRow.scrollLeft);
      showCard(bandCards.reduce((best, c, j) => (at(c) < at(bandCards[best]!) ? j : best), 0), false);
    },
    { passive: true },
  );
  $('foot-copy').addEventListener('click', () => {
    const button = $('foot-copy');
    void navigator.clipboard?.writeText($('foot-command').textContent ?? '').then(
      () => {
        button.textContent = '+ Copied +';
        setTimeout(() => (button.textContent = '+ Copy +'), 1500);
      },
      () => undefined,
    );
  });

  // ---------------------------------------------------------------- the counter under the row, on a phone
  const pager = $('pager');
  let pagerChoice = '';
  let pagerSince = 0;
  $('pager-prev').addEventListener('click', (e) => {
    e.stopPropagation();
    shelf.row?.step(-1);
  });
  $('pager-next').addEventListener('click', (e) => {
    e.stopPropagation();
    shelf.row?.step(1);
  });
  for (const b of [$('pager-prev'), $('pager-next')]) b.addEventListener('pointerdown', (e) => e.stopPropagation());
  /** Places the counter under the chosen cover and shows it once the row stands still with that cover in front. */
  function placePager(time: number): void {
    const row = shelf.row;
    const live = !!row && row.settled && ctx.compact && !detailOpen && !reader.isOpen && !html.hasAttribute('data-foot');
    if (!live || !row) {
      if (pager.hasAttribute('data-shown')) pager.toggleAttribute('data-shown', false);
      pagerChoice = '';
      return;
    }
    if (row.selected !== pagerChoice) {
      pagerChoice = row.selected;
      pagerSince = time;
      pager.toggleAttribute('data-shown', false);
    }
    const book = engine.books.find((b) => b.record.slug === row.selected)!;
    const at = book.root.position.clone().project(ctx.camera);
    const perPx = ctx.size.y / ctx.visibleHeightAt(book.root.position.z);
    const scale = book.root.scale.x * perPx;
    const bottom = (0.5 - at.y * 0.5) * innerHeight + (book.dims.coverH * scale) / 2;
    pager.style.top = `${Math.round(bottom + 42)}px`;
    pager.style.width = `${Math.round(book.dims.coverW * scale + 18)}px`;
    const n = row.order.indexOf(row.selected) + 1;
    const readout = `${n} / ${row.order.length}`;
    if ($('pager-readout').textContent !== readout) $('pager-readout').textContent = readout;
    ($('pager-prev') as HTMLButtonElement).disabled = n <= 1;
    ($('pager-next') as HTMLButtonElement).disabled = n >= row.order.length;
    // The cover turns to the front in about 0.35 s after a choice.
    const shown = time - pagerSince > 0.35;
    if (shown !== pager.hasAttribute('data-shown')) {
      pager.toggleAttribute('data-shown', shown);
      pager.setAttribute('aria-hidden', String(!shown));
      for (const b of [$('pager-prev'), $('pager-next')]) b.tabIndex = shown ? 0 : -1;
    }
  }

  // ---------------------------------------------------------------- the menu of the bar
  /** Sections of the page, each with a key that brings it from anywhere on the shelf. */
  const pageSections = (): MenuItem[] => [
    { word: 'Featured', key: 'f', run: () => leaveTo(() => stepTo(0)) },
    { word: 'All books', key: 'a', run: () => leaveTo(() => stepTo(library.featured.length)) },
    { word: 'How to use it', key: 'u', run: () => leaveTo(() => glideTo($('band').getBoundingClientRect().top + scrollY, 900)) },
  ];
  /** Out of a book and the details first, then on. */
  const leaveTo = (then: () => void): void => {
    if (reader.isOpen) setReading(false);
    if (detailOpen) setDetail(false);
    then();
  };
  const menu = createMenu({
    books: library.books.map((b) => ({ slug: b.slug, title: b.title })),
    current: () => current().slug,
    sections: pageSections,
    // The sections of the details of the open book, as the details name them.
    bookSections: () =>
      detailOpen
        ? [...(articles[stage]?.querySelectorAll<HTMLElement>('[data-section]') ?? [])].map((sec) => ({
            word: sec.dataset.section!,
            run: () => glideTo(sec.getBoundingClientRect().top + scrollY - (parseFloat(getComputedStyle(html).getPropertyValue('--nav')) || 162), 700),
          }))
        : [],
    links: [
      { word: 'Source', href: 'https://github.com/OthmanAdi/casebound' },
      { word: 'The skill', href: 'https://github.com/OthmanAdi/casebound/tree/main/.agents/skills/casebound' },
      { word: 'Licence', href: 'https://github.com/OthmanAdi/casebound/blob/main/LICENSE' },
    ],
    // Measured: a press on a book brings it to the centre and then opens its details.
    onBook: (slug) => {
      if (reader.isOpen) setReading(false);
      if (detailOpen) toArticle(slug);
      else bring(slug, () => setDetail(true, slug));
    },
    // Not over the reader's own bar.
    blockedFrom: () => {
      const bar = $('toolbar');
      return bar.hidden ? Infinity : bar.getBoundingClientRect().left;
    },
  });

  refreshMenu = () => menu.refresh();

  ctx.events.on('view', () => sync());
  // A press on the centred book that did not turn it opens its details.
  ctx.events.on('book-click', () => {
    if (!detailOpen && !reader.isOpen) setDetail(true);
  });
  ctx.events.on('book-focus', () => {
    applyTheme();
    sync();
  });

  // ---------------------------------------------------------------- per frame
  const sectionLabel = $('section-label');
  ctx.onFrame('before-render', (f) => {
    // Measured: the book moves aside in 0.64 s, slow at both ends.
    const before = shift;
    const aside = asideShown && !ctx.compact ? 1 : 0;
    shiftClock = ctx.still ? 1 : Math.min(1, shiftClock + f.dt / 0.64);
    shift = shiftFrom + (aside - shiftFrom) * easeInOutQuad(shiftClock);
    const up = detailOpen && ctx.compact && !reader.isOpen ? 1 : 0;
    const liftBefore = lift;
    lift = ctx.still ? up : lift + (up - lift) * (1 - Math.exp(-7 * Math.min(f.dt, 0.05)));
    if (Math.abs(lift - up) < 1e-3) lift = up;
    if (lift !== liftBefore) ctx.invalidate();
    if (Math.abs(shift - before) > 1e-4 || shiftClock < 1) ctx.invalidate();
    html.style.setProperty('--shift', `${offset().x}px`);

    // The details as a page: the book of the part whose top has come into the window is the one on the stage. Its
    // picture and the book stay at the top of the window while its column scrolls past, and go up with the page
    // when its part ends. Measured: the next picture comes up with the page from below and stays at the top.
    const nav = parseFloat(getComputedStyle(html).getPropertyValue('--nav')) || 162;
    const windowH = pictures.clientHeight;
    const heroAt = (a: HTMLElement): { top: number; bottom: number } => {
      const hero = a.firstElementChild as HTMLElement;
      const top = a.offsetTop - scrollY;
      return { top, bottom: top + hero.offsetHeight };
    };
    /** Where the picture of a part stands, measured from the top of the window of pictures. */
    const cardAt = (a: HTMLElement): number => {
      const h = heroAt(a);
      return ctx.compact ? h.top : Math.min(Math.max(h.top, 0), h.bottom - 24 - nav - windowH);
    };
    if (detailPage) {
      let k = 0;
      for (const [j, a] of articles.entries()) if (a.offsetTop - scrollY < innerHeight) k = j;
      if (k !== stage) {
        stage = k;
        const slug = catalogue[k]!;
        detailY = slotY(slug);
        if (library.featured.indexOf(slug) < 0) shelf.row?.select(slug);
        markStage();
        refreshMenu();
      }
      const before = attach;
      attach = cardAt(articles[stage]!);
      if (attach !== before) ctx.invalidate();
    }

    // The pictures ride on the same progress as the books, a card's height and the gap below it apart.
    // Measured: the art inside a card moves at 0.3 of the card's pace (it is shifted back by 0.7 of the card's
    // offset), and it is drawn up to 6.3 percent larger as the card leaves the middle, eased over 40 ms.
    const p = shelf.state.progress;
    const pitch = pictures.clientHeight + 24;
    for (const [k, c] of cards.entries()) {
      if (detailPage) {
        // In the details each picture belongs to its book's part of the page.
        const y = cardAt(articles[catalogue.indexOf(featured[k]!.slug)]!);
        const show = y > -windowH - 40 && y < innerHeight;
        if (show !== c.shown) {
          c.el.style.visibility = show ? '' : 'hidden';
          c.shown = show;
        }
        if (show) {
          c.zoom = 1;
          c.el.style.transform = `translate3d(0,${y.toFixed(1)}px,0)`;
          c.art.style.transform = `translate3d(0,${(-0.7 * Math.min(0, y)).toFixed(1)}px,0)`;
        }
        continue;
      }
      const away = k - p;
      const show = Math.abs(away) < 1.2;
      if (show !== c.shown) {
        c.el.style.visibility = show ? '' : 'hidden';
        c.shown = show;
      }
      if (!show) continue;
      const zoom = 1 + 0.063 * Math.min(1, Math.abs(away));
      c.zoom = ctx.still ? zoom : c.zoom + (zoom - c.zoom) * (1 - Math.exp(-f.dt / 0.04));
      const y = away * pitch;
      c.el.style.transform = `translate3d(0,${y.toFixed(1)}px,0)`;
      c.art.style.transform = `translate3d(0,${(-0.7 * y).toFixed(1)}px,0) scale(${c.zoom.toFixed(4)})`;
    }

    // Title row: the list of the row while the row stands, the catalogue otherwise.
    const list = shelf.row?.settled ? shelf.row.order : catalogue;
    const fresh = list !== strip.list;
    if (fresh) buildStrip(list);
    layoutStrip(current().slug, fresh);
    // The foot of the page. The row goes up with the page; the title row fades from 0.2 of a slot past the row
    // and is gone at 0.45; past 0.24 the menu's strip and the bar's buttons go.
    const liftGoal = rowLiftGoal();
    const rowLiftBefore = rowLift;
    rowLift = ctx.still ? liftGoal : rowLift + (liftGoal - rowLift) * (1 - Math.exp(-f.dt / 0.066));
    if (Math.abs(rowLift - liftGoal) < 0.05) rowLift = liftGoal;
    if (rowLift !== rowLiftBefore) ctx.invalidate();
    const past = detailPage ? -1 : pastRow();
    const fade = Math.max(0, Math.min(1, (past - 0.2) / 0.3));
    // In the details the title row shows while a picture stands at the top of the window.
    // On a phone it gives way to the details altogether (measured).
    const held = !detailPage || (!ctx.compact && Math.abs(attach) < 1);
    const stripOpacity = String(held ? Math.max(0, 1 - 2 * fade) : 0);
    if (marquee.style.opacity !== stripOpacity) marquee.style.opacity = stripOpacity;
    const inFoot = past > 0.24 && !detailOpen && !reader.isOpen;
    if (inFoot !== html.hasAttribute('data-foot')) {
      html.toggleAttribute('data-foot', inFoot);
      if (inFoot) menu.set(false);
    }
    const band = $('band').getBoundingClientRect();
    const darkTop = band.top <= 44 && band.bottom > 44;
    if (darkTop !== html.hasAttribute('data-dark-top')) html.toggleAttribute('data-dark-top', darkTop);
    placePager(f.time);
    // The section label names the section that has passed 40 px below the top of the window.
    const label = detailPage ? (library.featured.includes(current().slug) ? 'Featured' : 'All books') : $('foot').getBoundingClientRect().top <= 40 ? 'Footer' : band.top <= 40 ? 'How to use it' : Math.round(p) >= library.featured.length ? 'All books' : 'Featured';
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
