// Runs a fixed list of frame-stepped captures with reanimate (https://github.com/NiazMorshed2007/reanimate),
// one after another, against a base URL. The same list is run against the reference and against our own
// build, so the two can be compared frame by frame and channel by channel.
//
// Usage:
//   node tools/reanimate/capture-series.mjs --base https://example.org --out <dir> [--only a,b] [--fps 60] [--query midday]
//        [--ready-attr data-press-agent-ready] [--reader-path /book/<slug>/page/<n>] [--ebook-at fx,fy] [--audio-at fx,fy]
//
// Defaults fit the reference. For our own build:
//   --ready-attr data-bindery-ready --reader-path "/#/book/micrographia/page/116" --ebook-at 0.764,0.648 --audio-at 0.764,0.697
//
// Env:
//   REANIMATE_SCRIPTS  absolute path of reanimate's `skills/reanimate/scripts` folder (required)
//   RE_CHANNEL         browser channel for the preload, default "msedge"
//
// Every capture uses reanimate's virtual clock: the page's time is advanced exactly 1/fps per frame and
// each frame is screenshotted, so frame k is t = k/fps on any machine. `--gl` records every shader uniform
// and every scene-graph value per frame.
//
// Output per series: <out>/<name>/ (frames, gl-track.json, capture.json, ...) and <out>/<name>.log.
// Output that shows a third party's site belongs in a folder that is not committed.
import { spawn } from "node:child_process";
import { mkdirSync, createWriteStream, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const base = arg("base");
const outRoot = arg("out");
const only = arg("only", "").split(",").filter(Boolean);
const fps = arg("fps", "60");
const query = arg("query", "");
const scripts = process.env.REANIMATE_SCRIPTS;

if (!base || !outRoot || !scripts) {
  console.error("usage: REANIMATE_SCRIPTS=<path> node capture-series.mjs --base <url> --out <dir> [--only a,b] [--fps 60] [--query midday]");
  process.exit(2);
}

// The page under test marks a settled view with this attribute. A promise that waits for it would
// deadlock under the virtual clock, so the check throws and the run fails loudly instead.
const readyAttr = arg("ready-attr", "data-press-agent-ready");
const READY = `if (document.documentElement.getAttribute('${readyAttr}') !== 'true') throw new Error('view not settled')`;
const click = (label) => `${READY}; document.querySelector('button[aria-label="${label}"]').click()`;

// The query goes before a hash, if the path has one.
const url = (path) => {
  const [plain, hash] = path.split("#");
  return base.replace(/\/$/, "") + plain + (query ? (plain.includes("?") ? "&" : "?") + query : "") + (hash === undefined ? "" : "#" + hash);
};
const READER = arg("reader-path", "/book/maintenance-part-one/page/116");

// Fractions of the 1440x900 canvas. The canvas ignores pointer events, so a point over a DOM control hits that control.
const EBOOK_ROW = arg("ebook-at", "0.764,0.936");
const AUDIOBOOK_ROW = arg("audio-at", "0.764,0.982");

// Home captures must trigger within about 5 s of load: after that the page starts to scroll by itself.
const HOME_SETTLE = "3000";
// A deep-linked reader starts its page animation up to 6 s after load.
const READER_SETTLE = "9000";

const SERIES = [
  { name: "b-hover-home", path: "/", settle: HOME_SETTLE, duration: "2600",
    args: ["--trigger", "move", "--target", "canvas", "--path", "0.15,0.5;0.45,0.55;0.6,0.4;0.4,0.6", "--path-ms", "400", "--pre-js", READY] },
  { name: "c-open-book", path: "/", settle: HOME_SETTLE, duration: "4200",
    args: ["--trigger", "click", "--target", 'button[aria-label^="Open book"]', "--pre-js", READY] },
  { name: "c-close-book", path: READER, settle: READER_SETTLE, duration: "3200",
    args: ["--trigger", "click", "--target", 'button[aria-label="Close book"]', "--pre-js", READY] },
  { name: "d-turn-next", path: READER, settle: READER_SETTLE, duration: "2600",
    args: ["--trigger", "click", "--target", 'button[aria-label="Next page"]', "--pre-js", READY] },
  { name: "d-turn-previous", path: READER, settle: READER_SETTLE, duration: "2600",
    args: ["--trigger", "click", "--target", 'button[aria-label="Previous page"]', "--pre-js", READY] },
  { name: "e-magnifier-on", path: READER, settle: READER_SETTLE, duration: "1600",
    args: ["--trigger", "click", "--target", 'button[aria-label="Turn on magnifier"]', "--pre-js", READY] },
  { name: "e-magnifier-move", path: READER, settle: READER_SETTLE, duration: "3200",
    args: ["--trigger", "move", "--target", "canvas", "--path", "0.2,0.35;0.5,0.5;0.4,0.75;0.25,0.5", "--path-ms", "500", "--pre-js", click("Turn on magnifier")] },
  { name: "f-hologram-ebook-row", path: READER, settle: READER_SETTLE, duration: "3200",
    args: ["--trigger", "hover", "--target", "canvas", "--hover-at", EBOOK_ROW, "--pre-js", READY] },
  { name: "f-radio-audiobook-row", path: READER, settle: READER_SETTLE, duration: "3200",
    args: ["--trigger", "hover", "--target", "canvas", "--hover-at", AUDIOBOOK_ROW, "--pre-js", READY] },
  { name: "g-view-details", path: "/", settle: HOME_SETTLE, duration: "3200",
    args: ["--trigger", "click", "--target", 'button[aria-label^="View details"]', "--pre-js", READY] },
];

const preload = pathToFileURL(join(here, "edge-preload.mjs")).href;
const capture = join(scripts, "capture.ts");
if (!existsSync(capture)) { console.error("capture.ts not found under REANIMATE_SCRIPTS: " + capture); process.exit(2); }
mkdirSync(resolve(outRoot), { recursive: true });

function run(series) {
  return new Promise((done) => {
    const out = resolve(outRoot, series.name);
    const log = createWriteStream(resolve(outRoot, series.name + ".log"));
    const argv = [
      "--no-warnings", "--import", preload, "--experimental-strip-types", capture,
      "--url", url(series.path), "--out", out,
      "--viewport", "1440x900", "--scale", "1",
      "--clock", "virtual", "--gpu", "hardware", "--gl",
      "--fps", fps, "--pre-roll", "200",
      "--wait-before", series.settle, "--duration", series.duration,
      "--track", "main",
      ...series.args,
    ];
    const started = process.hrtime.bigint();
    const child = spawn(process.execPath, argv, { env: { ...process.env, REANIMATE_SCRIPTS: scripts }, cwd: resolve(outRoot) });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.on("close", (code) => {
      const seconds = Number((process.hrtime.bigint() - started) / 1000000000n);
      log.end();
      console.log(`${series.name}: exit ${code} after ${seconds} s`);
      done({ name: series.name, code, seconds });
    });
  });
}

const todo = SERIES.filter((s) => !only.length || only.includes(s.name));
console.log(`base ${base} | query "${query}" | fps ${fps} | ${todo.length} series, one at a time`);
const results = [];
for (const series of todo) results.push(await run(series));
const failed = results.filter((r) => r.code !== 0);
console.log(failed.length ? `FAILED: ${failed.map((r) => r.name).join(", ")}` : "all series finished with exit 0");
process.exit(failed.length ? 1 : 0);
