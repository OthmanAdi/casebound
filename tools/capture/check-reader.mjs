// Checks the reader in a real browser: keys, a page pulled over by hand, a page let go, taps, and a leaf
// sent back while it is still in the air. The engine's clock is driven by hand, so the result does not
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
