/**
 * The menu of the bar: every book of the library, the sections of the page and the links of the project, in a
 * panel that rises out of the strip at the foot of the window.
 *
 * Measured on the reference: the strip opens the menu when a mouse comes onto it and closes it when the mouse
 * leaves; a tap on the strip opens and closes it on a touch screen. The lists rise from below the strip in 0.38 s,
 * quick at first, and sink back the same way. From the keyboard the strip is one button: Enter opens the menu and
 * puts the focus on the current book, Tab then goes round inside the menu, and Escape closes it and gives the
 * focus back to the strip.
 */
export interface MenuItem {
  /** The words of the row. */
  word: string;
  /** A key that does the same from anywhere, marked in the word, or none. */
  key?: string;
  run: () => void;
}

export interface MenuOptions {
  books: readonly { slug: string; title: string }[];
  /** Slug of the book the page stands at. */
  current: () => string;
  /** Sections of the page, in page order. */
  sections: () => MenuItem[];
  /** Sections of the open book, or none. */
  bookSections: () => MenuItem[];
  links: readonly { word: string; href: string }[];
  /** A press on a book of the library. */
  onBook: (slug: string) => void;
  /** Where something at the foot of the window begins that the menu must not open over, CSS px from the left. */
  blockedFrom?: () => number;
}

export interface Menu {
  readonly open: boolean;
  set(open: boolean): void;
  /** Marks the current book and lists the sections again. */
  refresh(): void;
}

/** "Featured" with key "f" reads "[ F ]eatured". */
export function keyed(item: MenuItem): string {
  if (!item.key) return item.word;
  const at = item.word.toLowerCase().indexOf(item.key.toLowerCase());
  if (at < 0) return `[ ${item.key.toUpperCase()} ] ${item.word}`;
  return `${item.word.slice(0, at)}[ ${item.word[at]!.toUpperCase()} ]${item.word.slice(at + 1)}`;
}

/** Library order: by title, with a leading article left out. */
export function libraryOrder<T extends { title: string }>(books: readonly T[]): T[] {
  const bare = (t: string): string => t.replace(/^(the|an|a)\s+/i, '');
  return [...books].sort((a, b) => bare(a.title).localeCompare(bare(b.title), 'en', { sensitivity: 'base' }));
}

export function createMenu(opts: MenuOptions): Menu {
  const $ = (id: string): HTMLElement => document.getElementById(id)!;
  const frame = $('menu');
  const strip = $('menu-strip');
  const toggle = $('menu-toggle') as HTMLButtonElement;
  const booksList = $('menu-books');
  let open = false;
  /** The control that opened the menu from the keyboard, to give the focus back to. */
  let opener: HTMLElement | null = null;
  /** A press is going on inside the menu: a blur during it is not a reason to close. */
  let pressing = false;
  let touch = false;

  const rows: { slug: string; link: HTMLAnchorElement; mark: HTMLElement }[] = [];
  for (const book of libraryOrder(opts.books)) {
    const band = document.createElement('div');
    band.className = 'menu-band';
    band.setAttribute('role', 'listitem');
    const mark = document.createElement('span');
    mark.className = 'menu-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = '[▸]';
    const link = document.createElement('a');
    link.className = 'menu-book';
    link.href = `#/book/${book.slug}`;
    link.textContent = book.title;
    link.dataset.menuTitle = '';
    link.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      pick(book.slug);
    });
    band.addEventListener('click', (e) => {
      if (!(e.target as Element).closest('a, button')) pick(book.slug);
    });
    band.append(mark, link);
    booksList.append(band);
    rows.push({ slug: book.slug, link, mark });
  }

  const row = (item: MenuItem, className: string): HTMLAnchorElement => {
    const a = document.createElement('a');
    a.className = className;
    a.href = '#';
    a.textContent = keyed(item);
    a.setAttribute('aria-label', item.word);
    if (item.key) {
      a.setAttribute('aria-keyshortcuts', item.key);
      a.title = `Key: ${item.key}`;
    }
    a.addEventListener('click', (e) => {
      e.preventDefault();
      set(false);
      item.run();
    });
    return a;
  };
  for (const link of opts.links) {
    const a = document.createElement('a');
    a.className = 'menu-row menu-link';
    a.href = link.href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = `${link.word} ↗`;
    $('menu-links').append(a);
  }

  const focusables = (): HTMLElement[] =>
    [...frame.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')].filter((e) => e.tabIndex >= 0 && e.getClientRects().length > 0);

  function refresh(): void {
    const here = opts.current();
    for (const r of rows) {
      const mine = r.slug === here;
      if (mine) r.link.setAttribute('aria-current', 'true');
      else r.link.removeAttribute('aria-current');
      r.mark.classList.toggle('is-current', mine);
    }
    const title = opts.books.find((b) => b.slug === here)?.title;
    toggle.setAttribute('aria-label', `Site menu: every book and the sections of the page.${title ? ` Current book: ${title}.` : ''}`);
    $('menu-sections').replaceChildren(...opts.sections().map((s) => row(s, 'menu-row')));
    const own = opts.bookSections();
    $('menu-book-head').hidden = own.length === 0;
    $('menu-book-sections').replaceChildren(...own.map((s) => row(s, 'menu-row')));
    // Measured: the panel is as tall as its rows, 25 px each, with 71 px for the heads and the padding, and no taller
    // than 78 percent of the window.
    const sectionRows = opts.sections().length + own.length + (own.length ? 1 : 0) + opts.links.length + 1;
    frame.style.setProperty('--menu-rows', String(Math.max(rows.length, sectionRows)));
    for (const el of frame.querySelectorAll<HTMLElement>('.menu-book, .menu-row')) el.tabIndex = open ? 0 : -1;
  }

  function set(on: boolean): void {
    if (on === open) return;
    open = on;
    frame.toggleAttribute('data-open', on);
    toggle.setAttribute('aria-expanded', String(on));
    for (const el of frame.querySelectorAll<HTMLElement>('.menu-book, .menu-row')) el.tabIndex = on ? 0 : -1;
    if (!on) opener = null;
  }

  function pick(slug: string): void {
    const back = opener;
    set(false);
    if (touch && frame.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    opts.onBook(slug);
    if (back && slug !== opts.current()) back.focus({ preventScroll: true });
  }

  /** Opened from the keyboard: the focus goes to the current book, or the first. */
  function openFrom(control: HTMLElement): void {
    opener = control;
    set(true);
    refresh();
    const first = frame.querySelector<HTMLElement>('[aria-current="true"]') ?? frame.querySelector<HTMLElement>('[data-menu-title]');
    first?.focus({ preventScroll: true });
    first?.scrollIntoView({ block: 'nearest' });
  }

  const blocked = (x: number): boolean => x >= (opts.blockedFrom?.() ?? Infinity);
  frame.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'mouse' && !blocked(e.clientX)) set(true);
  });
  frame.addEventListener('pointermove', (e) => {
    if (!open && e.pointerType === 'mouse' && !blocked(e.clientX)) set(true);
  });
  frame.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') set(false);
  });
  frame.addEventListener(
    'pointerdown',
    (e) => {
      touch = e.pointerType !== 'mouse';
      pressing = true;
      const done = (): void => {
        pressing = false;
        removeEventListener('pointerup', done, true);
        removeEventListener('pointercancel', done, true);
      };
      addEventListener('pointerup', done, true);
      addEventListener('pointercancel', done, true);
    },
    true,
  );
  frame.addEventListener('focusin', (e) => {
    if (!(e.target as Element).closest('#menu-strip')) set(true);
  });
  frame.addEventListener('focusout', (e) => {
    if (!pressing && !frame.contains(e.relatedTarget as Node | null)) set(false);
  });
  frame.addEventListener('keydown', (e) => {
    touch = false;
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      const back = opener;
      set(false);
      if (back?.isConnected) back.focus({ preventScroll: true });
      else (document.activeElement as HTMLElement | null)?.blur();
      return;
    }
    if (e.key !== 'Tab' || !opener) return;
    // Opened from the keyboard, Tab goes round inside the menu.
    const list = focusables();
    if (!list.length) return;
    e.preventDefault();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const next = list[at < 0 ? 0 : (at + (e.shiftKey ? -1 : 1) + list.length) % list.length]!;
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: 'nearest' });
  });
  // A tap on the strip opens and closes the menu; a tap anywhere else closes it.
  let down: { id: number; x: number; y: number } | null = null;
  strip.addEventListener('pointerdown', (e) => {
    down = e.pointerType === 'mouse' ? null : { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  strip.addEventListener('pointerup', (e) => {
    const d = down;
    down = null;
    if (d && d.id === e.pointerId && Math.hypot(e.clientX - d.x, e.clientY - d.y) <= 8) set(!open);
  });
  strip.addEventListener('pointercancel', () => (down = null));
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (open && e.pointerType !== 'mouse' && !frame.contains(e.target as Node)) set(false);
    },
    { passive: true },
  );
  toggle.addEventListener('click', () => (open ? set(false) : openFrom(toggle)));

  refresh();
  return {
    get open() {
      return open;
    },
    set,
    refresh,
  };
}
