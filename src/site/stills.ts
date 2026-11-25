/**
 * The page without WebGL. Where the books cannot be drawn by three.js the page still shows them: every book is a
 * box of six faces, placed by the browser's own 3D transforms, with the cover that the painter paints for the real
 * book cut into front, back and spine. No picture is loaded.
 *
 * Measured: a still stands in the middle of its picture and rides the scroll with it, fades in over 320 ms, turns
 * about its upright axis under a sideways pull and goes back to the front once it has been out of sight, and a
 * press opens the details. After the featured books every book stands in a row, spine to the front, the chosen
 * one showing its cover. There is no reader, no lens and no pen here.
 */
import type { BookRecord } from '../engine';
import { atlasOf, makeDims, type BookDims, type CaseAtlas } from '../engine/book/dims';
import { paintCover } from '../engine/book/painter';
import { dwell } from '../engine/shelf/scroll';
import type { ThemeName } from '../engine/stage/presets';
import { paintBackdrop } from './backdrop';
import { bookArticle } from './details';
import { mountFoot } from './foot';
import type { Library } from './library';
import { createMenu, type MenuItem } from './menu';
import { STILL_DWELL, STILL_POSE, faceLight, turnsFor, wayBack, type Face } from './still-math';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** A hex colour moved toward white (`by` above 0) or black (below 0). Any other colour comes back as it is. */
export function shade(colour: string, by: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(colour.trim());
  if (!m) return colour;
  const n = parseInt(m[1]!, 16);
  const to = by > 0 ? 255 : 0;
  const k = Math.min(1, Math.abs(by));
  const mix = (v: number): number => Math.round(v + (to - v) * k);
  return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
}

/** The foil of a cover as a picture: metal where the mask is white, clear elsewhere. */
function foilOf(mask: HTMLCanvasElement, colour: string): HTMLCanvasElement {
  const c = el('canvas');
  c.width = mask.width;
  c.height = mask.height;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(mask, 0, 0);
  const px = g.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < px.data.length; i += 4) px.data[i + 3] = px.data[i]!;
  g.putImageData(px, 0, 0);
  g.globalCompositeOperation = 'source-in';
  const metal = g.createLinearGradient(0, 0, c.width * 0.35, c.height);
  metal.addColorStop(0, shade(colour, -0.12));
  metal.addColorStop(0.3, colour);
  metal.addColorStop(0.46, shade(colour, 0.4));
  metal.addColorStop(0.62, colour);
  metal.addColorStop(1, shade(colour, -0.18));
  g.fillStyle = metal;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

export interface StillsOptions {
  /** Why the stills are shown: asked for in the address, WebGL 2 is missing, or the engine could not start. */
  reason: 'asked' | 'missing' | 'failed';
  theme: ThemeName;
}

export interface Stills {
  readonly reason: StillsOptions['reason'];
  /** Slug of the book the page stands at. */
  readonly active: string;
  readonly detail: boolean;
  /** Slug of the book that shows its cover in the row. */
  readonly chosen: string;
  /** How far a featured book is turned by hand, in turns. */
  turnOf(slug: string): number;
  /** Brings a book: a featured one to the middle, any other in the row. */
  go(slug: string): void;
  setDetail(on: boolean, slug?: string): void;
  choose(slug: string): void;
}

interface Still {
  book: BookRecord;
  el: HTMLButtonElement;
  body: HTMLElement;
  turn: number;
  drawn: number;
  place: string;
  shown: boolean;
  away: boolean;
  back: { from: number; delta: number; t0: number; ms: number } | null;
  drag: { id: number; x0: number; y0: number; turn0: number; width: number; scrubbing: boolean } | null;
  quietUntil: number;
}

export function bootStills(library: Library, opts: StillsOptions): Stills {
  const html = document.documentElement;
  html.dataset.stills = opts.reason;
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  const still = (): boolean => calm.matches;
  const compact = (): boolean => innerWidth <= 899;
  const bySlug = new Map(library.books.map((b) => [b.slug, b]));
  const featured = library.featured.map((slug) => bySlug.get(slug)!);
  const catalogue = [...library.featured, ...library.books.map((b) => b.slug).filter((s) => !library.featured.includes(s))];
  const n = featured.length;
  document.title = library.name;
  $('wordmark').textContent = library.name;

  // ---------------------------------------------------------------- the covers
  const painted = new Map<string, { strip: HTMLCanvasElement; atlas: CaseAtlas; dims: BookDims }>();
  const paintedOf = (book: BookRecord): { strip: HTMLCanvasElement; atlas: CaseAtlas; dims: BookDims } => {
    let p = painted.get(book.slug);
    if (!p) {
      const dims = makeDims({ pages: book.pages, thickness: book.thickness });
      const atlas = atlasOf(dims);
      const cover = paintCover(book.cover, { title: book.title, subtitle: book.subtitle, author: book.author, imprint: book.imprint }, atlas, undefined, 1536);
      const strip = cover.map.image as HTMLCanvasElement;
      // Foil is not in the colour of a cover: the shader lays it on where a mask says so. Here it is laid on once,
      // as a band of light across the metal.
      if (book.cover.foil && book.cover.foil !== 'none') strip.getContext('2d')!.drawImage(foilOf(cover.finish.image as HTMLCanvasElement, book.cover.foil), 0, 0);
      p = { strip, atlas, dims };
      cover.emboss.dispose();
      cover.finish.dispose();
      painted.set(book.slug, p);
    }
    return p;
  };
  /** One part of the case as a picture of its own. */
  const cut = (book: BookRecord, part: 'front' | 'back' | 'spine', height: number): HTMLCanvasElement => {
    const { strip, atlas } = paintedOf(book);
    const [from, to] = atlas[part];
    const c = el('canvas');
    c.height = height;
    c.width = Math.max(1, Math.round((height * (to - from) * strip.width) / strip.height));
    c.getContext('2d')!.drawImage(strip, from * strip.width, 0, (to - from) * strip.width, strip.height, 0, 0, c.width, c.height);
    return c;
  };

  // ---------------------------------------------------------------- page furniture
  const panels = $('panels');
  const pictures = $('pictures');
  const cards: { el: HTMLElement; art: HTMLElement; place: string; shown: boolean }[] = [];
  for (const book of featured) {
    const panel = el('section', 'panel');
    panel.dataset.slug = book.slug;
    panel.setAttribute('aria-label', `${book.title} by ${book.author}`);
    panels.append(panel);
    const card = el('div', 'card');
    const art = el('div', 'card-art');
    art.style.backgroundImage = `url(${paintBackdrop(book.background ?? '#77808a', book.slug)})`;
    card.append(art);
    pictures.append(card);
    cards.push({ el: card, art, place: '', shown: true });
  }

  // The stills: one for every book. The featured ones stand on the shelf; the others are seen in the details.
  const layer = el('div', 'stills');
  layer.id = 'stills';
  layer.style.setProperty('--roll', `${STILL_POSE.roll}deg`);
  layer.style.setProperty('--pitch', `${STILL_POSE.pitch}deg`);
  layer.style.setProperty('--yaw', `${STILL_POSE.yaw}deg`);
  document.body.append(layer);
  const stills = new Map<string, Still>();
  const FACES: Face[] = ['front', 'back', 'spine', 'fore', 'head', 'tail'];
  for (const slug of catalogue) {
    const book = bySlug.get(slug)!;
    const { dims } = paintedOf(book);
    const button = el('button', 'still');
    button.type = 'button';
    button.dataset.slug = slug;
    button.dataset.shown = 'false';
    button.tabIndex = -1;
    button.setAttribute('aria-label', `Open ${book.title}`);
    button.style.setProperty('--rw', (dims.coverW / dims.coverH).toFixed(4));
    button.style.setProperty('--rt', (dims.thickness / dims.coverH).toFixed(4));
    button.style.setProperty('--board', `${((dims.board / dims.thickness) * 100).toFixed(1)}%`);
    button.style.setProperty('--cloth', book.cover.cloth);
    button.style.setProperty('--paper', book.paper ?? '#eff1f5');
    const body = el('span', 'still-book');
    for (const face of FACES) {
      const side = el('span', `still-face f-${face}`);
      if (face === 'front' || face === 'back' || face === 'spine') side.append(cut(book, face, 1024));
      body.append(side);
    }
    button.append(body);
    layer.append(button);
    const s: Still = { book, el: button, body, turn: 0, drawn: NaN, place: '', shown: false, away: false, back: null, drag: null, quietUntil: 0 };
    stills.set(slug, s);

    // Measured: a sideways pull turns the book; a pull up or down is the page's scroll.
    button.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      s.back = null;
      s.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, turn0: s.turn, width: button.getBoundingClientRect().width || 1, scrubbing: false };
    });
    button.addEventListener('pointermove', (e) => {
      const d = s.drag;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x0;
      const dy = e.clientY - d.y0;
      if (!d.scrubbing) {
        if (Math.abs(dy) > 6 && Math.abs(dy) >= Math.abs(dx)) {
          s.drag = null;
          return;
        }
        if (Math.abs(dx) <= 6) return;
        d.scrubbing = true;
        button.setPointerCapture?.(e.pointerId);
        button.dataset.scrubbing = 'true';
      }
      e.preventDefault();
      s.turn = d.turn0 + turnsFor(dx, d.width);
    });
    const release = (e: PointerEvent): void => {
      const d = s.drag;
      if (!d || d.id !== e.pointerId) return;
      s.drag = null;
      if (d.scrubbing) {
        // The press that ends a turn is not a press on the book.
        s.quietUntil = performance.now() + 400;
        button.dataset.scrubbing = 'false';
      }
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    button.addEventListener('dragstart', (e) => e.preventDefault());
    button.addEventListener('click', (e) => {
      if (performance.now() < s.quietUntil) return void e.preventDefault();
      if (!detail) setDetail(true, slug);
    });
  }

  // The row: every book of the library, spine to the front, in a stretch of the page of its own.
  const rowPanel = el('section', 'panel stills-row');
  rowPanel.setAttribute('aria-label', `All ${library.books.length} books`);
  const rowTrack = el('div', 'row-track');
  rowPanel.append(rowTrack);
  panels.append(rowPanel);
  const rowItems = new Map<string, HTMLButtonElement>();
  let chosen = catalogue[Math.min(catalogue.length - 1, Math.floor(catalogue.length / 2))]!;
  for (const slug of catalogue) {
    const book = bySlug.get(slug)!;
    const item = el('button', 'row-book');
    item.type = 'button';
    item.dataset.slug = slug;
    const spine = cut(book, 'spine', 900);
    spine.className = 'row-spine';
    const front = cut(book, 'front', 900);
    front.className = 'row-front';
    item.append(spine, front);
    item.addEventListener('click', () => (slug === chosen ? setDetail(true, slug) : choose(slug)));
    rowTrack.append(item);
    rowItems.set(slug, item);
  }
  let rowPlaced = '';
  const placeRow = (): void => {
    const item = rowItems.get(chosen)!;
    const key = `${chosen} ${innerWidth} ${rowTrack.offsetWidth}`;
    if (key === rowPlaced) return;
    rowPlaced = key;
    for (const [slug, e] of rowItems) {
      const mine = slug === chosen;
      e.classList.toggle('is-chosen', mine);
      e.setAttribute('aria-label', `${bySlug.get(slug)!.title}${mine ? '. Enter opens its details' : ''}`);
      e.setAttribute('aria-current', String(mine));
    }
    // The chosen book stands in the middle of the window, whatever its place in the row.
    const middle = item.offsetLeft + item.offsetWidth / 2;
    rowTrack.style.transform = `translate3d(${(rowPanel.clientWidth / 2 - middle).toFixed(1)}px,0,0)`;
  };
  function choose(slug: string): void {
    if (!rowItems.has(slug)) return;
    chosen = slug;
    placeRow();
    sync();
  }

  // ---------------------------------------------------------------- title row
  const marquee = $('marquee');
  const track = el('div', 'marquee-track snap');
  marquee.append(track);
  type Entry = { slug: string; el: HTMLElement; up: HTMLElement; wi: number; wu: number };
  const entries: Entry[] = [];
  for (let copy = 0; copy < 3; copy++)
    for (const slug of catalogue) {
      const book = bySlug.get(slug)!;
      const title = el('span', 'm-title');
      const it = el('span', 't-it');
      const up = el('span', 't-up');
      for (const face of [it, up]) {
        face.textContent = book.title;
        if (book.year) face.append(el('sup', undefined, `(${book.year})`));
      }
      title.append(it, up);
      title.addEventListener('click', () => {
        if (!detail) go(slug);
      });
      track.append(title);
      entries.push({ slug, el: title, up, wi: 0, wu: 0 });
    }
  const strip = { active: -1, centre: NaN, width: 0 };
  const layoutStrip = (slug: string, snap: boolean): void => {
    if (strip.width !== innerWidth) {
      for (const e of entries) {
        e.wi = e.el.offsetWidth;
        e.wu = e.up.offsetWidth;
      }
      strip.width = innerWidth;
      snap = true;
    }
    const active = catalogue.length + Math.max(0, catalogue.indexOf(slug));
    const centre = innerWidth * (detail && !compact() ? 0.275 : 0.475);
    if (active === strip.active && centre === strip.centre && !snap) return;
    const gap = compact() ? 30 : 72;
    let at = 0;
    let x = 0;
    for (const [k, e] of entries.entries()) {
      if (k === active) x = at;
      e.el.style.transform = `translate3d(${at.toFixed(1)}px,0,0)`;
      e.el.classList.toggle('is-current', k === active);
      at += (k === active ? e.wu : e.wi) + gap;
    }
    track.classList.toggle('snap', snap || still());
    track.style.transform = `translate3d(${(centre - x - entries[active]!.wu / 2).toFixed(1)}px,0,0)`;
    strip.active = active;
    strip.centre = centre;
  };

  // ---------------------------------------------------------------- where the page stands
  const navPx = (): number => parseFloat(getComputedStyle(html).getPropertyValue('--nav')) || 162;
  const slotPx = (): number => {
    const h = (panels.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0;
    return h > 0 ? h + 16 : innerHeight - 28;
  };
  let slotSeen = slotPx();
  let detail = false;
  /** Which book of the catalogue the details stand at. */
  let stage = 0;
  /** The featured book the shelf stands at, or `n` for the row. */
  let slot = 0;
  const activeSlug = (): string => (detail ? catalogue[stage]! : slot >= n ? chosen : featured[slot]!.slug);

  let glide: { from: number; to: number; start: number; ms: number; wrote: number } | null = null;
  const glideTo = (to: number, ms: number, done?: () => void): void => {
    if (still() || ms <= 0) {
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
  const stepTo = (to: number, done?: () => void): void => glideTo(Math.max(0, Math.min(n, to)) * slotSeen, 700, done);
  function go(slug: string, done?: () => void): void {
    const at = library.featured.indexOf(slug);
    if (at >= 0) stepTo(at, done);
    else {
      choose(slug);
      stepTo(n, done);
    }
  }

  // ---------------------------------------------------------------- details
  const articles = catalogue.map((slug, k) => bookArticle(bySlug.get(slug)!, k + 1 < catalogue.length ? bySlug.get(catalogue[k + 1]!) : undefined));
  const page = $('detail');
  page.append(...articles);
  let leaving = 0;
  function setDetail(on: boolean, slug = activeSlug()): void {
    if (on === detail) {
      if (on) glideTo(articles[catalogue.indexOf(slug)]!.offsetTop, 900);
      return;
    }
    clearTimeout(leaving);
    page.classList.remove('leaving');
    if (on) {
      stage = Math.max(0, catalogue.indexOf(slug));
      detail = true;
      page.hidden = false;
      html.toggleAttribute('data-detail', true);
      html.toggleAttribute('data-aside', true);
      scrollTo(0, articles[stage]!.offsetTop);
      page.classList.toggle('arriving', !still());
      setTimeout(() => page.classList.remove('arriving'), 1300);
    } else {
      const at = catalogue[stage]!;
      const back = (): void => {
        page.classList.remove('leaving');
        page.hidden = true;
        detail = false;
        html.toggleAttribute('data-detail', false);
        html.toggleAttribute('data-aside', false);
        const to = library.featured.indexOf(at);
        if (to < 0) choose(at);
        scrollTo(0, (to < 0 ? n : to) * slotPx());
        sync();
      };
      if (still()) back();
      else {
        page.classList.add('leaving');
        leaving = window.setTimeout(back, 300);
        return;
      }
    }
    sync();
  }
  page.addEventListener('click', (e) => {
    const t = e.target as Element;
    const article = t.closest<HTMLElement>('.dp-book');
    if (t.closest('.dp-next') && article) glideTo(articles[catalogue.indexOf(article.dataset.slug!) + 1]!.offsetTop, 900);
    else if (t.closest('.dp-all')) {
      setDetail(false);
      setTimeout(() => stepTo(n), still() ? 0 : 320);
    }
  });
  $('details').addEventListener('click', () => setDetail(!detail));
  $('home-link').addEventListener('click', (e) => {
    e.preventDefault();
    setDetail(false);
  });

  // ---------------------------------------------------------------- theme
  const themes: ThemeName[] = ['light', 'colour', 'dark'];
  const themeNames: Record<ThemeName, string> = { light: 'Morning', colour: 'Noon', dark: 'Night' };
  let theme = opts.theme;
  let themedFor = '';
  const applyTheme = (): void => {
    const book = bySlug.get(activeSlug())!;
    const key = `${theme} ${book.slug}`;
    if (key === themedFor) return;
    themedFor = key;
    html.dataset.theme = theme;
    html.style.setProperty('--bg', theme === 'light' ? '#e6e5de' : theme === 'dark' ? '#17141c' : `color-mix(in srgb, ${book.background ?? '#77808a'} 62%, #4b463f)`);
    html.style.setProperty('--ink', theme === 'light' ? '#1d1d1b' : '#ead9a6');
    const b = $('theme');
    b.textContent = themeNames[theme];
    b.setAttribute('aria-label', `Theme: ${themeNames[theme]}, change theme`);
  };
  $('theme').addEventListener('click', () => {
    theme = themes[(themes.indexOf(theme) + 1) % themes.length]!;
    applyTheme();
  });

  // ---------------------------------------------------------------- the bar and its menu
  // Why there are stills, and the way to the drawn books where there is one.
  const note = el('a', 'label stills-note', opts.reason === 'asked' ? 'Stills [ show in 3D ]' : 'Stills: no WebGL 2 here');
  note.id = 'stills-note';
  if (opts.reason === 'asked') note.href = `${location.pathname}?webgl${location.hash}`;
  $('details').before(note);
  mountFoot(library, still);
  const pageSections = (): MenuItem[] => [
    { word: 'Featured', key: 'f', run: () => leaveTo(() => stepTo(0)) },
    { word: 'All books', key: 'a', run: () => leaveTo(() => stepTo(n)) },
    { word: 'How to use it', key: 'u', run: () => leaveTo(() => glideTo($('band').getBoundingClientRect().top + scrollY, 900)) },
  ];
  const leaveTo = (then: () => void): void => {
    if (!detail) return then();
    setDetail(false);
    setTimeout(then, still() ? 0 : 340);
  };
  const menu = createMenu({
    books: library.books.map((b) => ({ slug: b.slug, title: b.title })),
    current: activeSlug,
    sections: pageSections,
    bookSections: () =>
      detail
        ? [...articles[stage]!.querySelectorAll<HTMLElement>('[data-section]')].map((sec) => ({ word: sec.dataset.section!, run: () => glideTo(sec.getBoundingClientRect().top + scrollY - navPx(), 700) }))
        : [],
    links: [
      { word: 'Source', href: 'https://github.com/OthmanAdi/casebound' },
      { word: 'The skill', href: 'https://github.com/OthmanAdi/casebound/tree/main/.agents/skills/casebound' },
      { word: 'Licence', href: 'https://github.com/OthmanAdi/casebound/blob/main/LICENSE' },
    ],
    onBook: (slug) => (detail ? setDetail(true, slug) : go(slug, () => setDetail(true, slug))),
  });

  /** Brings the words on the page in line with where it stands. */
  let synced = '';
  function sync(): void {
    const slug = activeSlug();
    const view = detail ? `/book/${slug}` : '/';
    const key = `${slug} ${view} ${slot >= n}`;
    if (key === synced) return;
    synced = key;
    const book = bySlug.get(slug)!;
    $('bar-title').textContent = `[▸] ${book.title}`;
    $('details').textContent = detail ? 'Close details [-]' : 'View details [+]';
    $('details').setAttribute('aria-label', detail ? 'Close details' : `View details: ${book.title}`);
    $('section-label').textContent = detail ? 'Details' : slot >= n ? 'All books' : 'Featured';
    for (const [k, a] of articles.entries()) a.classList.toggle('is-current', detail && k === stage);
    html.dataset.caseboundView = view;
    if (location.hash !== '#' + view && !(view === '/' && !location.hash)) history.replaceState(null, '', '#' + view);
    applyTheme();
    menu.refresh();
  }

  // ---------------------------------------------------------------- keys
  addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.key === 'Escape' && detail) setDetail(false);
    else if (detail) return;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      stepTo(Math.round(scrollY / slotSeen) + (e.key === 'ArrowDown' ? 1 : -1));
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && slot >= n) {
      e.preventDefault();
      const at = catalogue.indexOf(chosen) + (e.key === 'ArrowRight' ? 1 : -1);
      choose(catalogue[Math.max(0, Math.min(catalogue.length - 1, at))]!);
    } else {
      const section = pageSections().find((s) => s.key === e.key.toLowerCase());
      if (section) section.run();
    }
  });

  // ---------------------------------------------------------------- every frame
  const band = $('band');
  const frame = (now: number): void => {
    requestAnimationFrame(frame);
    const h = slotPx();
    if (h > 0 && !detail) slotSeen = h;
    const win = pictures.getBoundingClientRect();
    const pitch = win.height + 24;
    const raw = Math.max(0, Math.min(n, scrollY / slotSeen));
    const p = dwell(raw, STILL_DWELL.plateau, STILL_DWELL.creep);
    if (detail) {
      let k = 0;
      for (const [j, a] of articles.entries()) if (a.offsetTop - scrollY < innerHeight) k = j;
      stage = k;
    } else {
      // The book in the middle changes a little past half way, so it does not flicker between two.
      const nearest = Math.round(raw);
      if (Math.abs(raw - slot) > 0.65) slot = nearest;
    }
    const nav = navPx();
    /** Where the picture of a part of the details stands, from the top of the window of pictures. */
    const rideOf = (slug: string): number => {
      const a = articles[catalogue.indexOf(slug)]!;
      const top = a.offsetTop - scrollY;
      const bottom = top + (a.firstElementChild as HTMLElement).offsetHeight;
      return compact() ? top : Math.min(Math.max(top, 0), bottom - 24 - nav - win.height);
    };
    for (const [k, c] of cards.entries()) {
      const y = detail ? rideOf(featured[k]!.slug) : (k - p) * pitch;
      const show = y > -win.height - 40 && y < innerHeight;
      if (show !== c.shown) {
        c.el.style.visibility = show ? '' : 'hidden';
        c.shown = show;
      }
      const place = show ? `translate3d(0,${y.toFixed(1)}px,0)` : '';
      if (show && place !== c.place) {
        c.place = place;
        c.el.style.transform = place;
        // The art moves at 0.3 of the card's pace, as on the page with the books.
        c.art.style.transform = `translate3d(0,${(-0.7 * (detail ? Math.min(0, y) : y)).toFixed(1)}px,0)`;
      }
    }
    // On a narrow screen the details take the lower half and the book stands smaller in the upper one.
    const small = detail && compact();
    const middle = small ? nav + (innerHeight * 0.46 - nav) / 2 : win.top + win.height / 2 - 0.016 * innerHeight;
    for (const [slug, s] of stills) {
      const onShelf = library.featured.indexOf(slug);
      const y = detail ? rideOf(slug) : onShelf < 0 ? Infinity : (onShelf - p) * pitch;
      const centre = middle + y;
      // Measured: a still is shown while its picture is in the window of pictures. One that is not is out of reach
      // of the pointer and the Tab key too.
      const show = Number.isFinite(y) && y > 1 - win.height && y < win.height - 1;
      if (show !== s.shown) {
        s.shown = show;
        s.el.dataset.shown = String(show);
        s.el.tabIndex = show && !detail ? 0 : -1;
        if (!show && (s.turn !== 0 || s.back)) {
          s.away = true;
          s.back = null;
        }
      }
      if (!show) continue;
      if (s.away) {
        // Measured: a book that was turned by hand faces the front again when it comes back into sight.
        s.away = false;
        if (still()) s.turn = 0;
        else s.back = { from: s.turn, ...wayBack(s.turn), t0: now };
      }
      if (s.back && !s.drag) {
        const k = Math.min(1, (now - s.back.t0) / s.back.ms);
        s.turn = k >= 1 ? 0 : s.back.from + s.back.delta * (1 - (1 - k) ** 3);
        if (k >= 1) s.back = null;
      }
      const place = `translate3d(${(win.left + win.width / 2).toFixed(1)}px,${centre.toFixed(1)}px,0) translate(-50%,-50%) scale(${small ? 0.62 : 1})`;
      if (place !== s.place) {
        s.place = place;
        s.el.style.transform = place;
      }
      if (s.turn !== s.drawn) {
        s.drawn = s.turn;
        const light = faceLight(s.turn * 360);
        s.body.style.setProperty('--turn', `${(s.turn * 360).toFixed(2)}deg`);
        for (const face of FACES) s.body.style.setProperty(`--l-${face}`, light[face].toFixed(3));
      }
    }
    placeRow();
    layoutStrip(activeSlug(), false);
    // The foot of the page: the header turns light over the dark band, and the bar steps back.
    const b = band.getBoundingClientRect();
    const inFoot = !detail && b.top < innerHeight - 28;
    if (inFoot !== html.hasAttribute('data-foot')) html.toggleAttribute('data-foot', inFoot);
    const darkTop = !detail && b.top <= 44 && b.bottom > 44;
    if (darkTop !== html.hasAttribute('data-dark-top')) html.toggleAttribute('data-dark-top', darkTop);
    sync();
  };

  // A link to a book opens its details; there is no reader here, so a link to a page does the same.
  const entry = /^#\/book\/([^/]+)/.exec(location.hash);
  sync();
  placeRow();
  if (entry && bySlug.has(entry[1]!)) {
    const at = library.featured.indexOf(entry[1]!);
    if (at < 0) choose(entry[1]!);
    scrollTo(0, (at < 0 ? n : at) * slotPx());
    slot = at < 0 ? n : at;
    setDetail(true, entry[1]!);
  }
  requestAnimationFrame(frame);
  setTimeout(() => (html.dataset.caseboundReady = 'true'), 300);

  const api: Stills = {
    reason: opts.reason,
    get active() {
      return activeSlug();
    },
    get detail() {
      return detail;
    },
    get chosen() {
      return chosen;
    },
    turnOf: (slug) => stills.get(slug)?.turn ?? 0,
    go: (slug) => go(slug),
    setDetail,
    choose,
  };
  return api;
}
