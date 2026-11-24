// Checks the shelf in a real browser: a book turned by hand, its coasting, a press that opens the details,
// a turned book that forgets its turn when it leaves the centre, and the row of spines at the end of the
// shelf. The engine's clock is driven by hand.
//
//   node tools/capture/check-shelf.mjs <base url> [--shots <dir>]
//
// Prints one line per step and exits with 1 if a step fails.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const [base, ...rest] = process.argv.slice(2);
if (!base) {
  console.error('usage: node check-shelf.mjs <base url> [--shots <dir>]');
  process.exit(2);
}
const shots = rest.indexOf('--shots') > -1 ? resolve(rest[rest.indexOf('--shots') + 1]) : null;
if (shots) mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ channel: process.env.RE_CHANNEL ?? 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
let failed = 0;
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  await page.goto(base.replace(/\/$/, '') + '/?midday', { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('html[data-casebound-ready="true"]', { state: 'attached', timeout: 30000 });
  await page.evaluate(() => { casebound.engine.ctx.loop.stop(); window.__clock = performance.now(); });

  const run = (seconds) => page.evaluate((n) => { for (let i = 0; i < n; i++) { window.__clock += 1000 / 60; casebound.engine.ctx.loop.tick(window.__clock); } }, Math.round(seconds * 60));
  const state = () => page.evaluate(() => {
    const { engine } = casebound;
    const first = engine.books[casebound.shelf.order[0]];
    const book = engine.books[engine.state.active];
    return { active: engine.state.active, yaw: book.turned.yaw, pitch: book.turned.pitch, front: book.flap.front, back: book.flap.back, firstYaw: first.turned.yaw, view: document.documentElement.dataset.caseboundView };
  });
  const centre = () => page.evaluate(() => {
    const { ctx } = casebound.engine;
    const root = casebound.engine.books[casebound.engine.state.active].root;
    const v = root.position.clone();
    root.getWorldPosition(v);
    v.project(ctx.camera);
    const r = ctx.canvas.getBoundingClientRect();
    return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (0.5 - v.y * 0.5) * r.height };
  });
  const check = async (name, test) => {
    const got = await state();
    const ok = Boolean(test(got));
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: yaw ${got.yaw.toFixed(3)}, pitch ${got.pitch.toFixed(3)}, covers ${got.front.toFixed(3)} / ${got.back.toFixed(3)}, view ${got.view}`);
    return got;
  };
  const shot = async (name) => { if (shots) await page.screenshot({ path: resolve(shots, name + '.png') }); };

  await run(2.6);
  const c = await centre();
  await check('at rest', (s) => s.yaw === 0 && s.pitch === 0 && s.front === 0 && s.view === '/');

  // Turn the book to the right by 240 px, quickly enough for the cover to lift.
  await page.mouse.move(c.x, c.y);
  await run(0.1);
  await page.mouse.down();
  let lifted = 0;
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(c.x + i * 20, c.y - i * 2);
    await run(1 / 30);
    const s = await state();
    lifted = Math.max(lifted, s.front, s.back);
    if (i === 8) await shot('turning');
  }
  const held = await check('turned by hand', (s) => s.yaw > 1.2 && s.pitch < 0);
  console.log(`${lifted > 0.03 ? 'ok  ' : 'FAIL'} a cover lifted while it turned: ${lifted.toFixed(3)} rad`);
  if (!(lifted > 0.03)) failed++;
  await page.mouse.up();
  await run(0.2);
  await shot('let go');
  await page.mouse.move(30, 300);
  await run(4);
  await check('keeps its turn and comes to rest with the covers shut', (s) => s.yaw >= held.yaw - 0.05 && s.front === 0 && s.back === 0);
  await shot('at rest turned');

  // Measured: on the shelf a pointer that rests on a featured book does not lift its cover.
  await page.mouse.move(c.x, c.y);
  await run(1.5);
  await check('the cover stays shut under a resting pointer on the shelf', (s) => s.front === 0);

  // A press that does not move opens the details. There the cover lifts a little under the pointer.
  await page.mouse.click(c.x, c.y);
  await run(1.2);
  await check('a press opens the details', (s) => typeof s.view === 'string' && s.view.startsWith('/book/'));
  const where = await page.evaluate(() => {
    const { ctx } = casebound.engine;
    const v = casebound.engine.books[casebound.engine.state.active].root.position.clone().project(ctx.camera);
    const r = ctx.canvas.getBoundingClientRect();
    return [r.left + (v.x * 0.5 + 0.5) * r.width, r.top + (0.5 - v.y * 0.5) * r.height];
  });
  await page.mouse.move(where[0] + 6, where[1] + 6);
  await page.mouse.move(where[0], where[1]);
  await run(1.5);
  await check('in the details the cover lifts under a resting pointer', (s) => Math.abs(s.front - 5 * Math.PI / 180) < 0.01);
  await shot('peek');
  // The page around the details. Its transitions run on the browser's clock, so these wait in real time.
  const around = () => page.evaluate(() => {
    const r = (id) => document.getElementById(id).getBoundingClientRect();
    const cs = (el) => getComputedStyle(el);
    const bar = document.querySelector('.bar-actions');
    const col = document.querySelector('.dp-book.is-current .dp-col');
    return { column: col ? col.getBoundingClientRect().left : -1, picture: r('pictures').right, back: { left: r('home-link').left, top: r('home-link').top, opacity: +cs(document.getElementById('home-link')).opacity }, clip: cs(document.getElementById('marquee')).clipPath, bar: cs(bar).visibility, hidden: document.getElementById('detail').hidden, w: innerWidth };
  });
  await page.waitForTimeout(1800);
  {
    const a = await around();
    const ok = Math.abs(a.column - (0.6 * a.w + 24)) < 1 && Math.abs(a.picture - (0.6 * a.w - 3)) < 1 && Math.abs(a.back.left - a.column) < 1 && a.back.top < 60 && a.back.opacity > 0.99 && /40%/.test(a.clip) && a.bar === 'hidden';
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} beside the details: picture to ${a.picture.toFixed(0)} px, column from ${a.column.toFixed(0)} px, the way back above it at ${a.back.left.toFixed(0)}, ${a.back.top.toFixed(0)}, title row cut (${a.clip}), bar buttons ${a.bar}`);
  }
  {
    // A book opened from the details has the whole picture; Escape leaves the book and the details come back.
    await page.click('#row-read');
    await run(3.4);
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => ({ view: document.documentElement.dataset.caseboundView, aside: document.documentElement.hasAttribute('data-aside'), column: getComputedStyle(document.getElementById('detail')).visibility, picture: document.getElementById('pictures').getBoundingClientRect().right }));
    await page.keyboard.press('Escape');
    await run(2.6);
    await page.waitForTimeout(1600);
    const b = await around();
    const back = (await state()).view;
    const ok = /\/page\//.test(r.view) && !r.aside && r.column === 'hidden' && Math.abs(r.picture - (b.w - 16)) < 1 && /^\/book\/[^/]+$/.test(back) && Math.abs(b.column - (0.6 * b.w + 24)) < 1;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} a book opened from the details has the whole picture (to ${r.picture.toFixed(0)} px, column ${r.column}); Escape brings the details back (${back})`);
  }
  {
    // Sections with a rule each, a colophon, and a way on to the next book that keeps the details open.
    const d = await page.evaluate(() => ({ books: document.querySelectorAll('#detail .dp-book').length, all: casebound.engine.books.length, sections: [...document.querySelectorAll('#detail .dp-book.is-current .d-sec')].filter((s) => parseFloat(getComputedStyle(s).borderTopWidth) >= 1).map((s) => s.dataset.section), facts: document.querySelectorAll('#detail .dp-book.is-current .facts li').length, next: document.getElementById('detail-next').getAttribute('aria-label') }));
    let ok = d.books === d.all && d.sections.length >= 4 && d.sections.includes('Excerpt') && d.facts >= 4 && /^Next book: /.test(d.next);
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} the details are one page of ${d.books} books; this one holds ${d.sections.join(', ')}, ${d.facts} lines of colophon and "${d.next}"`);
    // As one page: the picture and the book stay at the top while the column scrolls past, go up with the page
    // when the book's part ends, and the next book comes up from below with its picture.
    const part = () => page.evaluate(() => {
      const a = document.querySelector('.dp-book.is-current');
      const cards = [...document.querySelectorAll('#pictures .card')].map((c) => ({ y: new DOMMatrix(c.style.transform).f, shown: getComputedStyle(c).visibility !== 'hidden' }));
      const { ctx } = casebound.engine;
      const v = casebound.engine.books[casebound.engine.state.active].root.position.clone().project(ctx.camera);
      return { slug: a.dataset.slug, top: a.offsetTop, hero: a.firstElementChild.offsetHeight, sy: scrollY, card: cards[casebound.library.featured.indexOf(a.dataset.slug)], bookY: (0.5 - v.y * 0.5) * innerHeight, strip: +(document.getElementById('marquee').style.opacity || 1), view: document.documentElement.dataset.caseboundView };
    });
    const p0 = await part();
    await page.evaluate((y) => scrollTo(0, y), p0.top + 150);
    await run(1.5);
    const p1 = await part();
    await page.evaluate((y) => scrollTo(0, y), p0.top + p0.hero - 900 + 450);
    await run(1.5);
    const p2 = await part();
    const nextTop = await page.evaluate(() => document.querySelectorAll('#detail .dp-book')[1].offsetTop);
    await page.evaluate((y) => scrollTo(0, y), nextTop + 60);
    await run(2.5);
    const p3 = await part();
    ok = Math.abs(p1.card.y) < 1 && Math.abs(p1.bookY - p0.bookY) < 2 && p1.strip === 1 && p2.card.y < -300 && p0.bookY - p2.bookY > 300 && p2.strip === 0 && p3.slug !== p0.slug && p3.view === `/book/${p3.slug}` && Math.abs(p3.card.y) < 1 && p3.strip === 1;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} as one page: 150 px down the picture holds (${p1.card.y.toFixed(1)}), past its part it has gone up ${(-p2.card.y).toFixed(0)} px with the book, and the next book, ${p3.slug}, stands at the top`);
    await page.evaluate((y) => scrollTo(0, y), p0.top);
    await run(2.5);
    const before = (await state()).view;
    await page.click('#detail-next', { force: true });
    await page.waitForTimeout(1600);
    await run(2);
    const after = await state();
    const moved = after.view !== before && after.view.startsWith('/book/');
    if (!moved) failed++;
    console.log(`${moved ? 'ok  ' : 'FAIL'} "Next" brings the next book with its details: ${before} to ${after.view}`);
    // Back to the first book for the steps that follow.
    await page.evaluate(() => scrollTo(0, 0));
    await run(3);
  }
  await page.keyboard.press('Escape');
  const leaving = await around();
  await run(1.2);
  await check('Escape closes them', (s) => s.view === '/');
  {
    // A clock-driven page renders seldom, so the fades are given time to finish on the browser's own clock.
    await page.waitForFunction(() => document.getElementById('detail').hidden && +getComputedStyle(document.getElementById('home-link')).opacity < 0.01, null, { timeout: 4000 }).catch(() => undefined);
    const gone = await around();
    const ok = !leaving.hidden && gone.hidden && gone.back.opacity < 0.01 && gone.bar === 'visible';
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} the column fades out before it goes, and the way back and the bar buttons follow`);
  }

  // The next book comes to the centre; the turned one forgets its turn.
  await page.evaluate(() => scrollTo(0, document.querySelector('.panel').offsetHeight + 16));
  await run(3);
  await check('the next book is centred and the first has forgotten its turn', (s) => s.active !== 0 && Math.abs(s.firstYaw) < 0.01 && s.yaw === 0);

  // The pictures: cards in one window below the title row, moved by the shelf's progress, not by the scroll bar.
  const pictures = () => page.evaluate(() => {
    const frame = document.getElementById('pictures').getBoundingClientRect();
    const cards = [...document.querySelectorAll('#pictures .card')].map((c) => { const r = c.getBoundingClientRect(); return { top: r.top - frame.top, height: r.height, shown: getComputedStyle(c).visibility !== 'hidden' && r.bottom > frame.top && r.top < frame.bottom }; });
    return { top: frame.top, bottom: frame.bottom, height: frame.height, progress: casebound.shelf.state.progress, cards };
  });
  const slotOf = () => page.evaluate(() => document.querySelector('.panel').offsetHeight + 16);
  const slot = await slotOf();
  await page.evaluate((y) => scrollTo(0, y), Math.round(slot * 1.5));
  await run(3);
  {
    const pic = await pictures();
    const pitch = pic.height + 24;
    const off = pic.cards.map((c, k) => Math.abs(c.top - (k - pic.progress) * pitch));
    const ok = pic.top >= 140 && off[1] < 1 && off[2] < 1 && pic.cards[1].shown && pic.cards[2].shown && Math.abs(pic.cards[2].top - pic.cards[1].top - pitch) < 1;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} half way between two books both pictures share the window below the title row (top ${pic.top}) and follow the books: off by ${off.map((x) => x.toFixed(1)).join(', ')} px`);
  }
  // In the dwell the book hardly moves, and nor does its picture: 60 px of scroll move it a few pixels only.
  await page.evaluate((y) => scrollTo(0, y), slot);
  await run(3);
  {
    const before = (await pictures()).cards[1].top;
    await page.evaluate((y) => scrollTo(0, y), slot + 60);
    await run(2);
    const after = (await pictures()).cards[1].top;
    const ok = Math.abs(after - before) > 2 && Math.abs(after - before) < 20;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} 60 px of scroll in the dwell move the picture by ${(before - after).toFixed(1)} px, as the book`);
  }

  // The title row: every book, three times over; it stays put until the current book changes, then glides.
  // Read from the place it is sent to, since its glide runs on the browser's clock, not the engine's.
  const titleRow = () => page.evaluate(() => {
    const cur = document.querySelector('.m-title.is-current');
    const track = document.querySelector('.marquee-track');
    const x = new DOMMatrix(track.style.transform).e;
    const up = cur.querySelector('.t-up');
    return { title: up.firstChild.textContent, x, centre: (x + new DOMMatrix(cur.style.transform).e + up.offsetWidth / 2) / innerWidth, count: document.querySelectorAll('.m-title').length, glide: getComputedStyle(track).transitionDuration, book: casebound.engine.books[casebound.engine.state.active].record.title, books: casebound.engine.books.length };
  });
  await page.evaluate((y) => scrollTo(0, y), slot);
  await run(2);
  const t0 = await titleRow();
  {
    const ok = t0.title === t0.book && Math.abs(t0.centre - 0.475) < 0.002 && t0.count === 3 * t0.books;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} the title row holds ${t0.count} titles, the current one "${t0.title}" centred at ${(t0.centre * 100).toFixed(1)} percent of the width`);
  }
  await page.evaluate((y) => scrollTo(0, y), Math.round(slot * 1.45));
  await run(2);
  const t1 = await titleRow();
  {
    const ok = t1.title === t0.title && Math.abs(t1.x - t0.x) < 0.5;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} 45 percent of the way to the next book the title row has not moved: ${(t1.x - t0.x).toFixed(1)} px`);
  }
  await page.evaluate((y) => scrollTo(0, y), Math.round(slot * 1.8));
  await run(2);
  const t2 = await titleRow();
  {
    const ok = t2.title === t2.book && t2.title !== t0.title && t2.x < t0.x - 50 && t2.glide === '0.5s';
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} past the turn of the current book the row glides to "${t2.title}" (${(t2.x - t0.x).toFixed(1)} px, in ${t2.glide})`);
  }
  {
    // The section label turns to the row's section 0.41 of the way from the last featured book to the row, by the
    // scroll bar itself: one frame after the scroll, whatever the books are still doing.
    const label = () => page.evaluate(() => document.getElementById('section-label').textContent);
    const last = slot * ((await page.evaluate(() => casebound.shelf.order.length)) - 1);
    await page.evaluate((y) => scrollTo(0, y), Math.round(last + 0.38 * slot));
    await run(2);
    const before = await label();
    await page.evaluate((y) => scrollTo(0, y), Math.round(last + 0.44 * slot));
    await run(1 / 60);
    const after = await label();
    const ok = before === 'Featured' && after === 'All books';
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} the section label turns between 0.38 and 0.44 of the way into the row, at once: "${before}", then "${after}"`);
  }
  // The row: past the last featured book every book of the library stands spine to the front.
  const row = () => page.evaluate(() => {
    const { engine, shelf, reader } = casebound;
    return { settled: shelf.row.settled, selected: shelf.row.selected, active: engine.books[engine.state.active].record.slug, reading: reader.isOpen ? reader.book.record.slug : null, visible: engine.books.filter((b) => b.root.visible).length, books: engine.books.length };
  });
  const rowCheck = async (name, test) => {
    const got = await row();
    const ok = Boolean(test(got));
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: chosen ${got.selected}, ${got.visible} of ${got.books} books in sight`);
    return got;
  };
  await page.mouse.move(30, 300);
  await page.evaluate(() => scrollTo(0, (document.querySelector('.panel').offsetHeight + 16) * casebound.shelf.order.length));
  await run(3.5);
  const lastFeatured = await page.evaluate(() => casebound.engine.books[casebound.shelf.order.at(-1)].record.slug);
  const stood = await rowCheck('the row stands with the last featured book chosen', (r) => r.settled && r.selected === lastFeatured && r.active === lastFeatured && r.visible === r.books);
  {
    const shown = (await pictures()).cards.filter((c) => c.shown).length;
    if (shown) failed++;
    console.log(`${shown ? 'FAIL' : 'ok  '} the row stands on the bare page: ${shown} picture(s) in the window`);
  }
  {
    // The foot of the page: the row goes up with the page, the title row and the bar go, the band and the footer follow.
    // The title row's fade runs on the browser's clock; the step reads the opacity it is sent to.
    const foot = () => page.evaluate(() => {
      const { ctx } = casebound.engine;
      const v = casebound.engine.books[casebound.engine.state.active].root.position.clone().project(ctx.camera);
      const q = (s) => document.querySelector(s);
      return { bookY: (0.5 - v.y * 0.5) * innerHeight, strip: +(q('#marquee').style.opacity || 1), foot: document.documentElement.hasAttribute('data-foot'), menu: getComputedStyle(q('#menu')).visibility, label: q('#section-label').textContent, band: q('#band').getBoundingClientRect().top, cards: document.querySelectorAll('.band-card').length, links: [...document.querySelectorAll('.foot-links a')].map((a) => a.getAttribute('href')), end: document.documentElement.scrollHeight - innerHeight };
    });
    const rowY = (await page.evaluate(() => document.querySelector('.panel').offsetHeight + 16)) * (await page.evaluate(() => casebound.shelf.order.length));
    const atRow = await foot();
    await page.evaluate((y) => scrollTo(0, y), rowY + 460);
    await run(2);
    await page.waitForTimeout(500);
    const on = await foot();
    let ok = atRow.bookY - on.bookY > 250 && on.strip === 0 && on.foot && on.menu === 'hidden';
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} 460 px past the row the row has gone up ${(atRow.bookY - on.bookY).toFixed(0)} px, the title row and the menu are gone`);
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await run(1);
    const end = await foot();
    ok = end.label === 'Footer' && end.cards >= 5 && end.links.length === 3 && end.links.every((h) => h.startsWith('https://github.com/OthmanAdi/casebound')) && end.end - rowY > 1500;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} the page goes on ${(end.end - rowY).toFixed(0)} px past the row: a band of ${end.cards} cards, then the footer with links to the source, the skill and the licence ("${end.label}")`);
    await page.evaluate((y) => scrollTo(0, y), rowY);
    await run(2.5);
    await page.waitForTimeout(500);
    const back = await foot();
    ok = Math.abs(back.bookY - atRow.bookY) < 2 && back.strip === 1 && !back.foot;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} back at the row it stands where it stood (${(back.bookY - atRow.bookY).toFixed(1)} px), with its title row`);
  }
  await shot('row');
  await page.keyboard.press('ArrowRight');
  await run(1.6);
  const stepped = await rowCheck('an arrow chooses the next book', (r) => r.selected !== stood.selected && r.active === r.selected);
  {
    const t = await titleRow();
    const ok = t.title === t.book;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} the title row follows the choice in the row: "${t.title}"`);
  }
  await shot('row stepped');
  // A hand that pulls the row to the right brings the books on the left to the middle.
  const spineOf = (n) => page.evaluate((n) => {
    const { ctx } = casebound.engine;
    const book = casebound.engine.books[casebound.shelf.order[n]];
    const v = book.root.position.clone();
    book.root.getWorldPosition(v);
    v.project(ctx.camera);
    const r = ctx.canvas.getBoundingClientRect();
    return { slug: book.record.slug, x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (0.5 - v.y * 0.5) * r.height };
  }, n);
  const grip = await spineOf(1);
  await page.mouse.move(grip.x, grip.y);
  await run(0.1);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(grip.x + i * 25, grip.y);
    await run(0.05);
  }
  await page.mouse.up();
  await run(2);
  const pulled = await rowCheck('pulled to the right, the row takes a book further left', (r) => r.selected !== stepped.selected && r.active === r.selected);
  await shot('row pulled');

  // A press on the first spine chooses that book.
  const first = await page.evaluate(() => {
    const { ctx } = casebound.engine;
    const book = casebound.engine.books[casebound.shelf.order[0]];
    const v = book.root.position.clone();
    book.root.getWorldPosition(v);
    v.project(ctx.camera);
    const r = ctx.canvas.getBoundingClientRect();
    return { slug: book.record.slug, x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (0.5 - v.y * 0.5) * r.height };
  });
  await page.mouse.click(first.x, first.y);
  await run(2);
  await rowCheck('a press on a spine chooses that book', (r) => r.selected === first.slug && r.selected !== pulled.selected);
  await page.keyboard.press('Space');
  await run(3.4);
  await rowCheck('the chosen book opens from the row', (r) => r.reading === first.slug);
  await shot('row reading');
  await page.keyboard.press('Escape');
  await run(2.4);
  await page.evaluate(() => scrollTo(0, 0));
  await run(3);
  await rowCheck('back at the top the row is gone', (r) => !r.settled && r.visible < r.books);

  // A jump of the scroll bar from one end of the page to the other. The books between are not skipped: each
  // featured book on the way is seen near the centre for some frames.
  // In the stack: at the depth of the first book at rest. A book standing in the row is further back.
  const rest = await page.evaluate(() => casebound.engine.books[0].root.position.toArray());
  const jump = (bottom) => page.evaluate(([bottom, rest]) => {
    const e = casebound.engine;
    const seen = Array.from({ length: casebound.library.featured.length }, () => 0);
    scrollTo(0, bottom ? document.documentElement.scrollHeight : 0);
    for (let f = 0; f < 150; f++) {
      window.__clock += 1000 / 60;
      e.ctx.loop.tick(window.__clock);
      for (let i = 0; i < seen.length; i++) {
        const p = e.books[i].root.position;
        if (e.books[i].root.visible && Math.abs(p.y - rest[1]) < 8 && Math.abs(p.z - rest[2]) < 0.5) seen[i]++;
      }
    }
    return seen;
  }, [bottom, rest]);
  const down = await jump(true);
  const okDown = down.slice(1).every((n) => n >= 3);
  if (!okDown) failed++;
  console.log(`${okDown ? 'ok  ' : 'FAIL'} a jump to the bottom passes every book: frames at the centre of the stack ${down.join(', ')}`);
  await run(3);
  await rowCheck('and the row stands', (r) => r.settled && r.visible === r.books);
  const up = await jump(false);
  const okUp = up.slice(0, -1).every((n) => n >= 3);
  if (!okUp) failed++;
  console.log(`${okUp ? 'ok  ' : 'FAIL'} a jump back to the top passes every book: frames at the centre of the stack ${up.join(', ')}`);
  await run(3);
  await rowCheck('and the row is gone again', (r) => !r.settled && r.visible < r.books);

  // The menu of the bar: a mouse on the strip opens it, the keyboard reaches it through one button, and a press on a
  // book brings that book and opens its details. Its rise runs on the browser's clock, so the steps wait in real time.
  {
    const menu = () => page.evaluate(() => {
      const m = document.getElementById('menu');
      const lists = document.getElementById('menu-lists').getBoundingClientRect();
      const a = document.activeElement;
      return { open: m.hasAttribute('data-open'), expanded: document.getElementById('menu-toggle').getAttribute('aria-expanded'), listsTop: lists.top, stripTop: document.getElementById('menu-strip').getBoundingClientRect().top, titles: [...document.querySelectorAll('#menu-books .menu-book')].map((e) => e.textContent), current: document.querySelector('#menu-books [aria-current="true"]')?.textContent ?? null, focus: a ? (a.id || a.textContent.trim()) : null, book: casebound.engine.books[casebound.engine.state.active].record.title };
    });
    await page.mouse.move(30, 300);
    await run(1);
    const closed = await menu();
    await page.mouse.move(120, 888);
    await page.waitForTimeout(700);
    const opened = await menu();
    const bare = (t) => t.replace(/^(the|an|a)\s+/i, '');
    const sorted = opened.titles.every((t, k) => k === 0 || bare(opened.titles[k - 1]).localeCompare(bare(t), 'en', { sensitivity: 'base' }) <= 0);
    let ok = !closed.open && opened.open && opened.expanded === 'true' && Math.abs(opened.listsTop + (opened.stripTop - opened.listsTop) - opened.stripTop) < 1 && opened.listsTop < opened.stripTop - 100 && sorted && opened.titles.length === (await page.evaluate(() => casebound.engine.books.length)) && opened.current === opened.book;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} a mouse on the strip opens the menu: ${opened.titles.length} books by title, "${opened.current}" marked as the current one`);
    await page.mouse.move(800, 300);
    await page.waitForTimeout(700);
    ok = !(await menu()).open;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} and closes it when it leaves`);
    // The keyboard.
    await page.focus('#menu-toggle');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    const k1 = await menu();
    for (let n = 0; n < 12; n++) await page.keyboard.press('Tab');
    const k2 = await page.evaluate(() => document.getElementById('menu').contains(document.activeElement));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    const k3 = await menu();
    ok = k1.open && k1.focus === k1.current && k2 && !k3.open && k3.focus === 'menu-toggle' && (await state()).view === '/';
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} from the keyboard: Enter opens it on "${k1.focus}", Tab stays inside, Escape closes it and gives the focus back to the strip`);
    await page.evaluate(() => document.activeElement?.blur());
    // A book of the library.
    await page.mouse.move(120, 888);
    await page.waitForTimeout(700);
    const target = await page.evaluate(() => { const l = [...document.querySelectorAll('#menu-books .menu-book')].find((e) => !e.hasAttribute('aria-current') && casebound.library.featured.includes(e.getAttribute('href').split('/').pop())); const r = l.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2, slug: l.getAttribute('href').split('/').pop() }; });
    await page.mouse.click(target.x, target.y);
    await page.waitForTimeout(2200);
    await run(1.5);
    const after = await state();
    ok = after.view === `/book/${target.slug}` && !(await menu()).open;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} a press on a book in the menu brings it and opens its details: ${after.view}`);
    await page.mouse.move(30, 300);
    await page.keyboard.press('Escape');
    await run(1.2);
    await page.evaluate(() => scrollTo(0, 0));
    await run(3);
  }

  // On a phone: a counter under the row with the place of the chosen book, and arrows that step the row.
  {
    const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
    phone.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
    await phone.goto(base.replace(/\/$/, '') + '/?midday', { waitUntil: 'load', timeout: 60000 });
    await phone.waitForSelector('html[data-casebound-ready="true"]', { state: 'attached', timeout: 30000 });
    await phone.evaluate(() => scrollTo(0, (document.querySelector('.panel').offsetHeight + 16) * casebound.shelf.order.length));
    await phone.waitForTimeout(3500);
    const pager = () => phone.evaluate(() => {
      const p = document.getElementById('pager');
      const r = p.getBoundingClientRect();
      const { ctx } = casebound.engine;
      const book = casebound.engine.books.find((b) => b.record.slug === casebound.shelf.row.selected);
      const v = book.root.position.clone().project(ctx.camera);
      return { shown: p.hasAttribute('data-shown'), text: document.getElementById('pager-readout').textContent, top: r.top, width: r.width, centre: r.left + r.width / 2, bookY: (0.5 - v.y * 0.5) * innerHeight, selected: casebound.shelf.row.selected, order: casebound.shelf.row.order, w: innerWidth };
    });
    const p1 = await pager();
    let ok = p1.shown && p1.text === `${p1.order.indexOf(p1.selected) + 1} / ${p1.order.length}` && p1.top > p1.bookY && Math.abs(p1.centre - p1.w / 2) < 1;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} on a phone a counter stands under the row: "${p1.text}"`);
    await phone.tap('#pager-next');
    await phone.waitForTimeout(1500);
    const p2 = await pager();
    ok = p2.selected !== p1.selected && p2.text === `${p2.order.indexOf(p2.selected) + 1} / ${p2.order.length}` && p2.shown;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} its arrow steps the row: "${p2.text}"`);
    await phone.close();
  }

  for (const e of errors) { failed++; console.log('FAIL page error: ' + e); }
} finally {
  await browser.close();
}
console.log(failed ? `${failed} step(s) failed` : 'shelf: all steps passed');
process.exit(failed ? 1 : 0);
