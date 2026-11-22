// Sends a snippet to a running dev-repl.mjs. See dev-repl.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from './lib/browser.mjs';

const args = parseArgs(process.argv.slice(2));
const port = fs.readFileSync(path.join(args.state, 'port'), 'utf8').trim();
const body = args.quit ? '' : (args.file ? fs.readFileSync(args.file, 'utf8') : args._.join(' '));
const res = await fetch(`http://127.0.0.1:${port}/${args.quit ? 'quit' : 'eval'}`, { method: 'POST', body });
const json = await res.json();
if (json.ok === false) { console.error(json.error); process.exit(1); }
const out = typeof json.result === 'string' ? json.result : JSON.stringify(json.result, null, args.compact ? 0 : 1);
console.log(out);
