// Records a scripted visit to a Casebound page as numbered frames, one per step of the engine's clock.
// The engine's loop is stopped and advanced by hand, so every frame is exact whatever the machine's speed.
//
//   node tools/capture/record.mjs <base url> <out dir> <scene> [--fps 30] [--w 1440] [--h 900]
//
// Scenes: shelf, reader, lens, light, pointer, night. Turn the frames into a GIF or a video with ffmpeg, for example:
//   ffmpeg -framerate 30 -i <out dir>/f%04d.png -vf "scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" out.gif
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const [base, outDir, scene, ...rest] = process.argv.slice(2);
if (!base || !outDir || !scene) {
  console.error('usage: node record.mjs <base url> <out dir> <scene> [--fps 30] [--w 1440] [--h 900]');
  process.exit(2);
}
const opt = (n, d) => { const i = rest.indexOf('--' + n); return i > -1 ? rest[i + 1] : d; };
const fps = Number(opt('fps', 30));
const width = Number(opt('w', 1440));
const height = Number(opt('h', 900));
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

const READER = '#/book/micrographia/page/36';
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
  lens: { path: '/?midday' + READER, frames: sec(7), settle: 2600, actions: [
    { at: 1, run: (p) => p.mouse.move(520, 360) },
    key(sec(0.5), 'm'),
    ...glide(sec(0.8), 0, sec(4.6), [[520, 360], [330, 300], [300, 560], [640, 520], [660, 330], [480, 420]]),
    key(sec(6.2), 'm'),
  ] },
  light: { path: '/?midday' + READER, frames: sec(8), settle: 2600, actions: [
    { at: 1, run: (p) => p.mouse.move(520, 420) },
    { at: sec(0.6), run: (p) => p.hover('#row-ebook') },
    { at: sec(3.4), run: (p) => p.mouse.move(520, 420) },
    { at: sec(4.2), run: (p) => p.hover('#row-audio') },
    { at: sec(7.2), run: (p) => p.mouse.move(520, 420) },
  ] },
  pointer: { path: '/?midday', frames: sec(6), actions: glide(sec(0.2), 0, sec(5.4), [[300, 300], [1100, 300], [1150, 700], [330, 720], [720, 450], [300, 300]]) },
  night: { path: '/?theme=dark', frames: sec(7), actions: [
    ...glide(sec(0.2), 0, sec(2.4), [[300, 620], [1050, 320], [700, 500]]),
    ...scroll(sec(2.8), sec(1.3), 0, 1),
    ...glide(sec(4.4), 0, sec(2.2), [[700, 500], [1000, 640], [420, 380]]),
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
  const step = 1000 / fps;
  for (let f = 0; f < def.frames; f++) {
    for (const a of def.actions) if (a.at === f) await a.run(page);
    await page.evaluate((dt) => { window.__clock += dt; casebound.engine.ctx.loop.tick(window.__clock); }, step);
    await page.screenshot({ path: resolve(out, `f${String(f).padStart(4, '0')}.png`) });
  }
  console.log(`${scene}: ${def.frames} frames at ${fps} fps in ${out}`);
} finally {
  await browser.close();
}
