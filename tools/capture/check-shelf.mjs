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
    return { column: r('detail').left, picture: r('pictures').right, back: { left: r('home-link').left, top: r('home-link').top, opacity: +cs(document.getElementById('home-link')).opacity }, clip: cs(document.getElementById('marquee')).clipPath, bar: cs(bar).visibility, hidden: document.getElementById('detail').hidden, w: innerWidth };
  });
  await page.waitForTimeout(1800);
  {
    const a = await around();
    const ok = Math.abs(a.column - (0.6 * a.w + 24)) < 1 && Math.abs(a.picture - (0.6 * a.w - 3)) < 1 && Math.abs(a.back.left - a.column) < 1 && a.back.top < 60 && a.back.opacity > 0.99 && /40%/.test(a.clip) && a.bar === 'hidden';
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} beside the details: picture to ${a.picture.toFixed(0)} px, column from ${a.column.toFixed(0)} px, the way back above it at ${a.back.left.toFixed(0)}, ${a.back.top.toFixed(0)}, title row cut (${a.clip}), bar buttons ${a.bar}`);
  }
  {
    // Sections with a rule each, a colophon, and a way on to the next book that keeps the details open.
    const d = await page.evaluate(() => ({ sections: [...document.querySelectorAll('#detail .d-sec')].filter((s) => parseFloat(getComputedStyle(s).borderTopWidth) >= 1).length, facts: document.querySelectorAll('#detail-facts li').length, next: document.getElementById('detail-next').getAttribute('aria-label') }));
    const ok = d.sections >= 3 && d.facts >= 4 && /^Next book: /.test(d.next);
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} the details hold ${d.sections} ruled sections, ${d.facts} lines of colophon and "${d.next}"`);
    const before = (await state()).view;
    await page.click('#detail-next');
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
  for (const e of errors) { failed++; console.log('FAIL page error: ' + e); }
} finally {
  await browser.close();
}
console.log(failed ? `${failed} step(s) failed` : 'shelf: all steps passed');
process.exit(failed ? 1 : 0);
