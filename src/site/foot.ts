/**
 * The foot of the page: the dark band of cards and the copy button of the footer. It needs the library and
 * nothing of the engine, so the page of stills shows the same foot as the page with the books.
 */
import { paintBackdrop } from './backdrop';
import type { Library } from './library';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** Fills the band and wires the footer. `still` says whether motion is unwanted. */
export function mountFoot(library: Library, still: () => boolean): void {
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
    if (bring) bandRow.scrollTo({ left: bandCards[k]!.offsetLeft - bandRow.offsetLeft, behavior: still() ? 'auto' : 'smooth' });
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
}
