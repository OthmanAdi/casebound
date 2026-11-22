// Makes reanimate's capture scripts drive Microsoft Edge instead of Playwright's bundled Chromium,
// without changing reanimate's code. Load it with:
//   node --import file:///<abs path>/edge-preload.mjs --experimental-strip-types <reanimate>/scripts/capture.ts ...
//
// Env:
//   REANIMATE_SCRIPTS  absolute path of reanimate's `skills/reanimate/scripts` folder (required)
//   RE_CHANNEL         Playwright channel, default "msedge". Empty string keeps the bundled Chromium.
//   RE_UA              User-Agent override. Default: a plain Edge desktop string, no personal details.
import { createRequire } from "node:module";
import { join } from "node:path";

const scripts = process.env.REANIMATE_SCRIPTS;
if (!scripts) throw new Error("edge-preload: set REANIMATE_SCRIPTS to reanimate's skills/reanimate/scripts folder");

const require = createRequire(join(scripts, "package.json"));
const pw = require("playwright");
const channel = process.env.RE_CHANNEL ?? "msedge";
const ua = process.env.RE_UA ??
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36 Edg/156.0.0.0";

const origLaunch = pw.chromium.launch.bind(pw.chromium);
pw.chromium.launch = async (opts = {}) => {
  const browser = await origLaunch(channel ? { ...opts, channel } : opts);
  const origNewContext = browser.newContext.bind(browser);
  browser.newContext = (ctxOpts = {}) => origNewContext({ userAgent: ua, ...ctxOpts });
  const origNewPage = browser.newPage.bind(browser);
  browser.newPage = (pageOpts = {}) => origNewPage({ userAgent: ua, ...pageOpts });
  return browser;
};
