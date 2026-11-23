// One screenshot of a page in Edge, after the page says it is ready. Used to look at our own build.
//   node tools/capture/shot.mjs <url> <out.png> [--w 1440] [--h 900] [--wait 600] [--ready <css>] [--eval "<js>"] [--move x,y]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const [url, out, ...rest] = process.argv.slice(2);
if (!url || !out) {
  console.error('usage: node shot.mjs <url> <out.png> [--w 1440] [--h 900] [--wait 600] [--ready <css>] [--eval "<js>"] [--move x,y]');
  process.exit(2);
}
const opt = (name, fallback) => {
  const i = rest.indexOf('--' + name);
  return i > -1 ? rest[i + 1] : fallback;
};
const width = Number(opt('w', 1440));
const height = Number(opt('h', 900));
const ready = opt('ready', 'html[data-casebound-ready="true"]');

const browser = await chromium.launch({ channel: process.env.RE_CHANNEL ?? 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })).newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text().slice(0, 400)}`); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + String(e).slice(0, 400)));
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector(ready, { state: 'attached', timeout: 20000 }).catch(() => problems.push('ready selector not seen: ' + ready));
  const move = opt('move', '');
  if (move) { const [x, y] = move.split(',').map(Number); await page.mouse.move(x, y, { steps: 8 }); }
  const js = opt('eval', '');
  if (js) console.log('eval:', JSON.stringify(await page.evaluate(js)));
  await page.waitForTimeout(Number(opt('wait', 600)));
  mkdirSync(dirname(resolve(out)), { recursive: true });
  await page.screenshot({ path: out });
  console.log('saved', out);
  for (const p of [...new Set(problems)].slice(0, 12)) console.log(p);
} finally {
  await browser.close();
}
