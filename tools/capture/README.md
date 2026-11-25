# Capture tools

Small Playwright scripts for looking at a three.js page and measuring it. They drive Microsoft Edge by default; set `RE_CHANNEL=chrome`, or `RE_CHANNEL=` for Playwright's own Chromium.

Setup: `npm install` in this folder. Playwright is pinned to the release that matches the browsers installed on the machine these were written on; change the version in `package.json` if yours differ.

| File | What it does |
| --- | --- |
| `shot.mjs` | One screenshot of a page after it reports ready, with console errors. Options for viewport, a wait, a pointer position and code to run in the page |
| `record.mjs` | Records a scripted visit to a Casebound page as exact frames by stopping the engine's loop and advancing its clock by hand; a page without the engine, such as the stills, is run on its own clock instead. Scenes: `shelf`, `spin`, `row`, `reader`, `drag`, `curl`, `pen`, `lens`, `light`, `pointer`, `night`, `nightlens`, `zine`, `stills`. `--every 3` saves every third frame, `--span 150-220` only those frames |
| `gif.mjs` | Turns a folder of recorded frames into a GIF with its own palette (needs ffmpeg) |
| `check-reader.mjs`, `check-shelf.mjs`, `check-zine.mjs`, `check-stills.mjs` | Use the site like a reader in a real browser, one line per step, and exit with 1 if a step fails. See `.agents/skills/casebound/references/verify.md` |
| `gpu-check.mjs` | Prints the browser version, the WebGL renderer string and the frame cadence on a blank page |
| `dev-repl.mjs`, `dev-send.mjs` | Keep one browser session open and send it snippets over 127.0.0.1, so exploring a page costs one page load instead of one per question |
| `lib/hook.js` | Init script that listens for the objects three.js announces to developer tools, keeps the scene and renderer, and can dump the scene graph or sample object poses and uniforms per frame |
| `lib/browser.mjs` | Launch helper: channel, viewport profiles, GPU check, wait for a settled page |
| `lib/analyze.mjs` | Turns a sampling result into readable object paths and a summary of what changed |

## Examples

```sh
node shot.mjs "http://127.0.0.1:5183/?midday" out/home.png --wait 2600
node shot.mjs "http://127.0.0.1:5183/?midday#/book/opticks/page/40" out/reader.png --wait 3200 --eval "casebound.magnifier.set(true), 1" --move 600,400

node record.mjs http://127.0.0.1:5184 out/reader reader
ffmpeg -framerate 30 -i out/reader/f%04d.png -vf "scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" reader.gif

node dev-repl.mjs --url http://127.0.0.1:5183/ --state out/session --browser msedge
node dev-send.mjs --state out/session "return await page.evaluate(() => window.__CAP__.dumpScene())"
node dev-send.mjs --state out/session --quit
```

Frame-by-frame capture under a virtual clock, and comparison of two builds, is in [`../reanimate`](../reanimate).

Be a polite client when you point these at a site that is not yours: one session at a time, no request loops, and keep what you download out of version control.
