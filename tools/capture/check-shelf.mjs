// Checks the shelf in a real browser: a book turned by hand, its coasting, a press that opens the details,
// and a turned book that forgets its turn when it leaves the centre. The engine's clock is driven by hand.
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

  // A pointer that rests on the book lifts its front cover a little.
  await page.mouse.move(c.x, c.y);
  await run(1.5);
  await check('the cover lifts under a resting pointer', (s) => Math.abs(s.front - 5 * Math.PI / 180) < 0.01);
  await shot('peek');

  // A press that does not move opens the details.
  await page.mouse.click(c.x, c.y);
  await run(1.2);
  await check('a press opens the details', (s) => typeof s.view === 'string' && s.view.startsWith('/book/'));
  await page.keyboard.press('Escape');
  await run(1.2);
  await check('Escape closes them', (s) => s.view === '/');

  // The next book comes to the centre; the turned one forgets its turn.
  await page.evaluate(() => scrollTo(0, document.querySelector('.panel').offsetHeight + 16));
  await run(3);
  await check('the next book is centred and the first has forgotten its turn', (s) => s.active !== 0 && Math.abs(s.firstYaw) < 0.01 && s.yaw === 0);
  for (const e of errors) { failed++; console.log('FAIL page error: ' + e); }
} finally {
  await browser.close();
}
console.log(failed ? `${failed} step(s) failed` : 'shelf: all steps passed');
process.exit(failed ? 1 : 0);
