// Virtual clock for frame-stepped capture. Injected with page.addInitScript BEFORE hook.js and before any
// page script. Plain browser JS.
//
// Two states:
//   running (default): time passes as usual. requestAnimationFrame, performance.now, Date.now and timers
//                      behave like the native ones, shifted by a constant offset after a thaw.
//   frozen:            time stands still. __VCLOCK__.step(dt) advances it by exactly dt milliseconds, fires the
//                      timers that came due, then runs one animation frame. Nothing animates between steps.
//
// CSS transitions, CSS animations and Web Animations run on the document timeline, which a script cannot
// replace. While frozen they are paused and their currentTime is driven from the virtual clock instead.
//
// Not virtualised: network and decode latency (assets arrive in real time, so "between" virtual frames),
// `new Date()` without arguments, event.timeStamp, <video> playback, workers.
(() => {
  'use strict';
  if (window.__VCLOCK__ || window.top !== window) return;
  const perf = window.performance;
  const native = {
    raf: window.requestAnimationFrame.bind(window), caf: window.cancelAnimationFrame.bind(window),
    perfNow: perf.now.bind(perf), dateNow: Date.now.bind(Date),
    setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window),
    setInterval: window.setInterval.bind(window), clearInterval: window.clearInterval.bind(window),
  };
  const dateDelta = native.dateNow() - native.perfNow();
  const V = { frozen: false, offset: 0, vnow: 0, frames: 0, steps: 0, native, errors: [], animSeen: 0, timersFired: 0 };
  Object.defineProperty(window, '__VCLOCK__', { value: V, enumerable: false });

  const now = () => (V.frozen ? V.vnow : native.perfNow() + V.offset);
  V.now = now;
  try { Object.defineProperty(perf, 'now', { value: () => now(), configurable: true, writable: true }); } catch (e) { V.errors.push('perf.now: ' + e.message); }
  try { Date.now = () => Math.floor(now() + dateDelta); } catch (e) { V.errors.push('Date.now: ' + e.message); }
  const report = (e) => { try { native.setTimeout(() => { throw e; }, 0); } catch (_) {} };

  // ---------------------------------------------------------------- requestAnimationFrame
  let nextRaf = 1; let queue = new Map(); let pump = 0;
  const runFrame = (ts) => {
    const batch = queue; queue = new Map(); V.frames++;
    for (const cb of batch.values()) { try { cb(ts); } catch (e) { report(e); } }
  };
  const ensurePump = () => { if (pump || V.frozen) return; pump = native.raf((ts) => { pump = 0; if (V.frozen) return; runFrame(ts + V.offset); }); };
  window.requestAnimationFrame = function requestAnimationFrame(cb) { const id = nextRaf++; queue.set(id, cb); ensurePump(); return id; };
  window.cancelAnimationFrame = function cancelAnimationFrame(id) { queue.delete(id); };

  // ---------------------------------------------------------------- timers
  let nextTimer = 1; const timers = new Map();
  const arm = (id, t) => { t.h = native.setTimeout(() => fire(id), Math.max(0, t.due - now())); };
  const call = (t) => { try { if (typeof t.cb === 'function') t.cb.apply(window, t.args); else (0, window.eval)(String(t.cb)); } catch (e) { report(e); } };
  function fire(id) {
    const t = timers.get(id); if (!t) return; t.h = 0;
    if (V.frozen && !t.immediate) return;                 // came due natively after a freeze: step() will handle it
    if (t.interval === null) timers.delete(id); else { t.due = Math.max(t.due + t.interval, now()); if (!V.frozen) arm(id, t); }
    V.timersFired++; call(t);
  }
  const add = (cb, delay, args, repeat) => {
    const id = nextTimer++; const d = Math.max(0, Number(delay) || 0);
    const t = { cb, args, due: now() + d, interval: repeat ? Math.max(d, 1) : null, h: 0, immediate: !repeat && d < 1 };
    timers.set(id, t);
    if (!V.frozen || t.immediate) arm(id, t);            // zero-delay timers never wait for virtual time
    return id;
  };
  window.setTimeout = function setTimeout(cb, delay, ...args) { return add(cb, delay, args, false); };
  window.setInterval = function setInterval(cb, delay, ...args) { return add(cb, delay, args, true); };
  window.clearTimeout = window.clearInterval = function clearTimer(id) { const t = timers.get(id); if (t) { if (t.h) native.clearTimeout(t.h); timers.delete(id); } };
  const runTimers = (until) => {
    for (let guard = 0; guard < 10000; guard++) {
      let best = null, bestId = 0;
      for (const [id, t] of timers) if (!t.immediate && t.due <= until && (!best || t.due < best.due)) { best = t; bestId = id; }
      if (!best) break;
      V.vnow = Math.max(V.vnow, best.due);
      if (best.interval === null) timers.delete(bestId); else best.due += best.interval;
      V.timersFired++; call(best);
    }
  };

  // ---------------------------------------------------------------- CSS / Web Animations while frozen
  const anim = new WeakMap();
  const adopt = (a, startedAt) => { try { a.pause(); } catch (_) {} anim.set(a, { at: startedAt }); V.animSeen++; };
  const scanNew = () => { let list = []; try { list = document.getAnimations(); } catch (_) {} for (const a of list) if (!anim.has(a)) { try { a.currentTime = 0; } catch (_) {} adopt(a, V.vnow); } return list; };
  const driveAnimations = () => {
    for (const a of scanNew()) {
      const rec = anim.get(a); const t = V.vnow - rec.at; let end = Infinity;
      try { end = a.effect ? a.effect.getComputedTiming().endTime : Infinity; } catch (_) {}
      try { if (t >= end) a.finish(); else a.currentTime = t; } catch (_) {}
    }
  };

  // ---------------------------------------------------------------- control
  V.freeze = function freeze() {
    if (V.frozen) return V.vnow;
    V.vnow = native.perfNow() + V.offset; V.frozen = true;
    for (const t of timers.values()) if (t.h && !t.immediate) { native.clearTimeout(t.h); t.h = 0; }
    let list = []; try { list = document.getAnimations(); } catch (_) {}
    for (const a of list) if (!anim.has(a)) adopt(a, V.vnow - (Number(a.currentTime) || 0));   // keep the progress they had
    return V.vnow;
  };
  V.thaw = function thaw() {
    if (!V.frozen) return now();
    V.offset = V.vnow - native.perfNow(); V.frozen = false;
    for (const [id, t] of timers) if (!t.h) arm(id, t);
    let list = []; try { list = document.getAnimations(); } catch (_) {}
    for (const a of list) { try { if (a.playState === 'paused') a.play(); } catch (_) {} }
    if (queue.size) ensurePump();
    return now();
  };
  // One virtual frame, synchronously.
  V.step = function step(dtMs) {
    if (!V.frozen) throw new Error('step() while not frozen');
    scanNew();                                // animations started by input since the last step begin now
    const target = V.vnow + dtMs;
    runTimers(target); V.vnow = target;
    runFrame(V.vnow);
    driveAnimations();
    V.steps++;
    return V.vnow;
  };
  // One virtual frame, drawn inside a real animation frame so the compositor presents it; resolves one real
  // frame later, when a screenshot shows exactly this state.
  V.stepAsync = function stepAsync(dtMs) {
    return new Promise((resolve, reject) => native.raf(() => { let t; try { t = V.step(dtMs); } catch (e) { return reject(e); } native.raf(() => resolve(t)); }));
  };
  V.state = () => ({ frozen: V.frozen, vnow: V.vnow, offset: V.offset, frames: V.frames, steps: V.steps, pendingRaf: queue.size, timers: timers.size, timersFired: V.timersFired, animSeen: V.animSeen, errors: V.errors.slice(0, 10) });
})();
