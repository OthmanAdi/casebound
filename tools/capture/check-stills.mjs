// Checks the page without WebGL in a real browser: that `?nowebgl` shows stills and is remembered for the tab,
// that a still rides the scroll and lingers at its book, turns under a sideways pull and faces the front again
// after it was out of sight, that a press opens the details, and that the row chooses and opens a book.
//
//   node tools/capture/check-stills.mjs <base url> [--shots <dir>]
//
// Prints one line per step and exits with 1 if a step fails.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const [base, ...rest] = process.argv.slice(2);
if (!base) {
  console.error('usage: node check-stills.mjs <base url> [--shots <dir>]');
  process.exit(2);
}
const shots = rest.indexOf('--shots') > -1 ? resolve(rest[rest.indexOf('--shots') + 1]) : null;
if (shots) mkdirSync(shots, { recursive: true });
const root = base.replace(/\/$/, '');

const browser = await chromium.launch({ channel: process.env.RE_CHANNEL ?? 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
let failed = 0;
const say = (ok, text) => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
};
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  const ready = () => page.waitForSelector('html[data-casebound-ready="true"]', { state: 'attached', timeout: 30000 });
  const shot = async (name) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png` }); };
  /** The stills that can be seen, with the middle of each. */
  const seen = () => page.evaluate(() => [...document.querySelectorAll('.still[data-shown="true"]')].map((e) => { const r = e.getBoundingClientRect(); return { slug: e.dataset.slug, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width) }; }));
  const slot = () => page.evaluate(() => document.querySelector('.panel').offsetHeight + 16);
  const view = () => page.evaluate(() => document.documentElement.dataset.caseboundView);

  await page.goto(root + '/?nowebgl&midday', { waitUntil: 'load', timeout: 60000 });
  await ready();
  await page.waitForTimeout(500);
  const start = await page.evaluate(() => ({
    mode: document.documentElement.dataset.stills,
    canvas: getComputedStyle(document.getElementById('stage')).display,
    stills: document.querySelectorAll('.still').length,
    books: casebound.library.books.length,
    featured: casebound.library.featured,
    engine: 'engine' in casebound,
    faces: document.querySelectorAll('.still:first-child .still-face').length,
    note: document.getElementById('stills-note')?.getAttribute('href') ?? '',
  }));
  say(start.mode === 'asked' && start.canvas === 'none' && !start.engine, `?nowebgl shows the page of stills and starts no engine: mode ${start.mode}, canvas ${start.canvas}`);
  say(start.stills === start.books && start.faces === 6, `every book has a still of six faces: ${start.stills} of ${start.books}`);
  const first = await seen();
  say(first.length === 1 && first[0].slug === start.featured[0] && Math.abs(first[0].x - 720) < 4 && Math.abs(first[0].y - 505) < 30, `the first featured book stands in the middle of its picture: ${JSON.stringify(first)}`);
  await shot('stills-01-first');

  // A still lingers at its book: a tenth of the way to the next book moves it by little.
  const pitch = await page.evaluate(() => document.getElementById('pictures').clientHeight + 24);
  const h = await slot();
  await page.evaluate((y) => scrollTo(0, y), Math.round(h * 0.1));
  await page.waitForTimeout(250);
  const lingered = (await seen())[0];
  const moved = first[0].y - lingered.y;
  say(moved > 0 && moved < pitch * 0.03, `a tenth of the way on, the still has moved ${moved} px of ${pitch} (it lingers)`);
  await page.evaluate((y) => scrollTo(0, y), h);
  await page.waitForTimeout(600);
  const second = await seen();
  say(second.length === 1 && second[0].slug === start.featured[1] && Math.abs(second[0].y - first[0].y) < 3, `one stretch on, the second book stands where the first stood: ${JSON.stringify(second)}`);
  const title = await page.evaluate(() => document.querySelector('.m-title.is-current')?.textContent ?? '');
  const wanted = await page.evaluate((slug) => casebound.library.books.find((b) => b.slug === slug).title, start.featured[1]);
  say(title.startsWith(wanted), `the title row stands at it: "${title.slice(0, 30)}"`);

  // A sideways pull turns the book; the press that ends it opens nothing.
  const at = second[0];
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 60, at.y + 2, { steps: 6 });
  await page.mouse.move(at.x + 150, at.y + 2, { steps: 8 });
  await page.waitForTimeout(80);
  const turned = await page.evaluate((slug) => casebound.stills.turnOf(slug), at.slug);
  await shot('stills-02-turned');
  await page.mouse.up();
  await page.waitForTimeout(120);
  const expected = 150 / (1.5 * at.w);
  say(Math.abs(turned - expected) < 0.03 && (await view()) === '/', `a pull of 150 px turns the book ${turned.toFixed(3)} of a turn (${expected.toFixed(3)} expected) and opens nothing`);
  // Out of sight and back: it faces the front again.
  await page.evaluate((y) => scrollTo(0, y), h * 3);
  await page.waitForTimeout(500);
  await page.evaluate((y) => scrollTo(0, y), h);
  await page.waitForTimeout(1300);
  const back = await page.evaluate((slug) => casebound.stills.turnOf(slug), at.slug);
  say(Math.abs(back) < 1e-6, `after it was out of sight it faces the front again: ${back.toFixed(4)}`);

  // A pull up or down is the page's own; a press opens the details, Escape closes them.
  await page.waitForTimeout(450);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(900);
  const opened = await page.evaluate(() => ({ view: document.documentElement.dataset.caseboundView, hidden: document.getElementById('detail').hidden, aside: document.documentElement.hasAttribute('data-aside'), read: getComputedStyle(document.querySelector('.dp-book.is-current .row-read')).display, label: document.getElementById('section-label').textContent }));
  say(opened.view === `/book/${at.slug}` && !opened.hidden && opened.aside && opened.read === 'none', `a press opens the details of that book, without a way to a reader: ${JSON.stringify(opened)}`);
  await shot('stills-03-details');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  const closed = await page.evaluate(() => ({ view: document.documentElement.dataset.caseboundView, hidden: document.getElementById('detail').hidden, y: Math.round(scrollY) }));
  say(closed.view === '/' && closed.hidden && Math.abs(closed.y - h) < 3, `Escape closes them and the page stands at the book again: ${JSON.stringify(closed)}`);

  // The row: every book, the chosen one showing its cover; the arrows choose, a press on the chosen one opens it.
  await page.evaluate((y) => scrollTo(0, y), h * start.featured.length);
  await page.waitForTimeout(700);
  const row = () => page.evaluate(() => {
    const chosen = document.querySelector('.row-book.is-chosen');
    const r = chosen.getBoundingClientRect();
    return { label: document.getElementById('section-label').textContent, books: document.querySelectorAll('.row-book').length, chosen: chosen.dataset.slug, api: casebound.stills.chosen, middle: Math.round(r.left + r.width / 2), cover: getComputedStyle(chosen.querySelector('.row-front')).display, stills: document.querySelectorAll('.still[data-shown="true"]').length };
  });
  const r1 = await row();
  say(r1.label === 'All books' && r1.books === start.books && r1.cover === 'block' && r1.stills === 0, `at the end of the shelf every book stands in a row and one shows its cover: ${JSON.stringify(r1)}`);
  await shot('stills-04-row');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(800);
  const r2 = await row();
  say(r2.chosen !== r1.chosen && r2.api === r2.chosen && Math.abs(r2.middle - 720) < 4, `the right arrow chooses the next book and brings it to the middle: ${r2.chosen} at ${r2.middle}`);
  await page.click('.row-book.is-chosen');
  await page.waitForTimeout(900);
  say((await view()) === `/book/${r2.chosen}`, `a press on the chosen book opens its details: ${await view()}`);

  // The tab remembers; `?webgl` forgets.
  await page.goto(root + '/?midday', { waitUntil: 'load', timeout: 60000 });
  await ready();
  const kept = await page.evaluate(() => document.documentElement.dataset.stills ?? '');
  say(kept === 'asked', `the tab remembers that stills were asked for: "${kept}"`);
  await page.goto(root + '/?webgl&midday', { waitUntil: 'load', timeout: 60000 });
  await ready();
  const drawn = await page.evaluate(() => ({ stills: document.documentElement.dataset.stills ?? '', engine: 'engine' in casebound }));
  say(drawn.stills === '' && drawn.engine, `?webgl brings the drawn books back: ${JSON.stringify(drawn)}`);

  // A link to a book opens its details here too.
  await page.goto(root + '/?nowebgl&midday#/book/' + start.featured[2], { waitUntil: 'load', timeout: 60000 });
  await ready();
  await page.waitForTimeout(500);
  const linked = await page.evaluate(() => ({ view: document.documentElement.dataset.caseboundView, still: document.querySelector('.still[data-shown="true"]')?.dataset.slug ?? '' }));
  say(linked.view === `/book/${start.featured[2]}` && linked.still === start.featured[2], `a link to a book opens its details beside its still: ${JSON.stringify(linked)}`);
  await page.goto(root + '/?webgl&midday', { waitUntil: 'load', timeout: 60000 });

  for (const e of errors) { failed++; console.log('FAIL page error: ' + e); }
} finally {
  await browser.close();
}
console.log(failed ? `${failed} step(s) failed` : 'stills: all steps passed');
process.exit(failed ? 1 : 0);
