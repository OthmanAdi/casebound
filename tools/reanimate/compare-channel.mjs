// Compares one animated value between two reanimate captures, sample by sample.
//
//   node tools/reanimate/compare-channel.mjs --ref <capture dir> --ours <capture dir>
//        --ref-channel <name or regexp> --ours-channel <name or regexp>
//        [--from 0] [--to 2400] [--step 50] [--ref-scale 1] [--ours-scale 1] [--ref-offset 0] [--ours-offset 0] [--label text]
//
// A channel is given by its exact name, or by a regular expression; with a regexp the first match is used
// (add `--ref-pick n` / `--ours-pick n` to take the n-th, counting from 0). Values are multiplied by the scale
// and shifted by the offset before comparing, so differently named or differently scaled channels can be matched.
//
// Env: REANIMATE_SCRIPTS (reanimate's scripts folder), BUN (path of the bun executable; `gl.ts` needs bun).
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i > -1 ? args[i + 1] : d; };
const scripts = process.env.REANIMATE_SCRIPTS;
const bun = process.env.BUN ?? 'bun';
if (!scripts || !opt('ref') || !opt('ours') || !opt('ref-channel') || !opt('ours-channel')) {
  console.error('usage: REANIMATE_SCRIPTS=<dir> BUN=<bun> node compare-channel.mjs --ref <dir> --ours <dir> --ref-channel <re> --ours-channel <re> [options]');
  process.exit(2);
}
const gl = (...a) => execFileSync(bun, [join(scripts, 'gl.ts'), ...a], { cwd: scripts, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });

function series(dir, pattern, pick) {
  const names = gl('channels', dir, '--grep', pattern).split('\n').filter(Boolean).map((l) => l.split('\t')[0]);
  const exact = names.includes(pattern) ? pattern : names[pick];
  if (!exact) throw new Error(`no channel matches ${pattern} in ${dir}`);
  return { name: exact, matches: names.length, data: JSON.parse(gl('channels', dir, '--series', exact)) };
}
const at = (data, t) => {
  // Linear interpolation between the two samples around t.
  let i = data.findIndex((p) => p[0] >= t);
  if (i <= 0) return data[i === 0 ? 0 : data.length - 1][1];
  const [t0, v0] = data[i - 1], [t1, v1] = data[i];
  return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0 || 1);
};

const ref = series(resolve(opt('ref')), opt('ref-channel'), Number(opt('ref-pick', 0)));
const ours = series(resolve(opt('ours')), opt('ours-channel'), Number(opt('ours-pick', 0)));
const from = Number(opt('from', 0)), to = Number(opt('to', 2400)), step = Number(opt('step', 50));
const rs = Number(opt('ref-scale', 1)), os = Number(opt('ours-scale', 1)), ro = Number(opt('ref-offset', 0)), oo = Number(opt('ours-offset', 0));

let sum = 0, n = 0, worst = 0, worstT = 0, lo = Infinity, hi = -Infinity;
const rows = [];
for (let t = from; t <= to; t += step) {
  const a = at(ref.data, t) * rs + ro, b = at(ours.data, t) * os + oo;
  const d = b - a;
  sum += Math.abs(d); n++;
  lo = Math.min(lo, a); hi = Math.max(hi, a);
  if (Math.abs(d) > Math.abs(worst)) { worst = d; worstT = t; }
  rows.push({ t, a, b, d });
}
const range = hi - lo || 1;
console.log(`# ${opt('label', 'comparison')}`);
console.log(`reference: ${ref.name} (${ref.matches} match${ref.matches === 1 ? '' : 'es'})`);
console.log(`ours:      ${ours.name} (${ours.matches} match${ours.matches === 1 ? '' : 'es'})`);
console.log('| ms | reference | ours | difference |\n| --- | --- | --- | --- |');
const every = Math.max(1, Math.round(rows.length / 14));
for (const [i, r] of rows.entries()) if (i % every === 0 || i === rows.length - 1) console.log(`| ${r.t} | ${r.a.toFixed(4)} | ${r.b.toFixed(4)} | ${(r.d >= 0 ? '+' : '') + r.d.toFixed(4)} |`);
console.log(`mean absolute difference ${(sum / n).toFixed(4)} (${((sum / n / range) * 100).toFixed(1)} % of the reference range ${range.toFixed(4)}); worst ${(worst >= 0 ? '+' : '') + worst.toFixed(4)} at ${worstT} ms; ${n} samples`);
