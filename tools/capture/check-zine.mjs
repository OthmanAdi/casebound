// Checks the zine in a real browser: its button in the details, the way in, where it lies closed, the cover turned
// by key, its leaves, its one number, its address, the pen and its store, the lens, the way out, and a book that
// has none. The engine's clock is driven by hand, so the result does not depend on the machine's speed.
//
//   node tools/capture/check-zine.mjs <base url>
//
// Prints one line per step and exits with 1 if a step fails.
import { chromium } from 'playwright';

const base = process.argv[2];
if (!base) {
  console.error('usage: node check-zine.mjs <base url>');
  process.exit(2);
}

const browser = await chromium.launch({ channel: process.env.RE_CHANNEL ?? 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
let failed = 0;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  let page;
  /** A new page at an address, its clock stopped. */
  const visit = async (hash) => {
    if (page) await page.close();
    page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
    await page.goto(base.replace(/\/$/, '') + '/?midday' + hash, { waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('html[data-casebound-ready="true"]', { state: 'attached', timeout: 30000 });
    await page.evaluate(() => { casebound.engine.ctx.loop.stop(); window.__clock = performance.now(); });
  };
  await visit('#/book/chemical-history-of-a-candle');

  /** Advances the engine by `seconds` at 60 frames per second. */
  const run = (seconds) => page.evaluate((n) => { for (let i = 0; i < n; i++) { window.__clock += 1000 / 60; casebound.engine.ctx.loop.tick(window.__clock); } }, Math.round(seconds * 60));
  const state = () => page.evaluate(() => {
    const z = casebound.zine;
    const book = z.book;
    const parent = casebound.engine.book('chemical-history-of-a-candle');
    let staples = 0;
    if (book) book.root.traverse((o) => { if (o.name === 'staple') staples++; });
    let inAir = 0;
    let turn = null;
    casebound.engine.ctx.scene.traverse((o) => {
      if (o.name !== 'leaf' || !o.visible) return;
      inAir++;
      if (o.userData.motion) turn = o.userData.motion.shown / Math.PI;
    });
    const rect = z.rect();
    return {
      state: z.state,
      number: z.number,
      slug: book ? book.record.slug : null,
      binding: book ? book.dims.binding : null,
      leaves: book ? book.dims.leaves : 0,
      thickness: book ? book.dims.thickness : 0,
      staples,
      open: book ? book.open : 0,
      cover: z.cover,
      back: book ? book.backShut : 0,
      lean: book ? book.lean * 180 / Math.PI : 0,
      onBack: z.onBack,
      turn,
      kick: Number(casebound.engine.ctx.registry.getParam('reader.leaf', 'kick')),
      x: book ? book.root.position.x : null,
      z: book ? book.root.position.z : null,
      scale: book ? book.root.scale.x : null,
      drawn: book ? book.root.visible : false,
      rect: rect ? rect.map(Math.round) : null,
      parentX: parent.root.position.x,
      view: document.documentElement.dataset.caseboundView,
      hash: location.hash,
      bar: !document.getElementById('toolbar').hidden,
      folio: document.getElementById('folio').textContent,
      aside: document.documentElement.hasAttribute('data-aside'),
      button: document.querySelector('.dp-book.is-current .row-zine')?.textContent ?? null,
      reading: casebound.reader.isOpen,
      page: casebound.reader.page,
      printed: [casebound.reader.folio(casebound.reader.page), casebound.reader.folio(casebound.reader.page + 1)],
      inAir,
      penOn: casebound.marker.on,
      lens: casebound.magnifier.on,
      marks: Object.keys(localStorage).filter((k) => k.startsWith('casebound.marks.')),
      books: casebound.engine.books.length,
      row: casebound.shelf.row ? casebound.shelf.row.order.length : null,
    };
  });
  const step = async (name, test, say) => {
    const s = await state();
    let ok = false;
    try { ok = !!test(s); } catch { ok = false; }
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${say(s)}`);
    return s;
  };
  const near = (a, b, tol) => Math.abs(a - b) <= tol;

  await run(2);
  const before = await step('a book with a zine has a button for it in its details', (s) => s.button === '+ Open zine +' && s.state === 'away' && s.aside, (s) => `"${s.button}", zine ${s.state}`);

  // by the button: it flies in from the right
  await page.click('.dp-book.is-current .row-zine');
  await run(1 / 60);
  const first = await step('the button takes it out: it is drawn in the first frame, far to the right', (s) => s.state === 'coming' && s.drawn && s.x > 15 && s.binding === 'pamphlet' && s.slug === 'chemical-history-of-a-candle.zine', (s) => `${s.state}, x ${s.x?.toFixed(1)}, ${s.slug}`);
  await run(4 / 60);
  await step('it has covered most of the way after five frames', (s) => s.x < first.x - 20, (s) => `x ${s.x?.toFixed(1)} from ${first.x?.toFixed(1)}`);
  await run(1.5);
  const lying = await step('it lies closed over the picture, the details beside it', (s) => s.state === 'lying' && s.open === 0 && s.aside && !s.reading && s.rect && s.rect[0] > 100 && s.rect[0] + s.rect[2] < 0.6 * 1440, (s) => `${s.state}, box ${s.rect}, scale ${s.scale?.toFixed(3)}`);
  await step('it is a pamphlet: a few leaves, thinner than a board, two staples', (s) => s.leaves >= 4 && s.leaves <= 16 && s.thickness < 0.5 && s.staples === 2, (s) => `${s.leaves} leaves, ${s.thickness.toFixed(3)} thick, ${s.staples} staples`);
  await step('the bar is there with the number 1, the address names the zine, the button closes it', (s) => s.bar && s.folio === '1' && s.view === '/book/chemical-history-of-a-candle/zine' && s.hash === '#' + s.view && s.button === '- Close zine -', (s) => `bar ${s.bar}, "${s.folio}", ${s.hash}, "${s.button}"`);
  await step('its book has gone aside to the left', (s) => s.parentX < before.parentX - 10, (s) => `book at x ${s.parentX.toFixed(1)}, was ${before.parentX.toFixed(1)}`);
  await step('the shelf does not count it', (s) => s.books === before.books + 1 && s.row === before.row, (s) => `${s.books} books in the engine, ${s.row} in the row`);

  // the first turn opens it and brings it to the reading place
  await page.keyboard.press('ArrowRight');
  await run(0.1);
  await step('ArrowRight turns its cover: the number and the address change at the key', (s) => s.state === 'reading' && s.folio === '2' && s.view.endsWith('/zine/page/2') && s.cover > 0.05 && s.cover < 0.25, (s) => `${s.state}, "${s.folio}", ${s.view}, cover ${s.cover.toFixed(2)} of its turn`);
  await run(0.25);
  // Measured: 90 % of the way to the reading place 330 ms after the key, the cover 0.30 of its turn at 300 ms.
  const carried = await step('it comes to the reading place on its own quick curve, ahead of its cover', (s) => (s.z - lying.z) / (-31 - lying.z) > 0.85 && s.cover > 0.2 && s.cover < 0.45, (s) => `${(100 * (s.z - lying.z) / (-31 - lying.z)).toFixed(0)} % of the way after 0.35 s, cover ${s.cover.toFixed(2)}`);
  await run(2.15);
  const open = await step('open, it lies at the reading place beside the details: a spread, not a cover', (s) => s.open === 1 && s.cover > 0.9 && s.reading && s.aside && s.rect[2] > lying.rect[2] * 1.5 && near(s.x, lying.x, 1.5), (s) => `box ${s.rect}, x ${s.x.toFixed(2)}, scale ${s.scale.toFixed(3)}, cover ${s.cover.toFixed(2)}`);
  await step('it lies turned about its spine, the side with fewer leaves higher', (s) => s.lean > 2 && s.lean < 9.5, (s) => `lean ${s.lean.toFixed(1)} degrees with ${s.leaves} leaves on the right, the pointer over the details`);
  await page.keyboard.press('ArrowRight');
  await run(0.2);
  await step('a leaf turns by key', (s) => s.inAir === 1 && s.folio === '4' && s.page === 2, (s) => `in the air ${s.inAir}, "${s.folio}", page ${s.page}`);
  await step('the bar, the address and the folios on the spread count the same sides, the cover as 1 and 2', (s) => s.folio === '4' && s.view.endsWith('/zine/page/4') && s.printed[0] === 4 && s.printed[1] === 5, (s) => `"${s.folio}", ${s.view}, printed ${s.printed.join(' and ')}`);
  await run(0.1);
  // Measured on a leaf of the reference's zine: 0.50 of its turn 300 ms after the key; a book's leaf is 0.42 by then.
  await step("of the zine's own paper: half its turn after 0.3 s", (s) => s.turn !== null && s.turn > 0.45 && s.turn < 0.56 && s.kick > 0.15, (s) => `turn ${s.turn?.toFixed(2)}, starting speed ${s.kick}`);
  await run(2.7);
  await step('a leaf turned, it leans a little more the other way', (s) => s.lean < open.lean - 1, (s) => `lean ${s.lean.toFixed(1)} from ${open.lean.toFixed(1)} degrees`);
  await page.keyboard.press('ArrowLeft');
  await run(3);
  await step('and back', (s) => s.folio === '2' && s.page === 0, (s) => `"${s.folio}", page ${s.page}`);

  // by hand: a pull from the right page to the left
  {
    const r = open.rect;
    const y = r[1] + r[3] * 0.5;
    await page.mouse.move(r[0] + r[2] * 0.8, y);
    await run(0.2);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) { await page.mouse.move(r[0] + r[2] * (0.8 - 0.55 * (i / 20)), y); await run(1 / 60); }
    await step('a page follows the hand', (s) => s.inAir === 1, (s) => `in the air ${s.inAir}`);
    await page.mouse.up();
    await run(3);
    await step('and turns when it is let go past the middle', (s) => s.folio === '4' && s.page === 2, (s) => `"${s.folio}", page ${s.page}`);
  }

  // the pen marks it, under the zine's own name; the lens works over it
  {
    const r = (await state()).rect;
    await page.keyboard.press('h');
    await page.mouse.move(r[0] + r[2] * 0.6, r[1] + r[3] * 0.45);
    await run(0.4);
    await page.mouse.down();
    for (let i = 1; i <= 16; i++) { await page.mouse.move(r[0] + r[2] * (0.6 + 0.25 * (i / 16)), r[1] + r[3] * 0.45); await run(1 / 60); }
    await page.mouse.up();
    await run(1);
    // The marks are saved a moment after the line ends, by the clock on the wall.
    await page.waitForTimeout(700);
    await step('a pen marks its pages, kept under the name of the zine', (s) => s.penOn && s.marks.includes('casebound.marks.chemical-history-of-a-candle.zine'), (s) => `pen ${s.penOn}, stores ${s.marks.join(', ') || 'none'}`);
    await page.keyboard.press('h');
    await page.keyboard.press('m');
    await run(0.5);
    await step('the lens works over it', (s) => s.lens && s.state === 'reading', (s) => `lens ${s.lens}, ${s.state}`);
    await page.keyboard.press('m');
    await run(0.3);
  }

  // through to the end, where the back cover comes over
  for (let i = 0; i < 20 && (await state()).page < 2 * (await state()).leaves; i++) {
    await page.keyboard.press('ArrowRight');
    await run(1.5);
  }
  await page.keyboard.press('ArrowRight');
  await run(0.1);
  await step('the way on from the last spread brings the back cover over: the number counts every side', (s) => s.onBack && s.folio === String(2 * s.leaves + 4) && s.view.endsWith(`/zine/page/${2 * s.leaves + 4}`), (s) => `on its back ${s.onBack}, "${s.folio}", ${s.view}`);
  await run(3);
  await step('and it lies closed on its face, as wide as one page', (s) => s.back > 0.9 && s.rect[2] < open.rect[2] * 0.7, (s) => `back cover ${s.back.toFixed(2)} of its turn, box ${s.rect}`);
  await page.keyboard.press('ArrowRight');
  await run(0.5);
  await step('a further press goes nowhere', (s) => s.onBack && s.page === 2 * s.leaves && s.folio === String(2 * s.leaves + 4), (s) => `on its back ${s.onBack}, page ${s.page}`);
  await page.keyboard.press('ArrowLeft');
  await run(3);
  await step('the way back opens it again at its last spread', (s) => !s.onBack && s.back < 0.1 && s.folio === String(2 * s.leaves + 2), (s) => `back cover ${s.back.toFixed(2)}, "${s.folio}"`);
  for (let i = 0; i < 20 && (await state()).page > 2; i++) {
    await page.keyboard.press('ArrowLeft');
    await run(1.5);
  }

  // back to the first spread, and the cover shut again
  await page.keyboard.press('ArrowLeft');
  await run(3);
  await page.keyboard.press('ArrowLeft');
  await run(0.1);
  await step('ArrowLeft on the first spread shuts the cover: it stays, lying', (s) => s.state === 'lying' && s.folio === '1' && s.view.endsWith('/zine'), (s) => `${s.state}, "${s.folio}", ${s.view}`);
  await run(6);
  await step('and lies where it lay, let go by the reader', (s) => s.open === 0 && near(s.x, lying.x, 0.05) && near(s.scale, lying.scale, 0.005), (s) => `x ${s.x.toFixed(2)}, scale ${s.scale.toFixed(3)}, open ${s.open}`);

  // a press on it turns the cover; Escape puts it away and leaves the details
  await page.mouse.move(lying.rect[0] + lying.rect[2] / 2, lying.rect[1] + lying.rect[3] / 2);
  await page.mouse.down();
  await page.mouse.up();
  await run(2.5);
  await step('a press on the closed zine turns its cover', (s) => s.state === 'reading' && s.open === 1, (s) => `${s.state}, cover ${s.open.toFixed(2)}`);
  await page.keyboard.press('Escape');
  await run(10 / 60);
  await step('Escape sends it away: gone from the picture within ten frames, the details still there', (s) => s.state === 'going' && (!s.drawn || s.x > open.x + 15) && !s.bar && s.view === '/book/chemical-history-of-a-candle', (s) => `${s.state}, x ${s.x?.toFixed(1)}, ${s.view}`);
  // The second step of the same press waits by the clock on the wall.
  await page.waitForTimeout(900);
  await run(1);
  await step('and the same press closes the details 0.63 s later', (s) => s.state === 'away' && !s.aside && s.view === '/', (s) => `${s.state}, aside ${s.aside}, ${s.view}`);

  // by the bar's close, and by the address
  await visit('#/book/chemical-history-of-a-candle');
  await run(2);
  await page.click('.dp-book.is-current .row-zine');
  await run(2);
  await page.click('#close');
  await run(2.5);
  await step('the close of the bar puts it away and leaves the details as they were: the book back, the button ready', (s) => s.state === 'away' && s.aside && near(s.parentX, before.parentX, 0.05) && s.button === '+ Open zine +' && !s.reading, (s) => `${s.state}, book at x ${s.parentX.toFixed(2)}, "${s.button}"`);

  await visit('#/book/walden/zine/page/4');
  await run(1.5);
  await step('by its address it comes in closed first', (s) => s.state === 'lying' && s.slug === 'walden.zine' && s.folio === '1', (s) => `${s.state}, ${s.slug}, "${s.folio}"`);
  await run(4.5);
  await step('and opens at the number of the address after it has lain two seconds, its left page printed with that number', (s) => s.state === 'reading' && s.folio === '4' && s.view === '/book/walden/zine/page/4' && s.printed[0] === 4, (s) => `${s.state}, "${s.folio}", ${s.view}, printed ${s.printed.join(' and ')}`);

  // a book without one
  await visit('#/book/opticks/zine');
  await run(2);
  const none = await page.evaluate(() => ({ state: casebound.zine.state, has: casebound.zine.has('opticks'), button: !!document.querySelector('.dp-book.is-current .row-zine'), view: document.documentElement.dataset.caseboundView }));
  const fine = none.state === 'away' && !none.has && !none.button && none.view === '/book/opticks';
  if (!fine) failed++;
  console.log(`${fine ? 'ok  ' : 'FAIL'} a book without a zine has no button, and its zine address shows its details: ${JSON.stringify(none)}`);

  for (const e of errors) { failed++; console.log('FAIL page error: ' + e); }
} finally {
  await browser.close();
}
console.log(failed ? `${failed} step(s) failed` : 'zine: all steps passed');
process.exit(failed ? 1 : 0);
