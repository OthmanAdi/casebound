// Checks the reader in a real browser: keys, a page pulled over by hand, a page let go, taps, a leaf
// sent back while it is still in the air, and a bundle of leaves turned as one block. The engine's clock is driven by hand, so the result does not
// depend on the machine's speed.
//
//   node tools/capture/check-reader.mjs <base url>
//
// Prints one line per step and exits with 1 if a step fails.
import { chromium } from 'playwright';

const base = process.argv[2];
if (!base) {
  console.error('usage: node check-reader.mjs <base url>');
  process.exit(2);
}

const browser = await chromium.launch({ channel: process.env.RE_CHANNEL ?? 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
let failed = 0;
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  await page.goto(base.replace(/\/$/, '') + '/?midday', { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('html[data-casebound-ready="true"]', { state: 'attached', timeout: 30000 });
  await page.evaluate(() => { casebound.engine.ctx.loop.stop(); window.__clock = performance.now(); });

  /** Advances the engine by `seconds` at 60 frames per second. */
  const run = (seconds) => page.evaluate((n) => { for (let i = 0; i < n; i++) { window.__clock += 1000 / 60; casebound.engine.ctx.loop.tick(window.__clock); } }, Math.round(seconds * 60));
  const state = () => page.evaluate(() => {
    let inAir = 0;
    let lying = 0;
    casebound.engine.ctx.scene.traverse((o) => {
      if (o.name === 'leaf' && o.visible) inAir++;
      // A sheet mounted on its stack for the corner curl. It is not in the air.
      if (o.name === 'leaf.rest' && o.visible) lying++;
    });
    return { open: casebound.reader.isOpen, page: casebound.reader.page, inAir, lying };
  });
  /** Sides of visible sheets and page blocks that show no print: their picture is the small blank one. */
  const unprinted = () => page.evaluate(() => {
    const bare = (m) => !m.map || !m.map.image || m.map.image.width < 200;
    let n = 0;
    casebound.engine.ctx.scene.traverse((o) => {
      if ((o.name === 'leaf' || o.name === 'leaf.rest') && o.visible) n += o.material.filter(bare).length;
    });
    const book = casebound.reader.book;
    if (book) n += [book.pageMaterials.left, book.pageMaterials.right].filter(bare).length;
    return n;
  });
  const spine = () => page.evaluate(() => {
    const { ctx } = casebound.engine;
    const v = casebound.reader.book.root.position.clone();
    casebound.reader.book.root.getWorldPosition(v);
    v.project(ctx.camera);
    const r = ctx.canvas.getBoundingClientRect();
    return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (0.5 - v.y * 0.5) * r.height };
  });
  const expect = async (name, want) => {
    const got = await state();
    const ok = Object.entries(want).every(([k, v]) => (typeof v === 'function' ? v(got[k]) : got[k] === v));
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: page ${got.page}, leaves in the air ${got.inAir}${'lying' in want ? `, sheets lying ${got.lying}` : ''}`);
  };
  /** Presses at a point, moves through the given offsets with the clock running, and lets go. */
  const pullFrom = async (x, y, offsets) => {
    await page.mouse.move(x, y);
    await run(0.1);
    await page.mouse.down();
    for (const dx of offsets) {
      await page.mouse.move(x + dx, y);
      await run(0.08);
    }
    await page.mouse.up();
  };

  await page.keyboard.press('Space');
  await run(3);
  const first = (await state()).page;
  await expect('opens', { open: true });
  const c = await spine();
  const right = [c.x + 220, c.y];
  const left = [c.x - 220, c.y];

  await page.keyboard.press('ArrowRight');
  await run(2.5);
  await expect('key forward', { page: first + 2 });
  await page.keyboard.press('ArrowLeft');
  await run(2.5);
  await expect('key back', { page: first });

  await page.keyboard.press('ArrowRight');
  await run(0.25);
  await page.keyboard.press('ArrowLeft');
  await run(0.1);
  await expect('sent back in the air: the same leaf, not a second one', { page: first, inAir: 1 });
  await run(4);

  await pullFrom(...right, [-40, -120, -220, -320]);
  await run(0.05);
  await expect('pulled over and let go: turns', { page: first + 2 });
  await run(3);
  await pullFrom(...right, [-60, -160, -200, -80, 12]);
  await run(3);
  await expect('pulled and brought back: falls back', { page: first + 2 });
  await pullFrom(...left, [60, 180, 300]);
  await run(3);
  await expect('pulled back from the left', { page: first });
  await pullFrom(...right, [-3]);
  await run(3);
  await expect('pulled 3 px: counts as a tap and turns', { page: first + 2 });

  await page.mouse.click(...left);
  await run(3);
  await expect('tap on the left page', { page: first });
  await page.mouse.click(...right);
  await run(0.3);
  await page.mouse.move(right[0] - 300, right[1]);
  await page.mouse.down();
  await run(0.05);
  await expect('a flying leaf caught over the left half: one leaf', { inAir: 1 });
  await page.mouse.move(right[0] - 100, right[1]);
  await run(0.3);
  await page.mouse.up();
  await run(3);
  await expect('and pulled back to the right', { page: first });

  await run(8);
  await expect('everything landed', { page: first, inAir: (n) => n <= 1 });

  // The corner curl needs a live sheet under the pointer. It lies on the stack and is counted there.
  await page.mouse.move(...left);
  await run(1.5);
  await expect('a resting pointer mounts a sheet on the stack, the page count stays', { page: first, lying: 1 });
  await page.mouse.down();
  await run(0.1);
  await expect('a press takes that sheet, not a second one', { page: first, lying: 0, inAir: (n) => n <= 2 });
  await page.mouse.move(left[0] + 140, left[1]);
  await run(0.3);
  await page.mouse.move(left[0] - 10, left[1]);
  await run(0.3);
  await page.mouse.up();
  await run(1);
  await expect('brought back and let go: it lies on its stack again, the page count stays', { page: first, lying: 1, inAir: (n) => n <= 1 });
  await page.mouse.move(c.x, 30);
  await run(12);
  await expect('the pointer has left the book: no sheet stays mounted', { page: first, lying: 0, inAir: (n) => n <= 1 });
  await page.mouse.move(...right);
  await run(1.5);
  await expect('a sheet on the right stack', { page: first, lying: (n) => n >= 1 });
  await page.keyboard.press('ArrowRight');
  await run(0.2);
  await expect('a key turns the mounted sheet itself', { page: first + 2, lying: 0 });
  await page.keyboard.press('ArrowLeft');
  await page.mouse.move(c.x, 30);
  await run(12);
  await expect('and back, with the pointer away', { page: first, lying: 0, inAir: (n) => n <= 1 });

  // A press held still on a leaf in the air does not catch it: the leaf goes on and the page turns.
  await run(4);
  await page.keyboard.press('ArrowRight');
  await run(0.25);
  await page.mouse.move(right[0] + 40, right[1]);
  await page.mouse.down();
  await run(0.3);
  await expect('a press held still on a flying leaf lets it go on', { page: first + 2 });
  await page.mouse.move(right[0] + 190, right[1]);
  await run(0.2);
  await page.mouse.up();
  await run(4);
  await expect('and the page has turned, whatever the hand does with the next one', { page: first + 2 });
  await page.mouse.move(c.x, 30);
  await page.keyboard.press('ArrowLeft');
  await run(4);
  await expect('back again', { page: first, inAir: (n) => n <= 1 });
  // A turned leaf whose sheet is down does not keep a block from being taken, although its angle creeps on.
  await page.keyboard.press('ArrowRight');
  await run(1.6);
  const soon = await page.evaluate(() => casebound.reader.turnLeaves(5));
  if (!soon) failed++;
  console.log(`${soon ? 'ok  ' : 'FAIL'} a block can be taken 1.6 s after a page was turned`);
  await run(3);
  await expect('one leaf and five on', { page: first + 12 });
  await page.evaluate((p) => casebound.reader.goTo(p), first);
  await run(1);

  // A bundle of leaves: several turned as one block, by a call and by a press on the fore-edge of a stack.
  const block = () => page.evaluate(() => {
    const book = casebound.reader.book;
    const bare = (m) => !m.map || !m.map.image || m.map.image.width < 200;
    return { there: book.volume.chunkBlock.visible, bare: [book.pageMaterials.bundleTop, book.pageMaterials.bundleUnder].filter(bare).length };
  });
  const say = (ok, text) => {
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  };
  await run(4);
  await page.evaluate(() => casebound.reader.turnLeaves(12));
  await run(0.5);
  const flying = await block();
  say(flying.there && flying.bare === 0, `twelve leaves turn as one block, printed on both faces: block ${flying.there ? 'in the air' : 'missing'}, bare faces ${flying.bare}`);
  await expect('and count where they are going, with no single leaf in the air', { page: first + 24, inAir: 0 });
  say((await page.evaluate(() => casebound.reader.next())) === false, 'no single page turns while the block is in the air');
  await run(2);
  say(!(await block()).there && (await unprinted()) === 0, 'the block has landed and is part of its stack');
  await expect('twelve leaves on', { page: first + 24, inAir: 0 });
  await page.evaluate(() => casebound.reader.turnLeaves(-12));
  await run(3);
  await expect('and twelve back', { page: first, inAir: 0 });
  // The fore-edge of the right stack lies beyond the page. A press there takes more leaves the deeper it falls.
  const taken = [];
  let edgeX = 0;
  for (let x = right[0]; x < right[0] + 420 && taken.length < 3; x += 5) {
    await page.mouse.move(x, right[1]);
    await run(0.1);
    await page.mouse.down();
    await run(0.05);
    const held = await page.evaluate(() => ({ page: casebound.reader.page, grabbing: document.documentElement.style.cursor === 'grabbing' }));
    await page.mouse.up();
    await run(3);
    const got = (await state()).page - first;
    if (got > 2) taken.push(got / 2);
    if (got > 2) edgeX = x;
    if (got > 2 && taken.length === 1) say(held.page === first && !held.grabbing, 'a press on the fore-edge takes no leaf into the hand');
    await page.evaluate((p) => casebound.reader.goTo(p), first);
    await page.mouse.move(c.x, 30);
    await run(1);
  }
  say(taken.length === 3 && taken[0] >= 2 && taken[1] >= taken[0] && taken[2] > taken[0], `a press on the fore-edge turns a block of leaves, more the deeper it falls: ${taken.join(', ') || 'none'}`);
  // The pen: while it is in the hand a press marks the page and takes no leaf. Marks stay through a page turn.
  await page.evaluate(() => { casebound.marker.clear(); });
  await page.mouse.move(c.x, 30);
  await run(4);
  await page.keyboard.press('h');
  const stroke = async (x0, y0, x1) => {
    await page.mouse.move(x0, y0);
    await run(0.05);
    await page.mouse.down();
    for (let k = 1; k <= 10; k++) { await page.mouse.move(x0 + ((x1 - x0) * k) / 10, y0); await run(0.02); }
    await page.mouse.up();
    await run(0.1);
  };
  // The pen stands on the pointer over a page with the cursor hidden, and waits on the page edge beside the book.
  const pen = () => page.evaluate(() => {
    let o = null;
    casebound.engine.ctx.scene.traverse((m) => { if (m.name === 'marker.pen') o = m; });
    const { ctx } = casebound.engine;
    const v = o.position.clone().project(ctx.camera);
    const r = ctx.canvas.getBoundingClientRect();
    return { shown: o.visible, x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (0.5 - v.y * 0.5) * r.height, cursor: document.documentElement.style.cursor, on: casebound.marker.on, color: casebound.marker.color };
  });
  await page.mouse.move(right[0], right[1]);
  await run(0.6);
  const over = await pen();
  say(over.shown && over.cursor === 'none' && Math.abs(over.x - right[0]) < 6 && over.y < right[1] && right[1] - over.y < 40 && over.color === 'yellow', `the pen stands on the pointer over a page, a little above the paper, and the cursor is hidden: ${Math.round(over.x - right[0])} px across, ${Math.round(right[1] - over.y)} px up, cursor '${over.cursor}', ${over.color}`);
  await page.mouse.move(right[0] + 420, right[1]);
  await run(0.6);
  const beside = await pen();
  say(beside.shown && beside.cursor === '' && beside.x < right[0] + 400, `beside the book it waits on the page edge and the cursor is back: ${Math.round(right[0] + 420 - beside.x)} px from the pointer`);
  // A press without a move leaves nothing.
  await page.mouse.move(right[0], right[1] + 80);
  await run(0.2);
  await page.mouse.down();
  await run(0.2);
  await page.mouse.up();
  await run(0.6);
  say(Object.keys(await page.evaluate(() => casebound.marker.marks())).length === 0, 'a press that does not move leaves no mark');
  // The two places in the bar: a click changes pens, a click on the pen that is out puts it back.
  await page.click('#pens .pen-slot:first-child');
  const pink = await pen();
  await page.click('#pens .pen-slot:first-child');
  const away = await pen();
  await page.keyboard.press('h');
  const back = await pen();
  say(pink.on && pink.color === 'pink' && !away.on && back.on && back.color === 'pink', `a click takes the other pen, a second click puts it back, H takes the pen used last: ${pink.color}, ${away.on ? 'out' : 'away'}, ${back.color}`);
  await page.keyboard.press('Escape');
  const kept = await page.evaluate(() => ({ on: casebound.marker.on, open: casebound.reader.isOpen }));
  say(!kept.on && kept.open, 'Escape puts the pen away and leaves the book open');
  await page.click('#pens .pen-slot:last-child');
  await stroke(right[0] - 120, right[1] - 60, right[0] + 120);
  await stroke(left[0] - 120, left[1] + 40, left[0] + 100);
  const marked = await page.evaluate(() => ({ on: casebound.marker.on, marks: casebound.marker.marks(), page: casebound.reader.page }));
  const counts = Object.fromEntries(Object.entries(marked.marks).map(([k, v]) => [k, v.length]));
  say(marked.on && marked.page === first && counts[first] === 1 && counts[first + 1] === 1, `with the pen a pull across a page marks it and turns nothing: page ${marked.page}, strokes ${JSON.stringify(counts)}`);
  await expect('and no leaf was taken into the hand', { page: first, inAir: 0 });
  const overlays = () => page.evaluate(() => {
    const blank = (m) => { const o = m.userData.uniforms.tOverlay.value; return !o || !o.image || o.image.width < 4; };
    const book = casebound.reader.book;
    let leaves = 0;
    casebound.engine.ctx.scene.traverse((o) => { if (o.name === 'leaf' && o.visible) leaves += o.material.filter((m) => !blank(m)).length; });
    return { left: !blank(book.pageMaterials.left), right: !blank(book.pageMaterials.right), leaves };
  });
  const atRest = await overlays();
  say(atRest.left && atRest.right, 'both pages show their marks');
  await page.keyboard.press('h');
  await page.keyboard.press('ArrowRight');
  await run(0.4);
  const inFlight = await overlays();
  say(inFlight.leaves === 1 && inFlight.left, `the marks ride on the leaf as it turns: ${inFlight.leaves} marked side in the air`);
  await run(3);
  await page.keyboard.press('ArrowLeft');
  await run(4);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('casebound.marks.' + casebound.reader.book.record.slug) || '{}'));
  say(Object.keys(stored).length === 2, `the marks are kept for the next visit: pages ${Object.keys(stored).join(', ')}`);
  await page.evaluate(() => casebound.marker.undo());
  const fewer = await page.evaluate(() => Object.keys(casebound.marker.marks()).length);
  say(fewer === 1, 'the last mark can be taken away');
  await page.evaluate(() => casebound.marker.clear());
  await expect('the pen is away and the book is where it was', { page: first });

  // Shift with an arrow, and the two buttons of the toolbar, turn ten leaves as one block.
  await page.mouse.move(c.x, 30);
  await run(1);
  await page.keyboard.press('Shift+ArrowRight');
  await run(3);
  await expect('Shift and the right arrow turn ten leaves', { page: first + 20, inAir: 0 });
  await page.click('#back-many');
  await run(3);
  await expect('the button turns ten back', { page: first, inAir: 0 });
  await page.mouse.move(c.x, 30);
  await run(1);

  // Under a resting pointer the block lifts off its stack and waits. It sinks back when the pointer leaves.
  const lift = () => page.evaluate(() => { const b = casebound.reader.book.bundle; return b ? { leaves: Math.round(b.share * casebound.reader.book.dims.leaves), lift: (b.lift * 180) / Math.PI, turn: b.turn } : null; });
  await page.mouse.move(edgeX, right[1]);
  await run(0.5);
  const up = await lift();
  say(!!up && up.lift > 12 && up.turn === 0 && (await state()).page === first, `a pointer resting on the fore-edge lifts a block and turns nothing: ${up ? `${up.leaves} leaves, ${up.lift.toFixed(1)} degrees` : 'no block'}`);
  await page.mouse.down();
  await run(0.05);
  await page.mouse.up();
  await run(0.15);
  const going = await lift();
  say(!!going && !!up && going.leaves === up.leaves && going.turn > 0.5, `let go, the block that stood lifted is half over in 150 ms: ${going ? `${going.leaves} leaves, turn ${going.turn.toFixed(2)}` : 'no block'}`);
  await run(2);
  await expect('and its leaves have turned', { page: first + 2 * (up ? up.leaves : 0) });
  await page.evaluate((p) => casebound.reader.goTo(p), first);
  await page.mouse.move(edgeX - 1, right[1]);
  await run(0.5);
  await page.mouse.move(c.x, 30);
  await run(1);
  say((await lift()) === null && (await state()).page === first, 'a pointer that leaves lets the block sink back');
  await page.mouse.move(c.x, 30);
  await run(2);
  await expect('back at the start', { page: first, inAir: 0, lying: 0 });

  await page.keyboard.press('Escape');
  await run(3);
  await expect('closes', { open: false });

  // A page taken the moment the opening has settled. The leaves of the opening are dressed on one side only
  // while they settle; a hand that takes one must find both pages printed.
  // The gap was one frame wide. At 30 frames a second, 2.4 s after the request, a press falls into it.
  const run30 = (frames) => page.evaluate((n) => { for (let i = 0; i < n; i++) { window.__clock += 1000 / 30; casebound.engine.ctx.loop.tick(window.__clock); } }, frames);
  await page.mouse.move(c.x + 260, c.y + 20);
  await run30(9);
  await page.keyboard.press('Space');
  await run30(72);
  await page.mouse.down();
  for (let k = 1; k <= 24; k++) {
    await page.mouse.move(c.x + 260 - 25 * k, c.y + 20);
    await run30(1);
  }
  const held = await unprinted();
  await page.mouse.up();
  await run(3);
  const after = await unprinted();
  if (held || after) failed++;
  console.log(`${held || after ? 'FAIL' : 'ok  '} a page taken as the opening settles shows print on both sides: ${held} bare in the hand, ${after} after it landed`);
  await page.keyboard.press('Escape');
  await run(3);
  for (const e of errors) { failed++; console.log('FAIL page error: ' + e); }
} finally {
  await browser.close();
}
console.log(failed ? `${failed} step(s) failed` : 'reader: all steps passed');
process.exit(failed ? 1 : 0);
