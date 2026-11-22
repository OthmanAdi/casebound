// Helpers that turn a raw sampling result (hook.js stopSampling) into readable paths and summaries.

// "item 7/Scene/book/armature_cover/frontcover1": path from the scene root, unnamed nodes shown as their type,
// repeated-item roots shown as "item N".
export function makePathFn(objectIndex, items = []) {
  const itemByUuid = new Map(items.map((it) => [it.uuid, it]));
  const cache = new Map();
  const path = (uuid) => {
    if (cache.has(uuid)) return cache.get(uuid);
    const o = objectIndex[uuid]; if (!o) return '?';
    let label;
    if (itemByUuid.has(uuid)) label = `item${itemByUuid.get(uuid).index}`;
    else label = o.name || `<${o.type}>`;
    const parent = o.parent && objectIndex[o.parent] ? path(o.parent) : '';
    const out = parent && objectIndex[o.parent].type !== 'Scene' ? `${parent}/${label}` : label;
    cache.set(uuid, out); return out;
  };
  return path;
}
export function itemOf(uuid, objectIndex, items = []) {
  const set = new Map(items.map((it) => [it.uuid, it.index]));
  for (let u = uuid; u; u = objectIndex[u] && objectIndex[u].parent) if (set.has(u)) return set.get(u);
  return null;
}

const range = (a) => { let lo = Infinity, hi = -Infinity; for (const v of a) { if (v === null || v !== v) continue; if (v < lo) lo = v; if (v > hi) hi = v; } return [lo, hi]; };

// Which things changed during a sampling run, and by how much. Compact, for logs and reports.
export function summarize(data, items = [], { maxObjects = 40 } = {}) {
  const out = { frames: data.frames.n, cadence: data.cadence, durationMs: data.frames.t[data.frames.n - 1], events: {}, camera: {}, lights: {}, objects: [], materials: [], dom: {} };
  for (const e of data.events) out.events[e.type] = (out.events[e.type] || 0) + 1;
  const sc = range(data.frames.scrollY); out.scrollY = { from: data.frames.scrollY[0], to: data.frames.scrollY[data.frames.n - 1], min: sc[0], max: sc[1] };
  const cam = data.camera;
  for (let k = 0; k < 3; k++) { const r = range(cam.position.map((p) => (p ? p[k] : null))); if (r[1] - r[0] > 1e-6) out.camera['p' + 'xyz'[k]] = r; }
  for (let k = 0; k < 4; k++) { const r = range(cam.quaternion.map((p) => (p ? p[k] : null))); if (r[1] - r[0] > 1e-6) out.camera['q' + 'xyzw'[k]] = r; }
  for (const key of ['fov', 'zoom']) { const r = range(cam[key]); if (r[1] - r[0] > 1e-6) out.camera[key] = r; }
  for (const key of ['p0', 'p5', 'p8', 'p9']) { const r = range(cam.proj[key]); if (r[1] - r[0] > 1e-6) out.camera['proj.' + key] = r; }
  out.camera.rest = { position: cam.position[0], quaternion: cam.quaternion[0], fov: cam.fov[0] };
  for (const [uuid, L] of Object.entries(data.lights)) if (L.changed.length) { const o = { type: L.type }; for (const k of L.changed) o[k] = range(L.series[k]); out.lights[uuid.slice(0, 8)] = o; }
  const path = makePathFn(data.objectIndex, items);
  const objs = [];
  for (const [uuid, o] of Object.entries(data.objects)) {
    const cols = {}; let any = false;
    o.cols.forEach((c, ci) => { const r = range(o.v.map((row) => row[ci])); if (r[1] - r[0] > 1e-7) { cols[c] = [+r[0].toFixed(4), +r[1].toFixed(4)]; any = true; } });
    objs.push({ path: path(uuid), type: o.type, item: itemOf(uuid, data.objectIndex, items), changes: o.f.length - 1, firstChange: o.f[1] ?? null, lastChange: o.f[o.f.length - 1], appeared: o.first > 0 ? o.first : undefined, gone: o.lastSeen < data.frames.n - 1 ? o.lastSeen : undefined, cols: any ? cols : undefined });
  }
  objs.sort((a, b) => b.changes - a.changes);
  out.objectsChanged = objs.length; out.objects = objs.slice(0, maxObjects);
  for (const [key, M] of Object.entries(data.materials)) { const o = { owner: path(M.owner), kind: M.kind, type: M.type, name: M.name, keys: {} }; for (const [k, col] of Object.entries(M.series)) o.keys[k] = range(col).map((v) => +v.toFixed(5)); out.materials.push(o); }
  for (const [name, D] of Object.entries(data.dom)) { const o = {}; D.props.forEach((p, pi) => { const vals = new Set(D.style.map((s) => (s ? s[pi] : null))); if (vals.size > 1) o[p] = vals.size + ' distinct'; }); out.dom[name] = o; }
  return out;
}
