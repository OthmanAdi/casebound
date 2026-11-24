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
  await page.keyboard.press('Escape');
  await run(1.2);
  await check('Escape closes them', (s) => s.view === '/');

  // The next book comes to the centre; the turned one forgets its turn.
  await page.evaluate(() => scrollTo(0, document.querySelector('.panel').offsetHeight + 16));
  await run(3);
  await check('the next book is centred and the first has forgotten its turn', (s) => s.active !== 0 && Math.abs(s.firstYaw) < 0.01 && s.yaw === 0);
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
  await shot('row');
  await page.keyboard.press('ArrowRight');
  await run(1.6);
  const stepped = await rowCheck('an arrow chooses the next book', (r) => r.selected !== stood.selected && r.active === r.selected);
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
