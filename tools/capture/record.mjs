// Records a scripted visit to a Casebound page as numbered frames, one per step of the engine's clock.
// The engine's loop is stopped and advanced by hand, so every frame is exact whatever the machine's speed.
//
//   node tools/capture/record.mjs <base url> <out dir> <scene> [--fps 30] [--w 1440] [--h 900] [--every 1] [--span 0-9999] [--film 0.087]
//
// `--every 3` saves every third frame and `--span 150-220` only frames 150 to 220. The clock still runs through
// every frame, so a quick look at one moment shows the same picture as the full recording.
//
// Scenes: shelf, spin, row, reader, drag, curl, lens, light, pointer, night, nightlens. Turn the frames into a GIF or a video with ffmpeg, for example:
//   ffmpeg -framerate 30 -i <out dir>/f%04d.png -vf "scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" out.gif
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const [base, outDir, scene, ...rest] = process.argv.slice(2);
if (!base || !outDir || !scene) {
  console.error('usage: node record.mjs <base url> <out dir> <scene> [--fps 30] [--w 1440] [--h 900] [--every 1] [--span 0-9999] [--film 0.087]');
  process.exit(2);
}
const opt = (n, d) => { const i = rest.indexOf('--' + n); return i > -1 ? rest[i + 1] : d; };
const fps = Number(opt('fps', 30));
const width = Number(opt('w', 1440));
const height = Number(opt('h', 900));
const every = Math.max(1, Number(opt('every', 1)));
const film = opt('film', null) === null ? null : Number(opt('film', 0));
const [spanFrom, spanTo] = opt('span', '0-999999').split('-').map(Number);
const sec = (s) => Math.round(s * fps);
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** A pointer path through the given points, one step per frame. */
const glide = (from, to, frames, points) => points.flatMap(([x0, y0], i) => {
  if (i === points.length - 1) return [];
  const [x1, y1] = points[i + 1];
  const n = Math.round(frames / (points.length - 1));
  return Array.from({ length: n }, (_, k) => ({ at: from + i * n + k, run: (p) => p.mouse.move(x0 + (x1 - x0) * ease(k / n), y0 + (y1 - y0) * ease(k / n)) }));
});
/** A scroll from one position to another, in slots of the shelf. */
const scroll = (from, frames, a, b) => Array.from({ length: frames }, (_, k) => ({
  at: from + k,
  run: (p) => p.evaluate(([y0, y1, t]) => { const s = document.querySelector('.panel').offsetHeight + 16; scrollTo(0, (y0 + (y1 - y0) * t) * s); }, [a, b, ease((k + 1) / frames)]),
}));
const js = (at, code) => ({ at, run: (p) => p.evaluate(code) });
const key = (at, k) => ({ at, run: (p) => p.keyboard.press(k) });

const READER = '#/book/micrographia/page/116';
const SCENES = {
  shelf: { path: '/?midday', frames: sec(9), actions: [
    ...glide(sec(0.2), 0, sec(1.6), [[400, 500], [900, 380], [760, 560]]),
    ...scroll(sec(2), sec(1.3), 0, 1), ...scroll(sec(4.3), sec(1.3), 1, 2), ...scroll(sec(6.6), sec(1.3), 2, 3),
  ] },
  reader: { path: '/?midday', frames: sec(10.5), actions: [
    { at: 1, run: (p) => p.mouse.move(820, 430) },
    key(sec(0.6), 'Space'),
    key(sec(3.4), 'ArrowRight'), key(sec(5), 'ArrowRight'), key(sec(6.4), 'ArrowLeft'),
    ...glide(sec(7.6), 0, sec(1.6), [[820, 430], [520, 520], [900, 380]]),
    key(sec(9.4), 'Escape'),
  ] },
  lens: { path: '/?midday' + READER, frames: sec(7), settle: 3400, actions: [
    { at: 1, run: (p) => p.mouse.move(520, 360) },
    key(sec(0.5), 'm'),
    ...glide(sec(0.8), 0, sec(4.6), [[520, 360], [330, 300], [300, 560], [640, 520], [660, 330], [480, 420]]),
    key(sec(6.2), 'm'),
  ] },
  light: { path: '/?midday' + READER, frames: sec(8), settle: 3400, actions: [
    { at: 1, run: (p) => p.mouse.move(520, 420) },
    { at: sec(0.6), run: (p) => p.hover('#row-ebook') },
    { at: sec(3.4), run: (p) => p.mouse.move(520, 420) },
    { at: sec(4.2), run: (p) => p.hover('#row-audio') },
    { at: sec(7.2), run: (p) => p.mouse.move(520, 420) },
  ] },
  drag: { path: '/?midday', frames: sec(10.6), actions: [
    { at: 1, run: (p) => p.mouse.move(980, 470) },
    key(sec(0.3), 'Space'),
    // Pull a leaf all the way over and let go.
    { at: sec(2.7), run: (p) => p.mouse.down() },
    ...glide(sec(2.8), 0, sec(1.6), [[980, 470], [700, 430], [380, 470]]),
    { at: sec(4.5), run: (p) => p.mouse.up() },
    // Lift the next one half way, bring it back past where it was taken and let it fall.
    ...glide(sec(5.1), 0, sec(0.5), [[380, 470], [1000, 520]]),
    { at: sec(5.7), run: (p) => p.mouse.down() },
    ...glide(sec(5.8), 0, sec(1.8), [[1000, 520], [640, 470], [1012, 520]]),
    { at: sec(7.7), run: (p) => p.mouse.up() },
    // Pull one back from the left.
    ...glide(sec(8.1), 0, sec(0.4), [[1012, 520], [440, 480]]),
    { at: sec(8.6), run: (p) => p.mouse.down() },
    ...glide(sec(8.7), 0, sec(1), [[440, 480], [900, 440]]),
    { at: sec(9.8), run: (p) => p.mouse.up() },
  ] },
  spin: { path: '/?midday', frames: sec(8), settle: 2400, actions: [
    { at: 1, run: (p) => p.mouse.move(640, 520) },
    // Turn the book round by hand and let it coast.
    { at: sec(0.5), run: (p) => p.mouse.down() },
    ...glide(sec(0.55), 0, sec(0.7), [[640, 520], [900, 500]]),
    { at: sec(1.3), run: (p) => p.mouse.up() },
    // Catch it and bring it back to the front.
    { at: sec(4.2), run: (p) => p.mouse.move(760, 500) },
    { at: sec(4.4), run: (p) => p.mouse.down() },
    ...glide(sec(4.45), 0, sec(1.4), [[760, 500], [560, 470], [700, 540]]),
    { at: sec(5.9), run: (p) => p.mouse.up() },
  ] },
  row: { path: '/?midday', frames: sec(10), settle: 2400, actions: [
    js(1, `scrollTo(0, (document.querySelector('.panel').offsetHeight + 16) * 3)`),
    { at: 2, run: (p) => p.mouse.move(1100, 330) },
    // Scroll on past the last featured book: the row comes up.
    ...scroll(sec(1.4), sec(1.5), 3, 4),
    key(sec(4.4), 'ArrowRight'), key(sec(5.6), 'ArrowRight'),
    // Run the pointer along the spines, then choose one with a press.
    ...glide(sec(6.6), 0, sec(1.6), [[1100, 330], [560, 520], [330, 500]]),
    { at: sec(8.4), run: (p) => p.mouse.click(330, 500) },
  ] },
  curl: { path: '/?midday', frames: sec(12.4), actions: [
    { at: 1, run: (p) => p.mouse.move(1260, 300) },
    key(sec(0.3), 'Space'),
    // Rest the pointer near the head of the right page, then near its foot: the corner under it lifts.
    ...glide(sec(2.6), 0, sec(0.5), [[1260, 300], [1070, 300]]),
    ...glide(sec(4), 0, sec(0.8), [[1070, 300], [1080, 740]]),
    // Take the page by that corner, pull it over and let go.
    { at: sec(5.4), run: (p) => p.mouse.down() },
    ...glide(sec(5.5), 0, sec(1.6), [[1080, 740], [760, 640], [420, 700]]),
    { at: sec(7.2), run: (p) => p.mouse.up() },
    // Rest on the left page, turn a page with the key while the pointer stays there, then leave the book.
    ...glide(sec(8.6), 0, sec(0.5), [[420, 700], [380, 300]]),
    key(sec(9.8), 'ArrowRight'),
    ...glide(sec(11.4), 0, sec(0.4), [[380, 300], [700, 130]]),
  ] },
  pointer: { path: '/?midday', frames: sec(6), actions: glide(sec(0.2), 0, sec(5.4), [[300, 300], [1100, 300], [1150, 700], [330, 720], [720, 450], [300, 300]]) },
  night: { path: '/?theme=dark', frames: sec(7), actions: [
    ...glide(sec(0.2), 0, sec(2.4), [[300, 620], [1050, 320], [700, 500]]),
    ...scroll(sec(2.8), sec(1.3), 0, 1),
    ...glide(sec(4.4), 0, sec(2.2), [[700, 500], [1000, 640], [420, 380]]),
  ] },
  nightlens: { path: '/?theme=dark' + READER, frames: sec(7.5), settle: 3400, actions: [
    { at: 1, run: (p) => p.mouse.move(300, 330) },
    ...glide(sec(0.2), 0, sec(1.6), [[300, 330], [560, 420], [380, 560]]),
    key(sec(2), 'm'),
    ...glide(sec(2.3), 0, sec(4), [[380, 560], [300, 380], [520, 330], [600, 520], [430, 450]]),
    key(sec(6.8), 'm'),
  ] },
};

const def = SCENES[scene];
if (!def) { console.error(`unknown scene "${scene}". Scenes: ${Object.keys(SCENES).join(', ')}`); process.exit(2); }
const out = resolve(outDir);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: process.env.RE_CHANNEL ?? 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })).newPage();
  page.on('pageerror', (e) => console.log('pageerror:', String(e).slice(0, 300)));
  await page.goto(base.replace(/\/$/, '') + def.path, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('html[data-casebound-ready="true"]', { state: 'attached', timeout: 30000 });
  await page.waitForTimeout(def.settle ?? 400);
  // Take the clock: from here on the engine only moves when we tell it to.
  await page.evaluate(() => { casebound.engine.ctx.loop.stop(); window.__clock = performance.now(); });
  // Film grain changes on every frame, which a GIF pays for in size. `--film 0` records without it.
  if (film !== null) await page.evaluate((amount) => casebound.engine.ctx.registry.set('effect.film', 'amount', amount), film);
  const step = 1000 / fps;
  for (let f = 0; f < def.frames; f++) {
    for (const a of def.actions) if (a.at === f) await a.run(page);
    await page.evaluate((dt) => { window.__clock += dt; casebound.engine.ctx.loop.tick(window.__clock); }, step);
    if (f % every === 0 && f >= spanFrom && f <= spanTo) await page.screenshot({ path: resolve(out, `f${String(f).padStart(4, '0')}.png`) });
  }
  console.log(`${scene}: ${def.frames} frames at ${fps} fps in ${out}`);
} finally {
  await browser.close();
}
