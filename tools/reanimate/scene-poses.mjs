// Reads a three.js scene dump written by reanimate (`<capture>/three/scene-0.json`) and prints the pose of
// every book-like object: the chain of groups above each skinned or named mesh, with local and world
// transforms. Used to read rest poses out of a capture and to compare them with our own build.
//
//   node tools/reanimate/scene-poses.mjs <capture dir> [--mesh <name regexp>] [--near z] [--json out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(join(fileURLToPath(new URL('../../', import.meta.url)), 'package.json'));
const THREE = require('three');

const [dir, ...rest] = process.argv.slice(2);
if (!dir) { console.error('usage: node scene-poses.mjs <capture dir> [--mesh <regexp>] [--near z] [--json out.json]'); process.exit(2); }
const opt = (n, d) => { const i = rest.indexOf('--' + n); return i > -1 ? rest[i + 1] : d; };
const meshRe = new RegExp(opt('mesh', '^cover'), 'i');
const dump = JSON.parse(readFileSync(join(dir, 'three', 'scene-0.json'), 'utf8'));

const deg = (r) => +(r * 180 / Math.PI).toFixed(2);
const r3 = (v) => v.toArray().map((x) => +x.toFixed(3));

function walk(node, parentWorld, chain, out) {
  const local = new THREE.Matrix4();
  if (node.matrix) local.fromArray(node.matrix);
  const world = parentWorld.clone().multiply(local);
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  local.decompose(p, q, s);
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  const here = [...chain, { type: node.type, name: node.name ?? '', pos: r3(p), eulerXYZdeg: [deg(e.x), deg(e.y), deg(e.z)], quat: q.toArray().map((x) => +x.toFixed(4)), scale: r3(s) }];
  if ((node.type === 'SkinnedMesh' || node.type === 'Mesh') && meshRe.test(node.name ?? '')) {
    const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
    world.decompose(wp, wq, ws);
    const we = new THREE.Euler().setFromQuaternion(wq, 'XYZ');
    out.push({ mesh: node.name, world: { pos: r3(wp), eulerXYZdeg: [deg(we.x), deg(we.y), deg(we.z)], quat: wq.toArray().map((x) => +x.toFixed(4)), scale: r3(ws) }, chain: here });
  }
  for (const c of node.children ?? []) walk(c, world, here, out);
}

const found = [];
walk(dump.object, new THREE.Matrix4(), [], found);
const near = opt('near', '');
const list = near === '' ? found : found.filter((f) => Math.abs(f.world.pos[2] - Number(near)) < 3 && Math.abs(f.world.pos[1]) < 12);
const jsonOut = opt('json', '');
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(list, null, 1));
console.log(`${found.length} meshes matched ${meshRe}; showing ${list.length}`);
for (const f of list.slice(0, 6)) {
  console.log(`\n${f.mesh}  world pos ${f.world.pos}  euler ${f.world.eulerXYZdeg}  quat ${f.world.quat}  scale ${f.world.scale}`);
  for (const [i, c] of f.chain.entries()) {
    const identity = c.pos.every((x) => x === 0) && c.quat[3] === 1 && c.scale.every((x) => x === 1);
    if (!identity) console.log(`  ${' '.repeat(i)}${c.type} "${c.name}" pos ${c.pos} eulerXYZ ${c.eulerXYZdeg} scale ${c.scale}`);
  }
}
