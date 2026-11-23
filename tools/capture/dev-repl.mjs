// Development helper: keeps ONE browser session open and evaluates snippets sent to it over 127.0.0.1,
// so exploring a site costs one page load instead of one per question.
//   node dev-repl.mjs --url https://example.org/ --state <dir> [--browser msedge] [--profile desktop] [--headed]
//   node dev-send.mjs --state <dir> "<async js body, has: s, page, cdp, fs, path, lib>"
//   node dev-send.mjs --state <dir> --quit
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import * as lib from './lib/browser.mjs';

const args = lib.parseArgs(process.argv.slice(2), { browser: 'msedge', profile: 'desktop' });
if (!args.url || !args.state) { console.error('need --url and --state'); process.exit(2); }
fs.mkdirSync(args.state, { recursive: true });
const s = await lib.launch({ channel: args.browser, headless: !args.headed, profile: args.profile });
const cdp = await s.context.newCDPSession(s.page);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
let busy = false;
const server = http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.url === '/quit') { send(200, { ok: true }); await s.close(); server.close(); try { fs.rmSync(path.join(args.state, 'port')); } catch (_) {} process.exit(0); }
  if (busy) return send(409, { error: 'busy' });
  busy = true;
  try { const fn = new AsyncFunction('s', 'page', 'cdp', 'fs', 'path', 'lib', body); const out = await fn(s, s.page, cdp, fs, path, lib); send(200, { ok: true, result: out === undefined ? null : out }); }
  catch (e) { send(200, { ok: false, error: String(e && e.stack || e).slice(0, 2000) }); }
  finally { busy = false; }
});
server.listen(0, '127.0.0.1', async () => {
  fs.writeFileSync(path.join(args.state, 'port'), String(server.address().port));
  try {
    const t0 = Date.now();
    await s.page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const ready = await lib.waitReady(s.page);
    console.log(JSON.stringify({ started: true, port: server.address().port, version: s.version, ready, loadMs: Date.now() - t0 }));
  } catch (e) { console.log(JSON.stringify({ started: true, port: server.address().port, loadError: String(e).slice(0, 400) })); }
});
