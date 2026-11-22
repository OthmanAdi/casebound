// bindery capture hook. Injected with page.addInitScript, so it runs before any page script.
// Plain browser JS, no imports. Everything it exposes lives on window.__CAP__.
//
// How it reaches the live scene:
//   three.js announces objects to devtools. If window.__THREE_DEVTOOLS__ is an EventTarget,
//   every Scene and WebGLRenderer constructor dispatches CustomEvent("observe", { detail: object }).
//   We keep those references and wrap renderer.render to learn which scene and camera are drawn.
//
// It only reads. It never changes a transform, material or uniform of the page.
(() => {
  'use strict';
  if (window.__CAP__ || window.top !== window) return;

  const perfNow = () => performance.now();
  const CAP = {
    version: '0.1.0',
    three: { revision: null, registerEvents: 0 },
    scenes: [],            // live Scene references
    renderers: [],         // live WebGLRenderer references
    otherObserved: {},     // type -> count, for anything else three announces
    renderLog: new Map(),  // "scene|camera|target" -> stats
    lastRenderByScene: new Map(),
    frame: { no: 0, raf: 0, intervals: [], lastRaf: 0 },
    events: [],
    eventLogOn: true,
    errors: [],
    hookNotes: [],
  };
  Object.defineProperty(window, '__CAP__', { value: CAP, enumerable: false, configurable: false, writable: false });

  // ------------------------------------------------------------------ three devtools channel
  const target = new EventTarget();
  target.addEventListener('register', (e) => {
    CAP.three.registerEvents++;
    if (e.detail && e.detail.revision) CAP.three.revision = String(e.detail.revision);
  });
  target.addEventListener('observe', (e) => {
    const o = e.detail;
    try {
      if (!o) return;
      if (o.isScene) { if (!CAP.scenes.includes(o)) CAP.scenes.push(o); }
      else if (o.isWebGLRenderer || (typeof o.render === 'function' && o.domElement)) addRenderer(o);
      else {
        const k = o.type || (o.constructor && o.constructor.name) || 'unknown';
        CAP.otherObserved[k] = (CAP.otherObserved[k] || 0) + 1;
      }
    } catch (err) { CAP.errors.push('observe: ' + err.message); }
  });
  try {
    Object.defineProperty(window, '__THREE_DEVTOOLS__', { value: target, writable: true, configurable: true });
  } catch (err) { CAP.errors.push('define __THREE_DEVTOOLS__: ' + err.message); }

  function addRenderer(r) {
    if (CAP.renderers.includes(r)) return;
    CAP.renderers.push(r);
    const wrap = () => {
      if (r.__capWrapped || typeof r.render !== 'function') return false;
      const orig = r.render;
      r.render = function capRender(scene, camera) {
        const out = orig.apply(this, arguments);
        try { onRender(this, scene, camera); } catch (err) { if (CAP.errors.length < 50) CAP.errors.push('onRender: ' + err.message); }
        return out;
      };
      r.__capWrapped = true;
      return true;
    };
    if (!wrap()) { queueMicrotask(wrap); setTimeout(wrap, 0); }
  }

  // ------------------------------------------------------------------ frame clock (our own rAF loop)
  // Registered before any page script, so it runs first in every frame.
  const nativeRAF = window.requestAnimationFrame.bind(window);
  function tick(ts) {
    try {
      const f = CAP.frame;
      if (S && S.on) finishFrame();          // close the previous frame if nothing rendered in it
      if (f.lastRaf) { f.intervals.push(ts - f.lastRaf); if (f.intervals.length > 600) f.intervals.shift(); }
      f.lastRaf = ts; f.raf = ts; f.no++;
      f.renderedThisFrame = 0;
    } catch (err) { if (CAP.errors.length < 50) CAP.errors.push('tick: ' + err.message); }
    nativeRAF(tick);
  }
  nativeRAF(tick);

  // ------------------------------------------------------------------ render accounting
  function rtInfo(rt) {
    if (!rt) return null;
    return { w: rt.width, h: rt.height, cube: !!rt.isWebGLCubeRenderTarget, samples: rt.samples || 0,
      name: (rt.texture && rt.texture.name) || '', depth: !!rt.depthBuffer };
  }
  function onRender(renderer, scene, camera) {
    const rt = renderer.getRenderTarget ? renderer.getRenderTarget() : null;
    const f = CAP.frame;
    const key = (scene && scene.uuid) + '|' + (camera && camera.uuid) + '|' + (rt ? rt.width + 'x' + rt.height + (rt.isWebGLCubeRenderTarget ? 'c' : '') : 'screen');
    let rec = CAP.renderLog.get(key);
    if (!rec) {
      rec = { scene: scene && scene.uuid, sceneType: scene && scene.type, sceneName: scene && scene.name,
        isScene: !!(scene && scene.isScene), camera: camera && camera.uuid, cameraType: camera && camera.type,
        target: rtInfo(rt), calls: 0, firstFrame: f.no, lastFrame: f.no, framesWithCall: 0 };
      CAP.renderLog.set(key, rec);
    }
    rec.calls++;
    if (rec.lastFrame !== f.no || rec.calls === 1) rec.framesWithCall++;
    rec.lastFrame = f.no;
    if (scene && scene.isScene) {
      if (!CAP.scenes.includes(scene)) { CAP.scenes.push(scene); CAP.hookNotes.push('scene first seen through render(), not observe'); }
      CAP.lastRenderByScene.set(scene.uuid, { scene, camera, renderer, frame: f.no, screen: !rt, t: perfNow() });
    }
    if (!rt) {
      f.renderedThisFrame = (f.renderedThisFrame || 0) + 1;
      if (CAP._wantPixels) { try { CAP._pixels = readPixelStats(renderer); } catch (err) { CAP._pixels = { error: err.message }; } CAP._wantPixels = false; }
      if (S && S.on) sampleFrame(true);
    }
  }

  // The scene the user is looking at: the rendered Scene with the most objects.
  function countObjects(root) { let n = 0; const st = [root]; while (st.length) { const o = st.pop(); n++; const c = o.children; for (let i = 0; i < c.length; i++) st.push(c[i]); } return n; }
  CAP.main = function main() {
    let best = null, bestN = -1;
    for (const rec of CAP.lastRenderByScene.values()) {
      if (CAP.frame.no - rec.frame > 600 && best) continue;
      const n = countObjects(rec.scene);
      if (n > bestN) { bestN = n; best = rec; }
    }
    if (!best && CAP.scenes.length) {
      let sc = CAP.scenes[0];
      for (const s of CAP.scenes) if (countObjects(s) > countObjects(sc)) sc = s;
      return { scene: sc, camera: null, renderer: CAP.renderers[0] || null, objects: countObjects(sc), viaRender: false };
    }
    return best ? { scene: best.scene, camera: best.camera, renderer: best.renderer, objects: bestN, viaRender: true, frame: best.frame } : null;
  };

  // ------------------------------------------------------------------ pixel check (is the frame blank?)
  function readPixelStats(renderer) {
    const gl = renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let n = 0, sr = 0, sg = 0, sb = 0, sl = 0, sl2 = 0; const seen = new Set();
    const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 20000)));
    for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4; const r = buf[i], g = buf[i + 1], b = buf[i + 2];
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      n++; sr += r; sg += g; sb += b; sl += l; sl2 += l * l; seen.add((r << 16) | (g << 8) | b);
    }
    const mean = sl / n;
    return { w, h, samples: n, meanRGB: [sr / n, sg / n, sb / n].map((v) => +v.toFixed(2)), lumaMean: +mean.toFixed(2),
      lumaStd: +Math.sqrt(Math.max(0, sl2 / n - mean * mean)).toFixed(2), distinctColors: seen.size };
  }
  // Resolves with pixel statistics of the next frame drawn to the screen.
  CAP.pixelStats = function pixelStats(timeoutMs = 3000) {
    return new Promise((resolve) => {
      CAP._pixels = null; CAP._wantPixels = true;
      const t0 = perfNow();
      const poll = () => {
        if (CAP._pixels) return resolve(CAP._pixels);
        if (perfNow() - t0 > timeoutMs) { CAP._wantPixels = false; return resolve({ error: 'no screen render within ' + timeoutMs + ' ms' }); }
        nativeRAF(poll);
      };
      poll();
    });
  };

  // ------------------------------------------------------------------ input and navigation log
  const logEvent = (type, d) => { if (CAP.eventLogOn && CAP.events.length < 20000) CAP.events.push(Object.assign({ type, t: +perfNow().toFixed(3), frame: CAP.frame.no }, d)); };
  const tgt = (e) => { const el = e.target; if (!el || !el.tagName) return ''; return el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''); };
  const ptr = (e) => ({ x: e.clientX, y: e.clientY, buttons: e.buttons, pt: e.pointerType || undefined, on: tgt(e), trusted: e.isTrusted });
  for (const type of ['pointerdown', 'pointerup', 'pointermove', 'pointerover', 'pointerout', 'pointercancel', 'click', 'dblclick'])
    window.addEventListener(type, (e) => logEvent(type, ptr(e)), { capture: true, passive: true });
  window.addEventListener('wheel', (e) => logEvent('wheel', { x: e.clientX, y: e.clientY, dx: e.deltaX, dy: e.deltaY, mode: e.deltaMode, ctrl: e.ctrlKey, on: tgt(e), cancelable: e.cancelable }), { capture: true, passive: true });
  for (const type of ['keydown', 'keyup'])
    window.addEventListener(type, (e) => logEvent(type, { key: e.key, code: e.code, on: tgt(e), repeat: e.repeat }), { capture: true, passive: true });
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel'])
    window.addEventListener(type, (e) => { const t = e.changedTouches && e.changedTouches[0]; logEvent(type, { x: t && t.clientX, y: t && t.clientY, n: e.touches.length, on: tgt(e) }); }, { capture: true, passive: true });
  window.addEventListener('scroll', (e) => logEvent('scroll', { on: e.target === document ? 'document' : tgt(e), y: window.scrollY }), { capture: true, passive: true });
  window.addEventListener('popstate', () => logEvent('popstate', { url: location.pathname + location.search }), true);
  for (const m of ['pushState', 'replaceState']) {
    const orig = history[m];
    history[m] = function () { const r = orig.apply(this, arguments); try { logEvent(m, { url: location.pathname + location.search }); } catch (_) {} return r; };
  }
  // Root attributes the site documents for automation (data-press-*).
  const startAttrWatch = () => {
    const root = document.documentElement; if (!root) return false;
    new MutationObserver((list) => { for (const m of list) if (m.attributeName && m.attributeName.startsWith('data-')) logEvent('rootattr', { name: m.attributeName, value: root.getAttribute(m.attributeName) }); })
      .observe(root, { attributes: true });
    return true;
  };
  if (!startAttrWatch()) document.addEventListener('readystatechange', startAttrWatch, { once: true });
  CAP.mark = (name, extra) => logEvent('mark', Object.assign({ name }, extra || {}));
  CAP.takeEvents = () => { const e = CAP.events; CAP.events = []; return e; };

  // ------------------------------------------------------------------ constants -> names
  const N = {
    toneMapping: { 0: 'NoToneMapping', 1: 'LinearToneMapping', 2: 'ReinhardToneMapping', 3: 'CineonToneMapping', 4: 'ACESFilmicToneMapping', 5: 'CustomToneMapping', 6: 'AgXToneMapping', 7: 'NeutralToneMapping' },
    shadowType: { 0: 'BasicShadowMap', 1: 'PCFShadowMap', 2: 'PCFSoftShadowMap', 3: 'VSMShadowMap' },
    side: { 0: 'FrontSide', 1: 'BackSide', 2: 'DoubleSide' },
    blending: { 0: 'NoBlending', 1: 'NormalBlending', 2: 'AdditiveBlending', 3: 'SubtractiveBlending', 4: 'MultiplyBlending', 5: 'CustomBlending' },
    mapping: { 300: 'UVMapping', 301: 'CubeReflectionMapping', 302: 'CubeRefractionMapping', 303: 'EquirectangularReflectionMapping', 304: 'EquirectangularRefractionMapping', 306: 'CubeUVReflectionMapping' },
    wrap: { 1000: 'RepeatWrapping', 1001: 'ClampToEdgeWrapping', 1002: 'MirroredRepeatWrapping' },
    filter: { 1003: 'NearestFilter', 1004: 'NearestMipmapNearestFilter', 1005: 'NearestMipmapLinearFilter', 1006: 'LinearFilter', 1007: 'LinearMipmapNearestFilter', 1008: 'LinearMipmapLinearFilter' },
    texType: { 1009: 'UnsignedByteType', 1010: 'ByteType', 1011: 'ShortType', 1012: 'UnsignedShortType', 1013: 'IntType', 1014: 'UnsignedIntType', 1015: 'FloatType', 1016: 'HalfFloatType', 1020: 'UnsignedInt248Type', 35902: 'UnsignedInt5999Type' },
    format: { 1021: 'AlphaFormat', 1022: 'RGBFormat', 1023: 'RGBAFormat', 1026: 'DepthFormat', 1027: 'DepthStencilFormat', 1028: 'RedFormat', 1029: 'RedIntegerFormat', 1030: 'RGFormat',
      33776: 'RGB_S3TC_DXT1', 33777: 'RGBA_S3TC_DXT1', 33778: 'RGBA_S3TC_DXT3', 33779: 'RGBA_S3TC_DXT5', 36196: 'RGB_ETC1', 37492: 'RGB_ETC2', 37496: 'RGBA_ETC2_EAC',
      37808: 'RGBA_ASTC_4x4', 37812: 'RGBA_ASTC_6x6', 37815: 'RGBA_ASTC_8x8', 36492: 'RGBA_BPTC', 36494: 'RGB_BPTC_SIGNED', 36495: 'RGB_BPTC_UNSIGNED', 36283: 'RED_RGTC1', 36285: 'RED_GREEN_RGTC2',
      35840: 'RGB_PVRTC_4BPPV1', 35842: 'RGBA_PVRTC_4BPPV1' },
    depthPacking: { 3200: 'BasicDepthPacking', 3201: 'RGBADepthPacking' },
  };
  const named = (table, v) => (v === undefined || v === null ? v : (N[table][v] !== undefined ? N[table][v] : v));

  // ------------------------------------------------------------------ small math (no dependency on the page's three)
  const r6 = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 1e6) / 1e6 : v);
  const r7 = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 1e7) / 1e7 : v);
  const arr = (a, f = r6) => Array.from(a, f);
  function decompose(e) {
    let sx = Math.hypot(e[0], e[1], e[2]); const sy = Math.hypot(e[4], e[5], e[6]); const sz = Math.hypot(e[8], e[9], e[10]);
    const det = e[0] * (e[5] * e[10] - e[6] * e[9]) - e[4] * (e[1] * e[10] - e[2] * e[9]) + e[8] * (e[1] * e[6] - e[2] * e[5]);
    if (det < 0) sx = -sx;
    const ix = sx ? 1 / sx : 0, iy = sy ? 1 / sy : 0, iz = sz ? 1 / sz : 0;
    const m11 = e[0] * ix, m12 = e[4] * iy, m13 = e[8] * iz, m21 = e[1] * ix, m22 = e[5] * iy, m23 = e[9] * iz, m31 = e[2] * ix, m32 = e[6] * iy, m33 = e[10] * iz;
    const tr = m11 + m22 + m33; let x, y, z, w;
    if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1.0); w = 0.25 / s; x = (m32 - m23) * s; y = (m13 - m31) * s; z = (m21 - m12) * s; }
    else if (m11 > m22 && m11 > m33) { const s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33); w = (m32 - m23) / s; x = 0.25 * s; y = (m12 + m21) / s; z = (m13 + m31) / s; }
    else if (m22 > m33) { const s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33); w = (m13 - m31) / s; x = (m12 + m21) / s; y = 0.25 * s; z = (m23 + m32) / s; }
    else { const s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22); w = (m21 - m12) / s; x = (m13 + m31) / s; y = (m23 + m32) / s; z = 0.25 * s; }
    return { p: [e[12], e[13], e[14]], q: [x, y, z, w], s: [sx, sy, sz] };
  }
  function eulerXYZ(q) { // degrees, three's default XYZ order
    const [x, y, z, w] = q;
    const m11 = 1 - 2 * (y * y + z * z), m12 = 2 * (x * y - z * w), m13 = 2 * (x * z + y * w), m22 = 1 - 2 * (x * x + z * z), m23 = 2 * (y * z - x * w), m32 = 2 * (y * z + x * w), m33 = 1 - 2 * (x * x + y * y);
    const ey = Math.asin(Math.max(-1, Math.min(1, m13))); let ex, ez;
    if (Math.abs(m13) < 0.9999999) { ex = Math.atan2(-m23, m33); ez = Math.atan2(-m12, m11); } else { ex = Math.atan2(m32, m22); ez = 0; }
    const d = 180 / Math.PI; return [ex * d, ey * d, ez * d];
  }
  const colorOut = (c) => (c && c.isColor ? { hex: '#' + c.getHexString(), linear: [r6(c.r), r6(c.g), r6(c.b)] } : null);
  const vecOut = (v) => (v ? (v.w !== undefined && v.isVector4 ? [v.x, v.y, v.z, v.w] : v.z !== undefined ? [v.x, v.y, v.z] : [v.x, v.y]).map(r6) : null);
  const worldOf = (o) => { const d = decompose(o.matrixWorld.elements); return { position: arr(d.p), quaternion: arr(d.q, r7), rotationDegXYZ: arr(eulerXYZ(d.q), (v) => Math.round(v * 1e4) / 1e4), scale: arr(d.s) }; };
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); }

  // ------------------------------------------------------------------ scene dump
  function describeTexture(t) {
    const img = t.image; let w = null, h = null, depth = null, kind = null, src = null, faces = null;
    const one = (im) => {
      if (!im) return;
      w = im.width !== undefined ? im.width : (im.videoWidth !== undefined ? im.videoWidth : null);
      h = im.height !== undefined ? im.height : (im.videoHeight !== undefined ? im.videoHeight : null);
      if (im.depth !== undefined) depth = im.depth;
      kind = im.tagName ? im.tagName.toLowerCase() : (typeof ImageBitmap !== 'undefined' && im instanceof ImageBitmap ? 'ImageBitmap' : (im.data ? 'data' : typeof im));
      const s = (typeof im.currentSrc === 'string' && im.currentSrc) || (typeof im.src === 'string' && im.src) || null;
      if (s) src = s.startsWith('data:') ? 'data:' + s.slice(5, 40) + '...' : s.replace(location.origin, '');
    };
    if (Array.isArray(img)) { faces = img.length; one(img[0]); } else one(img);
    const flags = ['isCompressedTexture', 'isCompressedArrayTexture', 'isCubeTexture', 'isCanvasTexture', 'isVideoTexture', 'isDataTexture', 'isDataArrayTexture', 'isData3DTexture', 'isDepthTexture', 'isRenderTargetTexture', 'isFramebufferTexture'].filter((k) => t[k]);
    const mips = Array.isArray(t.mipmaps) ? t.mipmaps.length : 0;
    if ((w === null || w === undefined) && mips && t.mipmaps[0]) { w = t.mipmaps[0].width; h = t.mipmaps[0].height; }
    return { uuid: t.uuid, name: t.name || '', flags, image: { width: w, height: h, depth, kind, faces, src },
      mipmaps: mips, generateMipmaps: t.generateMipmaps, format: named('format', t.format), type: named('texType', t.type), colorSpace: t.colorSpace,
      mapping: named('mapping', t.mapping), wrapS: named('wrap', t.wrapS), wrapT: named('wrap', t.wrapT), minFilter: named('filter', t.minFilter), magFilter: named('filter', t.magFilter),
      anisotropy: t.anisotropy, flipY: t.flipY, repeat: vecOut(t.repeat), offset: vecOut(t.offset), rotation: t.rotation, channel: t.channel,
      userDataKeys: t.userData ? Object.keys(t.userData).slice(0, 12) : [] };
  }
  function uniformValue(v, texId) {
    if (v === null || v === undefined) return v;
    if (typeof v === 'number' || typeof v === 'boolean') return typeof v === 'number' ? r6(v) : v;
    if (v.isTexture) return { texture: texId(v) };
    if (v.isColor) return { color: colorOut(v) };
    if (v.isVector2 || v.isVector3 || v.isVector4) return { vec: vecOut(v) };
    if (v.isQuaternion) return { quat: [v.x, v.y, v.z, v.w].map(r7) };
    if (v.isMatrix3 || v.isMatrix4) return { matrix: arr(v.elements) };
    if (Array.isArray(v) || ArrayBuffer.isView(v)) { const n = v.length; return { array: n, head: Array.from(v).slice(0, 8).map((x) => uniformValue(x, texId)) }; }
    if (typeof v === 'object') { const o = {}; let i = 0; for (const k in v) { if (i++ > 12) break; o[k] = uniformValue(v[k], texId); } return { struct: o }; }
    return String(v);
  }
  const MAT_NUM = ['opacity', 'alphaTest', 'roughness', 'metalness', 'clearcoat', 'clearcoatRoughness', 'sheen', 'sheenRoughness', 'transmission', 'thickness', 'ior', 'reflectivity', 'iridescence', 'iridescenceIOR', 'anisotropy', 'anisotropyRotation', 'dispersion',
    'specularIntensity', 'envMapIntensity', 'emissiveIntensity', 'aoMapIntensity', 'lightMapIntensity', 'bumpScale', 'displacementScale', 'displacementBias', 'attenuationDistance', 'shininess', 'refractionRatio',
    'polygonOffsetFactor', 'polygonOffsetUnits', 'size', 'linewidth', 'alphaHash'];
  const MAT_BOOL = ['transparent', 'depthWrite', 'depthTest', 'toneMapped', 'fog', 'flatShading', 'wireframe', 'vertexColors', 'premultipliedAlpha', 'dithering', 'alphaToCoverage', 'polygonOffset', 'visible', 'colorWrite', 'forceSinglePass', 'lights', 'clipping'];
  const MAT_COLOR = ['color', 'emissive', 'sheenColor', 'specularColor', 'attenuationColor', 'specular'];
  const MAT_VEC = ['normalScale', 'clearcoatNormalScale'];
  function describeMaterial(m, texId, opts) {
    const d = { uuid: m.uuid, name: m.name || '', type: m.type, side: named('side', m.side), blending: named('blending', m.blending) };
    for (const k of MAT_COLOR) if (m[k] && m[k].isColor) d[k] = colorOut(m[k]);
    for (const k of MAT_NUM) if (typeof m[k] === 'number') d[k] = r6(m[k]);
    for (const k of MAT_BOOL) if (typeof m[k] === 'boolean') d[k] = m[k];
    for (const k of MAT_VEC) if (m[k]) d[k] = vecOut(m[k]);
    if (m.shadowSide !== null && m.shadowSide !== undefined) d.shadowSide = named('side', m.shadowSide);
    const slots = {};
    for (const k in m) { const v = m[k]; if (v && v.isTexture) slots[k] = texId(v); }
    d.textures = slots;
    if (m.defines && Object.keys(m.defines).length) d.defines = Object.assign({}, m.defines);
    if (m.userData && Object.keys(m.userData).length) d.userDataKeys = Object.keys(m.userData).slice(0, 20);
    const obc = m.onBeforeCompile; if (typeof obc === 'function') { const src = Function.prototype.toString.call(obc); if (src.length > 40) d.onBeforeCompile = { sourceLength: src.length, hash: hashStr(src) }; }
    if (m.uniforms && typeof m.uniforms === 'object') {
      const u = {}; for (const k in m.uniforms) { try { u[k] = uniformValue(m.uniforms[k] && m.uniforms[k].value, texId); } catch (_) { u[k] = '?'; } }
      d.uniforms = u;
    }
    if (typeof m.vertexShader === 'string' && (m.isShaderMaterial || m.isRawShaderMaterial)) {
      d.shader = { vertexLength: m.vertexShader.length, vertexHash: hashStr(m.vertexShader), fragmentLength: m.fragmentShader.length, fragmentHash: hashStr(m.fragmentShader), glslVersion: m.glslVersion || null };
      if (opts && opts.shaderSource) { d.shader.vertexSource = m.vertexShader; d.shader.fragmentSource = m.fragmentShader; }
    }
    return d;
  }
  function describeGeometry(g) {
    const d = { uuid: g.uuid, name: g.name || '', type: g.type, attributes: {}, index: g.index ? g.index.count : null };
    for (const k in g.attributes) { const a = g.attributes[k]; d.attributes[k] = { itemSize: a.itemSize, count: a.count, array: a.array && a.array.constructor.name, normalized: !!a.normalized, interleaved: !!a.isInterleavedBufferAttribute, instanced: !!a.isInstancedBufferAttribute }; }
    const p = g.attributes && g.attributes.position;
    d.vertexCount = p ? p.count : 0;
    d.triangleCount = Math.floor((g.index ? g.index.count : d.vertexCount) / 3);
    if (p && p.count && typeof p.getX === 'function') {
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.itemSize > 2 ? p.getZ(i) : 0; if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z; if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z; }
      d.boundingBox = { min: [x0, y0, z0].map(r6), max: [x1, y1, z1].map(r6), size: [x1 - x0, y1 - y0, z1 - z0].map(r6) };
    }
    if (g.morphAttributes && Object.keys(g.morphAttributes).length) { d.morphAttributes = {}; for (const k in g.morphAttributes) d.morphAttributes[k] = g.morphAttributes[k].length; }
    if (g.groups && g.groups.length) d.groups = g.groups.length;
    if (g.drawRange && (g.drawRange.start !== 0 || g.drawRange.count !== Infinity)) d.drawRange = { start: g.drawRange.start, count: g.drawRange.count };
    if (g.parameters) { const o = {}; for (const k in g.parameters) { const v = g.parameters[k]; if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') o[k] = v; } d.parameters = o; }
    return d;
  }
  function describeCamera(c) {
    if (!c) return null;
    c.updateMatrixWorld && 0; // read only: do not force updates
    const d = Object.assign({ uuid: c.uuid, name: c.name || '', type: c.type }, worldOf(c));
    for (const k of ['fov', 'aspect', 'near', 'far', 'zoom', 'focus', 'filmGauge', 'filmOffset', 'left', 'right', 'top', 'bottom']) if (typeof c[k] === 'number') d[k] = r6(c[k]);
    d.up = vecOut(c.up); d.localPosition = vecOut(c.position); d.localQuaternion = [c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w].map(r7);
    d.view = c.view ? Object.assign({}, c.view) : null;
    d.layersMask = c.layers ? c.layers.mask : null;
    d.projectionMatrix = arr(c.projectionMatrix.elements);
    const e = c.matrixWorld.elements; d.forward = [-e[8], -e[9], -e[10]].map(r6);
    d.parentType = c.parent ? c.parent.type : null;
    return d;
  }
  function describeLight(l) {
    const d = Object.assign({ uuid: l.uuid, name: l.name || '', type: l.type, visible: l.visible, color: colorOut(l.color), intensity: r6(l.intensity) }, worldOf(l));
    const path = []; for (let p = l.parent; p; p = p.parent) path.push((p.name || '') + '<' + p.type + '>'); d.parents = path;
    let vis = l.visible; for (let p = l.parent; p; p = p.parent) vis = vis && p.visible; d.effectivelyVisible = vis;
    if (l.target) { const e = l.target.matrixWorld.elements; d.targetPosition = [e[12], e[13], e[14]].map(r6); d.targetInScene = !!l.target.parent; }
    for (const k of ['angle', 'penumbra', 'distance', 'decay', 'power', 'width', 'height']) if (typeof l[k] === 'number') d[k] = r6(l[k]);
    if (typeof l.angle === 'number') d.angleDeg = r6(l.angle * 180 / Math.PI);
    if (l.groundColor) d.groundColor = colorOut(l.groundColor);
    if (l.map) d.hasMap = true;
    d.castShadow = !!l.castShadow; d.layersMask = l.layers ? l.layers.mask : null;
    if (l.shadow) {
      const s = l.shadow, sc = s.camera;
      d.shadow = { mapSize: vecOut(s.mapSize), bias: s.bias, normalBias: s.normalBias, radius: s.radius, blurSamples: s.blurSamples, intensity: s.intensity, autoUpdate: s.autoUpdate,
        mapAllocated: s.map ? [s.map.width, s.map.height] : null,
        camera: sc ? { type: sc.type, near: sc.near, far: sc.far, fov: sc.fov, left: sc.left, right: sc.right, top: sc.top, bottom: sc.bottom, zoom: sc.zoom } : null };
      if (typeof s.focus === 'number') d.shadow.focus = s.focus;
    }
    return d;
  }
  function describeRenderer(r) {
    const d = {};
    const gl = r.getContext && r.getContext();
    const v2 = () => ({ x: 0, y: 0, set(x, y) { this.x = x; this.y = y; return this; } });
    d.toneMapping = named('toneMapping', r.toneMapping); d.toneMappingExposure = r.toneMappingExposure; d.outputColorSpace = r.outputColorSpace;
    d.shadowMap = r.shadowMap ? { enabled: r.shadowMap.enabled, type: named('shadowType', r.shadowMap.type), typeRaw: r.shadowMap.type, autoUpdate: r.shadowMap.autoUpdate, needsUpdate: r.shadowMap.needsUpdate } : null;
    try { d.pixelRatio = r.getPixelRatio(); } catch (_) {}
    try { const s = r.getSize(v2()); d.size = [s.x, s.y]; } catch (_) {}
    try { const s = r.getDrawingBufferSize(v2()); d.drawingBufferSize = [s.x, s.y]; } catch (_) {}
    for (const k of ['sortObjects', 'autoClear', 'autoClearColor', 'autoClearDepth', 'autoClearStencil', 'localClippingEnabled', 'transmissionResolutionScale']) if (r[k] !== undefined) d[k] = r[k];
    try { const c = { r: 0, g: 0, b: 0, copy(o) { this.r = o.r; this.g = o.g; this.b = o.b; return this; } }; r.getClearColor(c); d.clearColor = [c.r, c.g, c.b].map(r6); d.clearAlpha = r.getClearAlpha(); } catch (_) {}
    const caps = {}; if (r.capabilities) for (const k in r.capabilities) { const v = r.capabilities[k]; if (typeof v !== 'function' && typeof v !== 'object') caps[k] = v; }
    try { if (r.capabilities && r.capabilities.getMaxAnisotropy) caps.maxAnisotropy = r.capabilities.getMaxAnisotropy(); } catch (_) {}
    d.capabilities = caps;
    if (r.info) d.info = { render: Object.assign({}, r.info.render), memory: Object.assign({}, r.info.memory), programs: r.info.programs ? r.info.programs.length : null, autoReset: r.info.autoReset };
    if (r.info && r.info.programs) d.programs = r.info.programs.map((p) => ({ name: p.name, type: p.type, usedTimes: p.usedTimes, cacheKeyLength: p.cacheKey ? p.cacheKey.length : 0 }));
    if (gl) {
      d.contextAttributes = gl.getContextAttributes();
      d.glVersion = gl.getParameter(gl.VERSION); d.glslVersion = gl.getParameter(gl.SHADING_LANGUAGE_VERSION);
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) { d.unmaskedVendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL); d.unmaskedRenderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL); }
      d.isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
      d.drawingBuffer = [gl.drawingBufferWidth, gl.drawingBufferHeight]; d.drawingBufferColorSpace = gl.drawingBufferColorSpace;
    }
    const c = r.domElement;
    if (c) { const b = c.getBoundingClientRect ? c.getBoundingClientRect() : null; d.canvas = { width: c.width, height: c.height, cssRect: b ? [b.x, b.y, b.width, b.height].map(r6) : null, style: c.getAttribute && c.getAttribute('style'), parentTag: c.parentElement && c.parentElement.tagName.toLowerCase(), dataEngine: c.getAttribute && c.getAttribute('data-engine') }; }
    d.xrEnabled = !!(r.xr && r.xr.enabled);
    return d;
  }
  function describeBackground(v, texId) {
    if (v === null || v === undefined) return null;
    if (v.isColor) return { color: colorOut(v) };
    if (v.isTexture) return { texture: texId(v) };
    return { other: typeof v };
  }
  function r3fState(scene) {
    try {
      const st = scene.__r3f && scene.__r3f.root && scene.__r3f.root.getState && scene.__r3f.root.getState();
      if (!st) return null;
      const out = { frameloop: st.frameloop, legacy: st.legacy, linear: st.linear, flat: st.flat };
      if (st.viewport) out.viewport = { width: r6(st.viewport.width), height: r6(st.viewport.height), dpr: st.viewport.dpr, factor: r6(st.viewport.factor), distance: r6(st.viewport.distance), aspect: r6(st.viewport.aspect), initialDpr: st.viewport.initialDpr };
      if (st.size) out.size = { width: st.size.width, height: st.size.height, top: st.size.top, left: st.size.left };
      if (st.performance) out.performance = { current: st.performance.current, min: st.performance.min, max: st.performance.max, debounce: st.performance.debounce };
      if (st.camera) out.camera = st.camera.uuid;
      if (st.raycaster) out.raycaster = { near: st.raycaster.near, far: st.raycaster.far, layersMask: st.raycaster.layers && st.raycaster.layers.mask };
      if (st.events) out.events = { enabled: st.events.enabled, priority: st.events.priority, connected: !!st.events.connected, handlers: st.events.handlers ? Object.keys(st.events.handlers) : null };
      if (st.internal) out.internal = { priority: st.internal.priority, subscribers: st.internal.subscribers ? st.internal.subscribers.length : null, interactionCount: st.internal.interaction ? st.internal.interaction.length : null, frames: st.internal.frames, active: st.internal.active };
      out.controls = st.controls ? (st.controls.constructor && st.controls.constructor.name) : null;
      out.xr = undefined;
      return out;
    } catch (err) { return { error: err.message }; }
  }
  // Event handler names r3f attached to an object (onClick, onPointerOver ...). Names only.
  function r3fHandlers(o) {
    try { const i = o.__r3f; if (!i) return null; const h = i.handlers; const n = i.eventCount; if (h && n) return Object.keys(h); return null; } catch (_) { return null; }
  }

  CAP.dumpScene = function dumpScene(opts) {
    opts = opts || {};
    const texIds = new Map(), textures = []; const matIds = new Map(), materials = []; const geoIds = new Map(), geometries = [];
    const texId = (t) => { if (!texIds.has(t)) { texIds.set(t, textures.length); textures.push(null); textures[texIds.get(t)] = Object.assign({ id: texIds.get(t) }, describeTexture(t)); } return texIds.get(t); };
    const matId = (m) => { if (!matIds.has(m)) { const id = materials.length; matIds.set(m, id); materials.push(null); materials[id] = Object.assign({ id }, describeMaterial(m, texId, opts)); } return matIds.get(m); };
    const geoId = (g) => { if (!geoIds.has(g)) { const id = geometries.length; geoIds.set(g, id); geometries.push(null); geometries[id] = Object.assign({ id }, describeGeometry(g)); } return geoIds.get(g); };
    const m = CAP.main();
    const out = { capturedAt: new Date().toISOString(), perfNow: r6(perfNow()), location: location.pathname + location.search, three: Object.assign({}, CAP.three),
      hook: { technique: '__THREE_DEVTOOLS__ observe events + renderer.render wrapper', scenesObserved: CAP.scenes.length, renderersObserved: CAP.renderers.length, otherObserved: Object.assign({}, CAP.otherObserved), notes: CAP.hookNotes.slice(), errors: CAP.errors.slice(0, 20) },
      window: { innerWidth, innerHeight, devicePixelRatio, scrollY: window.scrollY, scrollHeight: document.documentElement.scrollHeight },
      renderers: CAP.renderers.map(describeRenderer),
      renderLog: Array.from(CAP.renderLog.values()).map((r) => Object.assign({}, r)),
      frameCadence: CAP.cadence(), scenes: [] };
    for (const scene of CAP.scenes) {
      const isMain = !!(m && m.scene === scene);
      const last = CAP.lastRenderByScene.get(scene.uuid);
      const sd = { uuid: scene.uuid, name: scene.name || '', isMain, lastRenderedFrame: last ? last.frame : null, currentFrame: CAP.frame.no,
        background: describeBackground(scene.background, texId), backgroundBlurriness: scene.backgroundBlurriness, backgroundIntensity: scene.backgroundIntensity,
        backgroundRotation: scene.backgroundRotation ? [scene.backgroundRotation.x, scene.backgroundRotation.y, scene.backgroundRotation.z].map(r6) : null,
        environment: scene.environment ? { texture: texId(scene.environment) } : null, environmentIntensity: scene.environmentIntensity,
        environmentRotation: scene.environmentRotation ? [scene.environmentRotation.x, scene.environmentRotation.y, scene.environmentRotation.z].map(r6) : null,
        fog: scene.fog ? { type: scene.fog.isFogExp2 ? 'FogExp2' : 'Fog', color: colorOut(scene.fog.color), near: scene.fog.near, far: scene.fog.far, density: scene.fog.density } : null,
        overrideMaterial: scene.overrideMaterial ? matId(scene.overrideMaterial) : null,
        r3f: r3fState(scene), camera: describeCamera(last ? last.camera : null), lights: [], nodes: [], counts: {} };
      const stack = [[scene, -1, 0]]; const counts = {};
      while (stack.length) {
        const [o, parent, depth] = stack.pop();
        const idx = sd.nodes.length;
        counts[o.type] = (counts[o.type] || 0) + 1;
        const n = { i: idx, parent, depth, name: o.name || '', type: o.type, uuid: o.uuid, visible: o.visible, children: o.children.length,
          local: { position: vecOut(o.position), quaternion: [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w].map(r7), scale: vecOut(o.scale) }, world: worldOf(o) };
        if (o.castShadow) n.castShadow = true; if (o.receiveShadow) n.receiveShadow = true; if (o.renderOrder) n.renderOrder = o.renderOrder;
        if (o.frustumCulled === false) n.frustumCulled = false; if (o.matrixAutoUpdate === false) n.matrixAutoUpdate = false;
        if (o.layers && o.layers.mask !== 1) n.layersMask = o.layers.mask;
        if (o.geometry) n.geometry = geoId(o.geometry);
        if (o.material) n.material = Array.isArray(o.material) ? o.material.map(matId) : matId(o.material);
        if (o.customDepthMaterial) n.customDepthMaterial = matId(o.customDepthMaterial);
        if (o.isInstancedMesh) n.instanceCount = o.count;
        if (o.isSkinnedMesh && o.skeleton) n.bones = o.skeleton.bones.length;
        if (o.morphTargetInfluences && o.morphTargetInfluences.length) n.morphTargetInfluences = arr(o.morphTargetInfluences);
        if (o.userData) { const keys = Object.keys(o.userData); if (keys.length) { n.userData = {}; for (const k of keys.slice(0, 16)) { const v = o.userData[k]; n.userData[k] = (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') ? (typeof v === 'string' ? v.slice(0, 80) : v) : typeof v; } } }
        const h = r3fHandlers(o); if (h) n.handlers = h;
        if (o.isLight) { n.light = sd.lights.length; sd.lights.push(describeLight(o)); }
        if (o.isCamera) n.camera = describeCamera(o);
        sd.nodes.push(n);
        for (let k = o.children.length - 1; k >= 0; k--) stack.push([o.children[k], idx, depth + 1]);
      }
      sd.counts = counts;
      out.scenes.push(sd);
    }
    out.textures = textures; out.materials = materials; out.geometries = geometries;
    return out;
  };

  // ------------------------------------------------------------------ frame cadence
  CAP.cadence = function cadence() {
    const a = CAP.frame.intervals.slice().sort((x, y) => x - y); if (!a.length) return null;
    const q = (p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
    const mean = a.reduce((s, v) => s + v, 0) / a.length;
    return { frames: a.length, meanMs: r6(mean), medianMs: r6(q(0.5)), p05Ms: r6(q(0.05)), p95Ms: r6(q(0.95)), maxMs: r6(a[a.length - 1]), hz: r6(1000 / q(0.5)) };
  };

  // ------------------------------------------------------------------ sampler
  // Dense, every frame: camera drawn to screen, every light, every uuid asked for.
  // Sparse, on change only: local position/quaternion/scale/visible of every object, material scalars and
  // shader uniforms, morph influences, instance matrices. World poses of sparse objects are rebuilt offline
  // from the parent chain recorded in "objects".
  let S = null;
  const TRACK_MAT = ['opacity', 'roughness', 'metalness', 'envMapIntensity', 'emissiveIntensity', 'clearcoat', 'transmission'];
  CAP.startSampling = function startSampling(opts) {
    opts = opts || {};
    S = { on: true, opts, t0: perfNow(), frame0: CAP.frame.no, n: 0, lastFrameSampled: -1,
      raf: [], t: [], frameNo: [], rendered: [], scrollY: [],
      cam: { uuid: [], m: [], fov: [], zoom: [], p0: [], p5: [], p8: [], p9: [] },
      lights: new Map(), dense: new Map(), objs: new Map(), mats: new Map(), dom: new Map(), inst: new Map(),
      denseUuids: new Set(opts.dense || []), domProbes: opts.dom || [], maxFrames: opts.maxFrames || 3600 };
    CAP.mark('sampling-start', { label: opts.label || '' });
    return { t0: S.t0, frame0: S.frame0 };
  };
  function finishFrame() { if (S && S.on && S.lastFrameSampled !== CAP.frame.no && CAP.frame.no > S.frame0) sampleFrame(false); }
  function pushIfChanged(rec, f, vals, eps) {
    const last = rec.last; let changed = !last;
    if (last) for (let i = 0; i < vals.length; i++) { if (Math.abs(vals[i] - last[i]) > eps) { changed = true; break; } }
    if (changed) { rec.f.push(f); for (let i = 0; i < vals.length; i++) rec.v.push(vals[i]); rec.last = vals; }
    return changed;
  }
  function sampleFrame(rendered) {
    const fr = CAP.frame; const overwrite = S.lastFrameSampled === fr.no;
    if (!overwrite) { if (S.n >= S.maxFrames) { S.on = false; return; } S.n++; }
    const f = S.n - 1; S.lastFrameSampled = fr.no;
    S.raf[f] = fr.raf; S.t[f] = perfNow(); S.frameNo[f] = fr.no; S.rendered[f] = rendered ? (fr.renderedThisFrame || 1) : 0; S.scrollY[f] = window.scrollY;
    const m = CAP.main(); if (!m) return;
    const cam = m.camera;
    if (cam) {
      const e = cam.matrixWorld.elements, pe = cam.projectionMatrix.elements, c = S.cam;
      c.uuid[f] = cam.uuid; c.m[f] = Array.prototype.slice.call(e); c.fov[f] = cam.fov; c.zoom[f] = cam.zoom; c.p0[f] = pe[0]; c.p5[f] = pe[5]; c.p8[f] = pe[8]; c.p9[f] = pe[9];
    }
    // every rendered scene: objects, lights, materials
    const seenMat = S._seenMat || (S._seenMat = new Set()); seenMat.clear();
    for (const rec of CAP.lastRenderByScene.values()) {
      if (fr.no - rec.frame > 2 && rec.scene !== m.scene) continue;
      const stack = [rec.scene];
      while (stack.length) {
        const o = stack.pop(); const ch = o.children; for (let i = 0; i < ch.length; i++) stack.push(ch[i]);
        let r = S.objs.get(o.uuid);
        if (!r) { r = { name: o.name || '', type: o.type, parent: o.parent ? o.parent.uuid : null, scene: rec.scene.uuid, first: f, f: [], v: [], last: null }; S.objs.set(o.uuid, r); }
        const p = o.position, q = o.quaternion, s = o.scale;
        pushIfChanged(r, f, [p.x, p.y, p.z, q.x, q.y, q.z, q.w, s.x, s.y, s.z, o.visible ? 1 : 0], 1e-9);
        r.lastSeen = f;
        if (o.isLight) {
          let L = S.lights.get(o.uuid); if (!L) { L = { name: o.name || '', type: o.type, first: f, f: [], v: [] }; S.lights.set(o.uuid, L); }
          const e = o.matrixWorld.elements; const te = o.target ? o.target.matrixWorld.elements : null;
          L.f.push(f); L.v.push(e[12], e[13], e[14], o.intensity, o.color.r, o.color.g, o.color.b, te ? te[12] : NaN, te ? te[13] : NaN, te ? te[14] : NaN,
            typeof o.angle === 'number' ? o.angle : NaN, typeof o.penumbra === 'number' ? o.penumbra : NaN, typeof o.distance === 'number' ? o.distance : NaN, o.visible ? 1 : 0);
        }
        if (S.denseUuids.has(o.uuid)) {
          let D = S.dense.get(o.uuid); if (!D) { D = { name: o.name || '', type: o.type, first: f, f: [], m: [] }; S.dense.set(o.uuid, D); }
          D.f.push(f); D.m.push(Array.prototype.slice.call(o.matrixWorld.elements));
        }
        if (o.isInstancedMesh && o.instanceMatrix) {
          let I = S.inst.get(o.uuid); if (!I) { I = { name: o.name || '', count: o.count, f: [], v: [], last: null }; S.inst.set(o.uuid, I); }
          const a = o.instanceMatrix.array; const n = Math.min(a.length, o.count * 16); const vals = new Array(n); for (let i = 0; i < n; i++) vals[i] = a[i];
          if (pushIfChangedArr(I, f, vals)) { /* stored */ }
        }
        if (o.morphTargetInfluences && o.morphTargetInfluences.length) {
          const key = 'morph:' + o.uuid; let M = S.mats.get(key); if (!M) { M = { kind: 'morph', owner: o.uuid, name: o.name || '', keys: o.morphTargetInfluences.map((_, i) => 'influence' + i), f: [], v: [], last: null }; S.mats.set(key, M); }
          pushIfChanged(M, f, Array.prototype.slice.call(o.morphTargetInfluences), 1e-9);
        }
        const mat = o.material;
        if (mat) { if (Array.isArray(mat)) { for (let i = 0; i < mat.length; i++) trackMaterial(mat[i], o, f, seenMat); } else trackMaterial(mat, o, f, seenMat); }
      }
    }
    for (const probe of S.domProbes) {
      let D = S.dom.get(probe.name); if (!D) { D = { selector: probe.selector, props: probe.props || [], f: [], rect: [], style: [], present: [] }; S.dom.set(probe.name, D); }
      let el = null; try { el = probe.selector ? document.querySelector(probe.selector) : null; } catch (_) {}
      D.f.push(f); D.present.push(el ? 1 : 0);
      if (el) { const b = el.getBoundingClientRect(); D.rect.push([b.x, b.y, b.width, b.height]); const cs = getComputedStyle(el); D.style.push((probe.props || []).map((k) => cs.getPropertyValue(k))); }
      else { D.rect.push(null); D.style.push(null); }
    }
  }
  function pushIfChangedArr(rec, f, vals) {
    const last = rec.last; let changed = !last || last.length !== vals.length;
    if (!changed) for (let i = 0; i < vals.length; i++) if (vals[i] !== last[i]) { changed = true; break; }
    if (changed) { rec.f.push(f); rec.v.push(vals); rec.last = vals; }
    return changed;
  }
  function flatUniform(v, out) {
    if (typeof v === 'number') { out.push(v); return true; }
    if (typeof v === 'boolean') { out.push(v ? 1 : 0); return true; }
    if (!v) return false;
    if (v.isColor) { out.push(v.r, v.g, v.b); return true; }
    if (v.isVector4 || v.isQuaternion) { out.push(v.x, v.y, v.z, v.w); return true; }
    if (v.isVector3) { out.push(v.x, v.y, v.z); return true; }
    if (v.isVector2) { out.push(v.x, v.y); return true; }
    return false;
  }
  function trackMaterial(mat, owner, f, seen) {
    if (!mat || seen.has(mat.uuid)) return; seen.add(mat.uuid);
    let M = S.mats.get(mat.uuid);
    if (!M) {
      const keys = []; const getters = [];
      for (const k of TRACK_MAT) if (typeof mat[k] === 'number') { keys.push(k); getters.push(((kk) => (m, o) => o.push(m[kk]))(k)); }
      for (const k of ['color', 'emissive']) if (mat[k] && mat[k].isColor) { keys.push(k + '.r', k + '.g', k + '.b'); getters.push(((kk) => (m, o) => o.push(m[kk].r, m[kk].g, m[kk].b))(k)); }
      keys.push('visible'); getters.push((m, o) => o.push(m.visible ? 1 : 0));
      if (mat.uniforms) for (const k in mat.uniforms) {
        const u = mat.uniforms[k]; if (!u) continue; const probe = [];
        if (flatUniform(u.value, probe)) { for (let i = 0; i < probe.length; i++) keys.push('u.' + k + (probe.length > 1 ? '.' + i : '')); getters.push(((kk, n) => (m, o) => { const b = o.length; const uu = m.uniforms[kk]; if (!uu || !flatUniform(uu.value, o) || o.length - b !== n) { o.length = b; for (let i = 0; i < n; i++) o.push(NaN); } })(k, probe.length)); }
      }
      M = { kind: 'material', name: mat.name || '', type: mat.type, owner: owner.uuid, ownerName: owner.name || '', keys, getters, f: [], v: [], last: null }; S.mats.set(mat.uuid, M);
    }
    const vals = []; for (let i = 0; i < M.getters.length; i++) M.getters[i](mat, vals);
    const last = M.last; let changed = !last;
    if (last) for (let i = 0; i < vals.length; i++) { const a = vals[i], b = last[i]; if (a !== b && !(a !== a && b !== b)) { changed = true; break; } }
    if (changed) { M.f.push(f); for (let i = 0; i < vals.length; i++) M.v.push(vals[i]); M.last = vals; }
  }

  CAP.stopSampling = function stopSampling() {
    if (!S) return null;
    S.on = false; CAP.mark('sampling-stop');
    const n = S.n; const t0 = S.t[0] || S.t0;
    const out = { frames: { n, t0PerfNow: r6(t0), t: S.t.map((v) => +(v - t0).toFixed(3)), raf: S.raf.map((v) => +(v - t0).toFixed(3)), frameNo: S.frameNo, rendered: S.rendered, scrollY: S.scrollY } };
    // camera
    const cp = [], cq = [], cs = []; let camUuids = new Set();
    for (let i = 0; i < n; i++) { const m = S.cam.m[i]; if (!m) { cp.push(null); cq.push(null); continue; } const d = decompose(m); cp.push(arr(d.p)); cq.push(arr(d.q, r7)); cs.push(d.s); camUuids.add(S.cam.uuid[i]); }
    out.camera = { uuids: Array.from(camUuids), position: cp, quaternion: cq, fov: S.cam.fov.map(r6), zoom: S.cam.zoom.map(r6), proj: { p0: S.cam.p0.map(r6), p5: S.cam.p5.map(r6), p8: S.cam.p8.map(r6), p9: S.cam.p9.map(r6) } };
    // lights: keep dense, flag which channels moved
    const LK = ['x', 'y', 'z', 'intensity', 'r', 'g', 'b', 'tx', 'ty', 'tz', 'angle', 'penumbra', 'distance', 'visible'];
    out.lights = {};
    for (const [uuid, L] of S.lights) {
      const k = LK.length; const rows = L.f.length; const moved = [];
      for (let c = 0; c < k; c++) { let lo = Infinity, hi = -Infinity; for (let r = 0; r < rows; r++) { const v = L.v[r * k + c]; if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; } } if (hi - lo > 1e-6) moved.push(LK[c]); }
      const rec = { name: L.name, type: L.type, first: L.first, samples: rows, changed: moved, rest: {} };
      for (let c = 0; c < k; c++) rec.rest[LK[c]] = r6(L.v[c]);
      if (moved.length) { rec.f = L.f; rec.series = {}; for (const key of moved) { const c = LK.indexOf(key); const col = new Array(rows); for (let r = 0; r < rows; r++) col[r] = r6(L.v[r * k + c]); rec.series[key] = col; } }
      out.lights[uuid] = rec;
    }
    // dense objects
    out.dense = {};
    for (const [uuid, D] of S.dense) {
      const pos = [], quat = [], scl = [];
      for (const m of D.m) { const d = decompose(m); pos.push(arr(d.p)); quat.push(arr(d.q, r7)); scl.push(arr(d.s)); }
      out.dense[uuid] = { name: D.name, type: D.type, f: D.f, position: pos, quaternion: quat, scale: scl };
    }
    // sparse objects: keep only those that changed after their first sample (or appeared late)
    out.objects = {}; out.objectIndex = {}; let moving = 0;
    for (const [uuid, r] of S.objs) {
      const rows = r.f.length;
      out.objectIndex[uuid] = { name: r.name, type: r.type, parent: r.parent, first: r.first, lastSeen: r.lastSeen, changes: rows - 1 };
      if (rows > 1 || r.first > 0 || r.lastSeen < n - 1) {
        moving++;
        const v = new Array(rows); for (let i = 0; i < rows; i++) { const row = r.v.slice(i * 11, i * 11 + 11); v[i] = [r6(row[0]), r6(row[1]), r6(row[2]), r7(row[3]), r7(row[4]), r7(row[5]), r7(row[6]), r6(row[7]), r6(row[8]), r6(row[9]), row[10]]; }
        out.objects[uuid] = { name: r.name, type: r.type, parent: r.parent, first: r.first, lastSeen: r.lastSeen, f: r.f, cols: ['px', 'py', 'pz', 'qx', 'qy', 'qz', 'qw', 'sx', 'sy', 'sz', 'visible'], v };
      }
    }
    out.objectsTotal = S.objs.size; out.objectsChanged = moving;
    // materials, uniforms, morphs
    out.materials = {};
    for (const [key, M] of S.mats) {
      const k = M.keys.length; const rows = M.f.length; if (rows <= 1 || !k) continue;
      const moved = []; for (let c = 0; c < k; c++) { let lo = Infinity, hi = -Infinity; for (let r = 0; r < rows; r++) { const v = M.v[r * k + c]; if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; } } if (hi - lo > 1e-9) moved.push(c); }
      if (!moved.length) continue;
      const rec = { kind: M.kind, name: M.name, type: M.type, owner: M.owner, ownerName: M.ownerName, f: M.f, series: {} };
      for (const c of moved) { const col = new Array(rows); for (let r = 0; r < rows; r++) col[r] = r6(M.v[r * k + c]); rec.series[M.keys[c]] = col; }
      out.materials[key] = rec;
    }
    out.instanced = {};
    for (const [uuid, I] of S.inst) if (I.f.length > 1) out.instanced[uuid] = { name: I.name, count: I.count, f: I.f, matrices: I.v.map((a) => a.map(r6)) };
    out.dom = {};
    for (const [name, D] of S.dom) out.dom[name] = { selector: D.selector, props: D.props, f: D.f, present: D.present, rect: D.rect.map((b) => (b ? b.map((v) => Math.round(v * 100) / 100) : null)), style: D.style };
    out.events = CAP.events.filter((e) => e.t >= S.t0 - 50).map((e) => Object.assign({}, e, { t: +(e.t - t0).toFixed(3) }));
    out.cadence = (() => { const d = []; for (let i = 1; i < n; i++) d.push(S.raf[i] - S.raf[i - 1]); d.sort((a, b) => a - b); if (!d.length) return null; const q = (p) => d[Math.min(d.length - 1, Math.floor(p * d.length))]; return { frames: n, medianMs: r6(q(0.5)), p05Ms: r6(q(0.05)), p95Ms: r6(q(0.95)), maxMs: r6(d[d.length - 1]), meanMs: r6(d.reduce((s, v) => s + v, 0) / d.length), rendered: S.rendered.filter((v) => v > 0).length }; })();
    S = null;
    return out;
  };
  CAP.samplingFrames = () => (S ? S.n : 0);

  // ------------------------------------------------------------------ small helpers used by the runner
  // Find objects by predicate description without exposing three objects across the bridge.
  CAP.find = function find(q) {
    q = q || {}; const m = CAP.main(); if (!m) return [];
    const re = q.name ? new RegExp(q.name) : null; const out = []; const stack = [m.scene];
    while (stack.length) { const o = stack.pop(); for (const c of o.children) stack.push(c);
      if (re && !re.test(o.name || '')) continue; if (q.type && o.type !== q.type) continue; if (q.uuid && o.uuid !== q.uuid) continue;
      out.push({ uuid: o.uuid, name: o.name, type: o.type, world: worldOf(o), visible: o.visible }); }
    return out;
  };
  // Project a world position (or an object's world origin) to CSS pixels with the main camera.
  CAP.project = function project(target) {
    const m = CAP.main(); if (!m || !m.camera) return null;
    let p = target;
    if (typeof target === 'string') { let found = null; const stack = [m.scene]; while (stack.length) { const o = stack.pop(); if (o.uuid === target) { found = o; break; } for (const c of o.children) stack.push(c); } if (!found) return null; const e = found.matrixWorld.elements; p = [e[12], e[13], e[14]]; }
    const cam = m.camera; const vi = cam.matrixWorldInverse.elements, pr = cam.projectionMatrix.elements;
    const mul = (e, v) => [e[0] * v[0] + e[4] * v[1] + e[8] * v[2] + e[12] * v[3], e[1] * v[0] + e[5] * v[1] + e[9] * v[2] + e[13] * v[3], e[2] * v[0] + e[6] * v[1] + e[10] * v[2] + e[14] * v[3], e[3] * v[0] + e[7] * v[1] + e[11] * v[2] + e[15] * v[3]];
    const v = mul(vi, [p[0], p[1], p[2], 1]); const c = mul(pr, v); if (!c[3]) return null;
    const ndc = [c[0] / c[3], c[1] / c[3], c[2] / c[3]];
    const canvas = m.renderer && m.renderer.domElement; const b = canvas ? canvas.getBoundingClientRect() : { x: 0, y: 0, width: innerWidth, height: innerHeight };
    return { x: r6(b.x + (ndc[0] * 0.5 + 0.5) * b.width), y: r6(b.y + (1 - (ndc[1] * 0.5 + 0.5)) * b.height), ndc: ndc.map(r6), viewZ: r6(v[2]), behind: c[3] < 0 };
  };
  // Screen-space box of an object's subtree (all mesh bounding boxes projected), in CSS pixels.
  CAP.screenBox = function screenBox(uuid) {
    const m = CAP.main(); if (!m || !m.camera) return null;
    let root = null; const st = [m.scene]; while (st.length) { const o = st.pop(); if (o.uuid === uuid) { root = o; break; } for (const c of o.children) st.push(c); }
    if (!root) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, any = false; const stack = [root];
    while (stack.length) {
      const o = stack.pop(); for (const c of o.children) stack.push(c);
      const g = o.geometry; if (!g || !g.attributes || !g.attributes.position || o.visible === false) continue;
      const bb = g.boundingBox; let mn, mx;
      if (bb) { mn = [bb.min.x, bb.min.y, bb.min.z]; mx = [bb.max.x, bb.max.y, bb.max.z]; } else { const d = describeGeometry(g).boundingBox; if (!d) continue; mn = d.min; mx = d.max; }
      const e = o.matrixWorld.elements;
      for (let i = 0; i < 8; i++) { const lx = i & 1 ? mx[0] : mn[0], ly = i & 2 ? mx[1] : mn[1], lz = i & 4 ? mx[2] : mn[2];
        const w = [e[0] * lx + e[4] * ly + e[8] * lz + e[12], e[1] * lx + e[5] * ly + e[9] * lz + e[13], e[2] * lx + e[6] * ly + e[10] * lz + e[14]];
        const p = CAP.project(w); if (!p || p.behind) continue; any = true; if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y; if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y; }
    }
    return any ? { x: r6(x0), y: r6(y0), width: r6(x1 - x0), height: r6(y1 - y0), cx: r6((x0 + x1) / 2), cy: r6((y0 + y1) / 2) } : null;
  };
  // Repeated items (books on a shelf): subtrees that share the most-reused geometry.
  CAP.items = function items() {
    const m = CAP.main(); if (!m) return [];
    const byGeo = new Map(); const stack = [m.scene];
    while (stack.length) { const o = stack.pop(); for (const c of o.children) stack.push(c); if (o.geometry && o.isMesh) { const a = byGeo.get(o.geometry.uuid) || []; a.push(o); byGeo.set(o.geometry.uuid, a); } }
    let best = null; for (const a of byGeo.values()) if (!best || a.length > best.length || (a.length === best.length && (a[0].geometry.attributes.position ? a[0].geometry.attributes.position.count : 0) > (best[0].geometry.attributes.position ? best[0].geometry.attributes.position.count : 0))) best = a;
    if (!best || best.length < 2) return [];
    const set = new Set(best);
    const containsCount = (o) => { let n = 0; const st = [o]; while (st.length) { const x = st.pop(); if (set.has(x)) n++; for (const c of x.children) st.push(c); } return n; };
    const roots = [];
    for (const mesh of best) { let root = mesh; while (root.parent && containsCount(root.parent) === 1) root = root.parent; if (!roots.includes(root)) roots.push(root); }
    return roots.map((o, i) => ({ index: i, uuid: o.uuid, name: o.name, type: o.type, world: worldOf(o), visible: o.visible, parent: o.parent ? o.parent.uuid : null, descendants: countObjects(o) - 1 }));
  };
})();
