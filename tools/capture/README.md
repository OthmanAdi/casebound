# bindery capture harness

Playwright harness that measures a three.js page at runtime: live scene graph and motion samples.
Status: partial. The hook, the launcher and an interactive session runner work and were used against the
reference. The scripted runner, the fitter, the frame-stepped runner and the strip builder are not written yet.

Setup (already done here): `npm install` in this folder. Playwright is pinned to 1.63.0 because that release
matches the browsers already installed on this machine (`chromium-1243`, `ffmpeg-1011`). Nothing is installed
globally and no browser is downloaded.

## What works

| File | State | What it does |
|---|---|---|
| `lib/hook.js` | used, works | Init script. Defines `window.__THREE_DEVTOOLS__` as an `EventTarget`, keeps every `Scene` and `WebGLRenderer` three.js announces, wraps `renderer.render`. Exposes `window.__CAP__`: `dumpScene()`, `startSampling()` / `stopSampling()`, `items()`, `project()`, `screenBox()`, `pixelStats()`, `cadence()`. Read only. |
| `lib/browser.mjs` | used, works | `launch({ channel, headless, profile, vclock })`, GPU string check, `waitReady`, `waitQuiet`, viewport profiles (`desktop` 1440x900 dpr 1, `mobile` 390x844 touch dpr 1, `desktop-dpr2`, `mobile-dpr3`). |
| `lib/analyze.mjs` | used, works | Turns a sampling result into readable object paths and a change summary. |
| `gpu-check.mjs` | used, works | Prints browser version, WebGL renderer string and frame cadence on `about:blank`. |
| `dev-repl.mjs`, `dev-send.mjs` | used, works | One long browser session, snippets sent over 127.0.0.1. One page load for many questions. |
| `lib/vclock.js` | written, NOT tested | Virtual clock for frame-stepped capture (replaces `requestAnimationFrame`, `performance.now`, `Date.now`, timers; drives CSS/Web Animations while frozen). Never loaded against any page yet. |

## Commands

Browser check (no site traffic):

```
node gpu-check.mjs --browser msedge            # headless
node gpu-check.mjs --browser msedge --headed   # headed
node gpu-check.mjs --browser msedge --both
```

`--browser` takes `msedge`, `chrome` or `chromium`.

Interactive session against any URL (reference or our own `http://127.0.0.1:<port>`):

```
node dev-repl.mjs --url https://stripe.press/ --state <state-dir> --browser msedge --profile desktop
node dev-repl.mjs --url http://127.0.0.1:5173/ --state <state-dir> --browser msedge --profile mobile
# add --headed for a visible window, --vclock to also inject lib/vclock.js (untested)

node dev-send.mjs --state <state-dir> --file snippet.js     # async function body; has s, page, cdp, fs, path, lib
node dev-send.mjs --state <state-dir> "return await page.evaluate(() => window.__CAP__.cadence())"
node dev-send.mjs --state <state-dir> --quit                 # closes the browser and the server
```

Typical snippet:

```js
await page.evaluate(() => window.__CAP__.startSampling({ label: 'wheel-300' }));
await page.mouse.wheel(0, 300);
await page.waitForTimeout(4000);
const data = await page.evaluate(() => window.__CAP__.stopSampling());
fs.writeFileSync('C:/abs/path/out.json', JSON.stringify(data));
```

Scene dump: `await page.evaluate(() => window.__CAP__.dumpScene())`. Pass `{ shaderSource: true }` only when the
output goes under `research/_reference/`.

## Sampling output

`stopSampling()` returns: `frames` (per frame `t` = `performance.now()`, `raf` timestamp, `rendered`, `scrollY`),
`camera` (world position, quaternion, fov, zoom, projection terms, every frame), `lights` (dense, with the
channels that changed), `objects` (local position, quaternion, scale, visible, stored on change only, with
`objectIndex` giving the parent chain), `materials` (material scalars, shader uniforms and morph influences that
changed), `instanced`, `dom` probes, `events` (input and navigation log in the same clock), `cadence`.

## Rules learned the hard way

- Close popups. `Tab` then `Enter` on the reference activated an external link, the new tab took the foreground
  and the measured page dropped to 1 frame per second. Add
  `context.on('page', p => p !== page && p.close())` in any scripted runner.
- Headless Edge gives a real GPU here (ANGLE D3D11) and no stray pointer input from the desktop.
- Never visit `/cart` or `/checkout`, one session at a time.

## Not built yet

`capture.mjs` (scripted series with target URL and output directory arguments), `fit.mjs` (model fits),
`keyframes` tables, frame-stepped PNG capture using `lib/vclock.js`, frame strips, video.
