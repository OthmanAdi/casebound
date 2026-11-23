// Browser launch and page setup shared by every capture script.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const HOOK_PATH = path.join(here, 'hook.js');

export const PROFILES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
  // Only used to learn the renderer's pixel-ratio clamp. Motion is measured at deviceScaleFactor 1.
  'desktop-dpr2': { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
  'mobile-dpr3': { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};

// A generic browser User-Agent: the reduced string every Chromium browser of that major version sends.
export function genericUserAgent(channel, version, mobile) {
  const major = String(version).split('.')[0];
  if (mobile) return `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Mobile Safari/537.36` + (channel === 'msedge' ? ` EdgA/${major}.0.0.0` : '');
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36` + (channel === 'msedge' ? ` Edg/${major}.0.0.0` : '');
}

/**
 * @param {object} o
 * @param {'msedge'|'chrome'|'chromium'} [o.channel]  browser to drive (default msedge)
 * @param {boolean} [o.headless]
 * @param {string} [o.profile]  key of PROFILES
 * @param {string|null} [o.videoDir]  record a Playwright video into this directory
 */
export async function launch(o = {}) {
  const channel = o.channel || 'msedge';
  const headless = o.headless !== false;
  const profile = PROFILES[o.profile || 'desktop'];
  if (!profile) throw new Error('unknown profile ' + o.profile);
  const args = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-features=CalculateNativeWinOcclusion', ...(o.extraArgs || [])];
  if (!headless) args.push('--window-position=0,0', `--window-size=${profile.viewport.width + 40},${profile.viewport.height + 140}`);
  const browser = await chromium.launch({ channel: channel === 'chromium' ? undefined : channel, headless, args });
  const version = browser.version();
  const userAgent = genericUserAgent(channel, version, profile.isMobile);
  const context = await browser.newContext({
    viewport: profile.viewport, deviceScaleFactor: profile.deviceScaleFactor, isMobile: profile.isMobile, hasTouch: profile.hasTouch,
    userAgent, locale: 'en-US', colorScheme: 'light', reducedMotion: 'no-preference',
    ...(o.videoDir ? { recordVideo: { dir: o.videoDir, size: profile.viewport } } : {}),
  });
  await context.addInitScript({ path: HOOK_PATH });
  const page = await context.newPage();
  const consoleLog = [];
  page.on('console', (m) => { if (consoleLog.length < 400) consoleLog.push({ type: m.type(), text: m.text().slice(0, 300) }); });
  page.on('pageerror', (e) => { if (consoleLog.length < 400) consoleLog.push({ type: 'pageerror', text: String(e.message).slice(0, 300) }); });
  const session = { browser, context, page, channel, headless, version, userAgent, profileName: o.profile || 'desktop', profile, consoleLog };
  session.close = async () => { try { await context.close(); } catch (_) {} try { await browser.close(); } catch (_) {} };
  return session;
}

// GPU string of a scratch WebGL2 context on the current page.
export async function gpuInfo(page) {
  return page.evaluate(() => {
    const c = document.createElement('canvas'); const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return { webgl: false };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { webgl: true, webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
      vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      version: gl.getParameter(gl.VERSION), maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
  });
}
export const isSoftwareGpu = (s) => /swiftshader|llvmpipe|software|basic render|warp/i.test(String(s || ''));

// Wait until the page says its view has settled. The reference documents data-press-agent-ready;
// our own rebuild can set the same attribute. Falls back to "a scene was rendered and is quiet".
export async function waitReady(page, { timeout = 60000, attr = 'data-press-agent-ready' } = {}) {
  const t0 = Date.now();
  let via = 'attribute';
  try { await page.waitForFunction((a) => document.documentElement.getAttribute(a) === 'true', attr, { timeout }); }
  catch (_) { via = 'fallback: first screen render'; await page.waitForFunction(() => window.__CAP__ && window.__CAP__.main() && window.__CAP__.main().viaRender, null, { timeout: 20000 }); }
  return { via, ms: Date.now() - t0, view: await page.evaluate(() => document.documentElement.getAttribute('data-press-view')) };
}

// Wait until the scene stops moving: no object pose change for `quietMs` (real time).
export async function waitQuiet(page, { quietMs = 800, timeout = 15000 } = {}) {
  return page.evaluate(async ({ quietMs, timeout }) => {
    const C = window.__CAP__; const snap = () => { const m = C.main(); if (!m) return ''; let h = 0; const st = [m.scene]; while (st.length) { const o = st.pop(); for (const c of o.children) st.push(c); const e = o.matrixWorld.elements; h = (h * 31 + e[12] * 1e4 + e[13] * 1e4 * 7 + e[14] * 1e4 * 13 + e[0] * 1e4 * 17 + e[5] * 1e4 * 19) % 1e15; } if (m.camera) { const e = m.camera.matrixWorld.elements; h += e[12] * 1e5 + e[13] * 1e5 + e[14] * 1e5 + e[0] * 1e5; } return String(Math.round(h)); };
    const t0 = performance.now(); let last = snap(), since = performance.now();
    while (performance.now() - t0 < timeout) {
      await new Promise((r) => setTimeout(r, 50));
      const s = snap(); if (s !== last) { last = s; since = performance.now(); }
      else if (performance.now() - since >= quietMs) return { quiet: true, ms: Math.round(performance.now() - t0) };
    }
    return { quiet: false, ms: Math.round(performance.now() - t0) };
  }, { quietMs, timeout });
}

export function parseArgs(argv, defaults = {}) {
  const out = { ...defaults, _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const eq = a.indexOf('='); if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1); else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[a.slice(2)] = argv[++i]; else out[a.slice(2)] = true; }
    else out._.push(a);
  }
  return out;
}
