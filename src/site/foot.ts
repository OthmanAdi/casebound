/**
 * The foot of the page: the dark band of cards and the copy button of the footer. It needs the library and
 * nothing of the engine, so the page of stills shows the same foot as the page with the books.
 */
import { paintBackdrop } from './backdrop';
import type { Library } from './library';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/**
 * The measured rules of the band (read in the reference's scripts, see `research/SPEC.md`, S-FOOT). Widths are shares
 * of the window, times in milliseconds.
 */
export const BAND = {
  /** A card's width: 0.6 of the window, 0.8 under `narrow`. */
  width: 0.6,
  widthNarrow: 0.8,
  narrow: 900,
  /** A card's height: 9/16 of its width, 0.9 of it under `narrow`. */
  aspect: 9 / 16,
  aspectNarrow: 0.9,
  /** Room between cards, and between the first or last card in front and the edge of the window. */
  gap: 16,
  gapNarrow: 8,
  edge: 16,
  /** The picture of a card that is neither in front, under the mouse nor playing. */
  dim: 0.55,
  /** A drag: pixels before it decides its axis, the give past either end, and what a release needs to step one card. */
  slop: 8,
  rubber: 0.2,
  stepPx: 56,
  stepShare: 0.08,
  flickPx: 20,
  flickSpeed: 300,
  /** A sideways wheel gesture steps once and ends after this long without a wheel event. */
  gestureIdle: 150,
  /** A film loads once the band is this near the window, plays while the band is this much in view (pointer devices). */
  nearPx: 200,
  inView: 0.98,
  /** A film starts this long after it was asked to play (at once after a press), and no sooner than `ready` after its data. */
  startDelay: 320,
  ready: 260,
};

/** One silent film of this page per card, recorded with `tools/capture/record.mjs`: `public/band/<name>.webm` and `.mp4`. */
const FILMS = ['shelf', 'hand', 'row', 'reading', 'lens', 'light'];

/** Fills the band and wires the footer. `still` says whether motion is unwanted: then no film loads or plays. */
export function mountFoot(library: Library, still: () => boolean): void {
  // Measured: after the row a dark band holds a row of wide cards, each with a title, a line of who made it, a few
  // sentences and a line of facts below a rule; the card in front is lit, the others stand at 0.55. Ours shows what
  // a visitor can do with the books: each card's still is painted like the pictures of the shelf, and its film is a
  // recording of this page doing what the card describes.
  const howTo = [
    { title: 'The shelf', body: 'Scroll, or press the arrow keys up and down. Each book holds at the centre for a moment, tilts toward the pointer and turns away as it leaves.', meta: 'Keys [ ↓ ↑ ]' },
    { title: 'A book in your hand', body: 'Drag the book. It follows through a spring, coasts on when you let go, and the cover that trails the turn lifts off the pages.', meta: 'Pointer [ drag ]' },
    { title: 'The whole library', body: 'Scroll to the end of the shelf and every book stands in a row, spine to the front. The arrow keys, a press on a spine or a pull on the row choose one.', meta: 'Keys [ ← → ]' },
    { title: 'Reading', body: 'Space or Open book opens it. The arrow keys or a tap turn a leaf; Shift with an arrow, or Page Down and Page Up, turn ten as one block.', meta: 'Keys [ Space ← → ]' },
    { title: 'The lens', body: 'Press m, or the lens button, and a round magnifier follows the pointer over the print.', meta: 'Key [ M ]' },
    { title: 'Light on the print', body: 'In the details of a book, hover E-book or Audiobook: the print shears under scanlines and splits its colours, or rings ripple the pages.', meta: 'Pointer [ hover ]' },
  ];
  const band = $('band');
  const stage = $('band-cards');
  const n = howTo.length;
  const webm = document.createElement('video').canPlayType('video/webm; codecs="vp9"') !== '';
  const cards = howTo.map((item, k) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'band-card';
    card.setAttribute('aria-label', item.title);
    card.dataset.film = FILMS[k]!;
    const book = library.books[k % library.books.length]!;
    // The painted picture is the film's poster: it is what the card shows until a frame of its film is decoded.
    const still = document.createElement('span');
    still.className = 'band-still';
    still.style.backgroundImage = `url(${paintBackdrop(book.background ?? '#77808a', `${book.slug} card`, 864, 486)})`;
    card.append(still);
    stage.append(card);
    return card;
  });

  let active = 0;
  /** Where the track stands, in cards: `active` at rest, a fraction while a drag carries it. */
  let at = 0;
  let size = { w: 0, h: 0, gap: 0, width: 0 };
  const measure = (): void => {
    const width = stage.clientWidth;
    const narrow = width < BAND.narrow;
    const w = (narrow ? BAND.widthNarrow : BAND.width) * width;
    size = { w, h: w * (narrow ? BAND.aspectNarrow : BAND.aspect), gap: narrow ? BAND.gapNarrow : BAND.gap, width };
    stage.style.height = `${size.h.toFixed(1)}px`;
    for (const card of cards) card.style.width = `${size.w.toFixed(1)}px`;
  };
  /** Left edge and opacity of card `k` while card `front` is in front. */
  const placed = (k: number, front: number): { x: number; o: number } => {
    const { w, gap, width } = size;
    const base = front === 0 ? BAND.edge : front === n - 1 ? width - BAND.edge - w : (width - w) / 2;
    return { x: base + (k - front) * (w + gap), o: Math.abs(k - front) >= 2 ? 0 : 1 };
  };
  const layout = (): void => {
    const lo = Math.max(0, Math.min(n - 2, Math.floor(at)));
    const t = at - lo;
    for (const [k, card] of cards.entries()) {
      const a = placed(k, lo);
      const b = placed(k, lo + 1);
      const x = a.x + (b.x - a.x) * t;
      const o = Math.max(0, Math.min(1, a.o + (b.o - a.o) * t));
      card.style.transform = `translateX(${x.toFixed(2)}px)`;
      card.style.opacity = String(o);
      card.style.pointerEvents = o < 0.5 ? 'none' : '';
      card.tabIndex = Math.abs(k - active) <= 1 ? 0 : -1;
    }
  };

  // ---------------------------------------------------------------- films
  // Measured: the card in front plays while the band is all but wholly in view (always on a device without hover),
  // a card under the mouse plays, and a press toggles the card it lands on. Nothing loads before the band is near,
  // and only a card asked to play gets a film: the one in front, or a neighbour that was hovered or pressed.
  const noHover = matchMedia('(hover: none)');
  let hovered = -1;
  let toggled: { index: number; playing: boolean } | null = null;
  const touched = new Set<number>();
  let near = false;
  let shown = false;
  let whole = false;
  type Film = { video: HTMLVideoElement; ready: boolean; loadedAt: number; askedAt: number | null; timer: number };
  const films = new Map<number, Film>();

  /** The card in front plays by the rule alone: on a pointer device while the band is all but wholly in view. */
  const byRule = (): boolean => !noHover.matches && whole;
  const playing = (k: number): boolean => {
    if (still()) return false;
    if (toggled?.index === k) return toggled.playing;
    return hovered === k || (k === active && (noHover.matches || whole));
  };
  const wanted = (k: number): boolean => near && !still() && (k === active || (Math.abs(k - active) <= 1 && (touched.has(k) || toggled?.index === k)));

  const filmFor = (k: number): Film => {
    let film = films.get(k);
    if (film) return film;
    const video = document.createElement('video');
    video.className = 'band-film';
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'none';
    video.setAttribute('aria-hidden', 'true');
    video.src = `band/${FILMS[k]}.${webm ? 'webm' : 'mp4'}`;
    film = { video, ready: false, loadedAt: 0, askedAt: null, timer: 0 };
    const own = film;
    video.addEventListener('loadeddata', () => {
      own.ready = true;
      own.loadedAt = performance.now();
      video.classList.add('is-ready');
      cards[k]!.classList.add('has-film');
      sync();
    });
    cards[k]!.append(video);
    films.set(k, film);
    return film;
  };

  /** Brings every card's film in line with the rules: made or dropped, loaded, started after its delay, paused. */
  function sync(): void {
    for (const [k, card] of cards.entries()) {
      const lit = k === active || playing(k);
      card.classList.toggle('is-lit', lit);
      if (!wanted(k)) {
        const film = films.get(k);
        if (film) {
          clearTimeout(film.timer);
          film.video.pause();
          film.video.removeAttribute('src');
          film.video.load();
          film.video.remove();
          card.classList.remove('has-film');
          films.delete(k);
        }
        continue;
      }
      const film = filmFor(k);
      const play = playing(k) && shown;
      if (playing(k)) film.askedAt ??= performance.now();
      else film.askedAt = null;
      clearTimeout(film.timer);
      if (!play) {
        film.video.pause();
        continue;
      }
      if (!film.ready) {
        if (film.video.preload !== 'auto') {
          film.video.preload = 'auto';
          film.video.load();
        }
        continue;
      }
      const now = performance.now();
      const wait = Math.max(0, film.loadedAt + BAND.ready - now, toggled?.index === k ? 0 : (film.askedAt ?? now) + BAND.startDelay - now);
      const start = (): void => void film.video.play().catch(() => undefined);
      if (wait === 0) start();
      else film.timer = window.setTimeout(start, wait);
    }
  }

  if (typeof IntersectionObserver === 'undefined') {
    near = shown = whole = true;
  } else {
    const nearby = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        near = true;
        nearby.disconnect();
        sync();
      }
    }, { rootMargin: `${BAND.nearPx}px` });
    nearby.observe(stage);
    new IntersectionObserver((entries) => {
      const e = entries[entries.length - 1]!;
      shown = e.isIntersecting;
      whole = e.isIntersecting && e.intersectionRatio >= BAND.inView;
      sync();
    }, { threshold: [0, BAND.inView] }).observe(stage);
  }
  noHover.addEventListener('change', sync);
  // Reduced motion asked for while the page is open: every film stops and goes. The engine reads the change first.
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => setTimeout(sync, 0));

  // ---------------------------------------------------------------- stepping
  function select(k: number): void {
    const next = Math.max(0, Math.min(n - 1, k));
    if (next !== active) {
      active = next;
      // A film that was toggled belongs to its card: stepping away forgets it, as the reference does.
      if (toggled && toggled.index !== active) toggled = null;
      $('band-card-title').textContent = howTo[active]!.title;
      $('band-card-body').textContent = howTo[active]!.body;
      $('band-card-meta').textContent = howTo[active]!.meta;
    }
    at = active;
    layout();
    sync();
  }
  $('band-card-title').textContent = howTo[0]!.title;
  $('band-card-body').textContent = howTo[0]!.body;
  $('band-card-meta').textContent = howTo[0]!.meta;

  for (const [k, card] of cards.entries()) {
    card.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse') return;
      hovered = k;
      touched.add(k);
      sync();
    });
    card.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (hovered === k) hovered = -1;
      // A film that was started by hand stays as it is; one that only played under the mouse goes back to the rule.
      if (toggled?.index === k && !toggled.playing && !(byRule() && k === active)) toggled = null;
      sync();
    });
    // A press or a drag with the mouse leaves no focus on the card, so Space and the arrows go on serving the page.
    card.addEventListener('mousedown', (e) => e.preventDefault());
    card.addEventListener('click', () => {
      if (dragged) return;
      touched.add(k);
      // A press toggles: on the card in front that plays by the rule it pauses, on any other it plays at once.
      toggled = { index: k, playing: toggled?.index === k ? !toggled.playing : !(byRule() && k === active) };
      select(k);
    });
  }

  // A drag: decides its axis after a few pixels, carries the track with a give past the ends, and on release steps
  // one card if it went far enough or was flicked.
  let drag: { id: number; x: number; y: number; axis: 'x' | 'y' | null; samples: Array<[number, number]> } | null = null;
  let dragged = false;
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !e.isPrimary) return;
    dragged = false;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, axis: null, samples: [[e.clientX, e.timeStamp]] };
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (drag.axis === null) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < BAND.slop) return;
      drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (drag.axis === 'x') {
        stage.setPointerCapture(e.pointerId);
        stage.classList.add('is-dragging');
        dragged = true;
      }
    }
    if (drag.axis !== 'x') return;
    e.preventDefault();
    drag.samples.push([e.clientX, e.timeStamp]);
    if (drag.samples.length > 6) drag.samples.shift();
    const want = active - dx / Math.max(1, size.w + size.gap);
    const held = Math.max(0, Math.min(n - 1, want));
    at = held + (want - held) * BAND.rubber;
    layout();
  });
  const release = (e: PointerEvent, cancel: boolean): void => {
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag;
    drag = null;
    stage.classList.remove('is-dragging');
    if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
    if (d.axis !== 'x') return;
    const dx = e.clientX - d.x;
    const [x0, t0] = d.samples[0]!;
    const speed = e.timeStamp > t0 ? ((e.clientX - x0) / (e.timeStamp - t0)) * 1000 : 0;
    const flick = Math.abs(dx) >= BAND.flickPx && Math.abs(speed) >= BAND.flickSpeed && Math.sign(speed) === Math.sign(dx);
    const far = Math.abs(dx) >= Math.min(BAND.stepPx, BAND.stepShare * size.width);
    select(!cancel && (far || flick) ? active + (dx < 0 ? 1 : -1) : active);
    // The click that ends a drag selects nothing.
    setTimeout(() => (dragged = false), 0);
  };
  stage.addEventListener('pointerup', (e) => release(e, false));
  stage.addEventListener('pointercancel', (e) => release(e, true));
  // A finger that pans sideways is the band's, a finger that pans up or down is the page's.
  stage.addEventListener('touchmove', (e) => { if (drag?.axis === 'x' && e.touches.length === 1 && e.cancelable) e.preventDefault(); }, { passive: false });

  // One card per sideways wheel gesture: the gesture ends after a short quiet.
  let gestureEnds = 0;
  stage.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    const fresh = e.timeStamp > gestureEnds;
    gestureEnds = e.timeStamp + BAND.gestureIdle;
    if (fresh) select(active + Math.sign(e.deltaX));
  }, { passive: false });

  // The left and right keys while the band is the section at the top of the window, before the row would take them.
  addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    const r = band.getBoundingClientRect();
    if (r.height === 0 || r.top > 40 || $('foot').getBoundingClientRect().top <= 40) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    select(active + (e.key === 'ArrowRight' ? 1 : -1));
  }, { capture: true });

  measure();
  layout();
  sync();
  stage.classList.add('is-placed');
  new ResizeObserver(() => {
    measure();
    layout();
  }).observe(stage);

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
}
