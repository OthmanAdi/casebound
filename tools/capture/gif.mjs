// Turns a folder of recorded frames (from record.mjs) into a GIF with its own palette.
//
//   node tools/capture/gif.mjs <frames dir> <out.gif> [--w 720] [--fps 15] [--colors 96] [--from 0] [--to 9999] [--in-fps 30]
//
// Needs ffmpeg: on the PATH, or its full path in the FFMPEG environment variable.
import { spawnSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const [dir, out, ...rest] = process.argv.slice(2);
if (!dir || !out) {
  console.error('usage: node gif.mjs <frames dir> <out.gif> [--w 720] [--fps 15] [--colors 96] [--from 0] [--to 9999] [--in-fps 30]');
  process.exit(2);
}
const opt = (name, fallback) => { const i = rest.indexOf('--' + name); return i > -1 ? rest[i + 1] : fallback; };
const width = Number(opt('w', 720));
const fps = Number(opt('fps', 15));
const colors = Number(opt('colors', 96));
const from = Number(opt('from', 0));
const to = Number(opt('to', 9999));
const inFps = Number(opt('in-fps', 30));

mkdirSync(dirname(resolve(out)), { recursive: true });
const filter = [
  `trim=start_frame=${from}:end_frame=${to + 1},setpts=PTS-STARTPTS`,
  `fps=${fps}`,
  `scale=${width}:-1:flags=lanczos`,
  // One palette for the whole clip, weighted toward what moves; ordered dither keeps still areas still.
  `split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
].join(',');
const run = spawnSync(process.env.FFMPEG ?? 'ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(inFps), '-i', resolve(dir, 'f%04d.png'), '-vf', filter, '-loop', '0', resolve(out)], { stdio: 'inherit' });
if (run.error) {
  console.error(`could not start ffmpeg: ${run.error.message}. Put it on the PATH or set FFMPEG to its full path.`);
  process.exit(1);
}
if (run.status !== 0) process.exit(run.status ?? 1);
console.log(`${out}: ${(statSync(resolve(out)).size / 1048576).toFixed(2)} MB`);
