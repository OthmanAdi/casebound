/**
 * Reading by touch (SPEC S-RD-16). The fingers zoom and pan the open book; the rules are in `touch.ts`.
 *
 * On a narrow screen one page side is in view at a time and fills the width, the left one first. A finger on the
 * book waits until it has moved 8 px: a sideways pull at the end of the pan takes the page under it and turns it,
 * anything else pans, and the pan comes to rest on the side the finger carried it toward. A finger lifted before
 * that is a tap, and a tap turns a page as it does with a mouse. Two fingers zoom about the place between them.
 * On a wide touch screen the book is not fitted: a finger pulls pages as a mouse does, and one that rests on a page
 * for 0.3 s pans it instead.
 *
 * It takes touches before the reader sees them and leads the reader's hand itself (`Reader.hand`), and it puts the
 * zoom and the pan in `Reader.view`.
 */
import type { Engine } from '../index';
import { clamp, lerp, smoothstep } from '../core/math';
import { tunable } from '../core/tune';
import type { Reader } from './reader';
import { TOUCH_DEFAULT, boxBounds, edgesFree, fitZoom, phoneBounds, pickSide, pinch, rubber, springStep, trackSpeed, zoomLimits, type Bounds, type PinchStart, type ReadArea, type ReadFrame, type TouchTuning } from './touch';

export type TouchMode = 'idle' | 'pending' | 'page' | 'pan' | 'pinch';

export interface TouchReadingOptions {
  /** One page side at a time, fitted to the width. Default: the compact layout tier, narrower than 900 px. */
  phone?: () => boolean;
  /** The room the page may fill, in window pixels. Default: `areaTop` below the top of the window, `areaGap` above its foot. */
  area?: () => { top: number; bottom: number };
  /** The pages of the spread in view. Default both; a zine closed on its back has one. */
  sides?: () => { left: boolean; right: boolean };
  /** While true the fingers are left alone: a tool such as the lens or a pen has them. */
  paused?: () => boolean;
  /** A tap taken by someone else: return true and the page does not turn. */
  onTap?: (x: number, y: number) => boolean;
  /** A touch that starts in an element matching this selector is left alone. */
  ignore?: string;
}

export interface TouchReading {
  /** What the fingers are doing. */
  readonly mode: TouchMode;
  /** The side of the spread in view on a narrow screen. */
  readonly side: 'left' | 'right';
  /** Back to one page to the width, the left one, no pinch remembered. */
  reset(): void;
  dispose(): void;
}

export function createTouchReading(engine: Engine, reader: Reader, opts: TouchReadingOptions = {}): TouchReading {
  const { ctx } = engine;
  const t: TouchTuning = tunable(ctx.registry, {
    id: 'reader.touch',
    label: 'Reading by touch',
    kind: 'interaction',
    tags: ['interaction', 'book'],
    describe: 'Fingers on the open book: one page side to the width on a narrow screen, a pan between the sides, a pull at the end of the pan that turns the page, a pinch, and a rubber band that springs back.',
    source: 'src/engine/reader/touch.ts',
    params: {
      zoomMin: { value: TOUCH_DEFAULT.zoomMin, min: 0.1, max: 1, help: 'Smallest zoom. Measured: 0.5' },
      zoomMax: { value: TOUCH_DEFAULT.zoomMax, min: 1, max: 8, help: 'Largest zoom. Measured: 2' },
      zoomFit: { value: TOUCH_DEFAULT.zoomFit, min: 1, max: 6, help: 'On a narrow screen the largest zoom is at least this many times the one that fits a page. Measured: 2' },
      zoomRubber: { value: TOUCH_DEFAULT.zoomRubber, min: 0, max: 1, help: 'Share of a pinch past the limits that still zooms. Measured: 0.35' },
      panRubber: { value: TOUCH_DEFAULT.panRubber, min: 0, max: 1, help: 'Share of a pan past the limits that still moves the book. Measured: 0.28' },
      slop: { value: TOUCH_DEFAULT.slop, min: 0, max: 40, unit: 'px', help: 'Travel before a finger pans or pulls a page; less is a tap. Measured: 8' },
      edge: { value: TOUCH_DEFAULT.edge, min: 0, max: 40, unit: 'px', help: 'Distance from the end of the pan that still counts as its end. Measured: 6' },
      hold: { value: TOUCH_DEFAULT.hold, min: 0.05, max: 2, unit: 's', help: 'On a wide screen: a finger at rest on a page this long pans instead. Measured: 0.3' },
      fit: { value: TOUCH_DEFAULT.fit, min: 0.3, max: 1, help: 'Share of the width one page fills on a narrow screen. Measured: 0.96' },
      fitCap: { value: TOUCH_DEFAULT.fitCap, min: 1, max: 8, help: 'Largest zoom that fitting a page may take. Measured: 3' },
      lookahead: { value: TOUCH_DEFAULT.lookahead, min: 0, max: 1, unit: 's', help: 'Seconds of the finger speed added to the pan when a side is chosen. Measured: 0.18' },
      spreadSlack: { value: TOUCH_DEFAULT.spreadSlack, min: 1, max: 2, help: 'A spread narrower than the window times this is centred whole. Measured: 1.1' },
      stiffness: { value: TOUCH_DEFAULT.stiffness, min: 1, max: 1000, help: 'Stiffness of the spring that brings zoom and pan back. Measured: 140' },
      damping: { value: TOUCH_DEFAULT.damping, min: 0.05, max: 2, help: 'Its damping as a share of the critical one. Measured: 0.75' },
      areaTop: { value: TOUCH_DEFAULT.areaTop, min: 0, max: 400, unit: 'px', help: 'Top of the room a page may fill, from the top of the window. Measured: 88' },
      areaGap: { value: TOUCH_DEFAULT.areaGap, min: 0, max: 200, unit: 'px', help: 'Gap between the room and the bar below it. Measured: 24' },
      ramp: { value: TOUCH_DEFAULT.ramp, min: 0, max: 2, unit: 's', help: 'Time in which an opening book reaches its first page side. Measured: 0.25' },
      onscreen: { value: TOUCH_DEFAULT.onscreen, min: 0, max: 1, help: 'On a wide screen: share of the book that stays in the window. Measured: 0.25' },
    },
    onChange: () => ctx.invalidate(),
  });
  const ignore = opts.ignore ?? 'button, a, input, select, textarea, label, aside, header, footer, nav, [role="toolbar"], [role="dialog"]';
  const isPhone = (): boolean => opts.phone?.() ?? ctx.compact;
  const view = reader.view;

  let mode: TouchMode = 'idle';
  let side: 'left' | 'right' = 'left';
  /** Zoom and pan the fingers aim for, before the rubber band. The view springs toward them. */
  let zoomGoal = 1;
  const pan = { x: 0, y: 0 };
  /** The zoom follows the fit until the fingers set one. */
  let fitting = true;
  let settled = false;
  let fit: number | null = null;
  /** While a book opens: zoom and pan move from where they were to the first page side in `ramp` seconds. */
  let ramp: { from: { zoom: number; x: number; y: number }; elapsed: number } | null = null;
  let armed = false;
  const speed = { zoom: 0, x: 0, y: 0 };
  /** The fingers' speed, pixels (and zoom) a second. */
  const finger = { x: 0, y: 0, zoom: 0, ms: 0, lastX: 0, lastY: 0, lastZoom: 1 };
  const touches = new Map<number, { x: number; y: number }>();
  let press = { x: 0, y: 0, id: -1 };
  let last = { x: 0, y: 0 };
  let panFrom = { px: 0, py: 0, x: 0, y: 0 };
  let pinchFrom: PinchStart | null = null;
  let hold = 0;
  let wasOpen = false;
  let wasPhone = isPhone();
  let touchAction: string | null = null;

  const area = (): ReadArea => {
    const a = opts.area?.();
    return { width: ctx.size.x, top: a?.top ?? t.areaTop, bottom: (a?.bottom ?? ctx.size.y) - t.areaGap };
  };
  const sides = (): { left: boolean; right: boolean } => opts.sides?.() ?? { left: true, right: true };
  const limits = (): { lo: number; hi: number } => zoomLimits(fit, isPhone(), t);
  /** The limits of the pan at a zoom, with whether the sides snap. */
  const boundsAt = (frame: ReadFrame, zoom: number): { bounds: Bounds; snap: boolean } => {
    if (isPhone()) return phoneBounds(frame, area(), zoom, sides(), t);
    const w = frame.pageW * zoom;
    const h = frame.pageH * zoom;
    return { bounds: boxBounds({ left: frame.x - w, top: frame.y - h / 2, width: 2 * w, height: h }, { width: ctx.size.x, height: ctx.size.y }, t), snap: false };
  };

  const resetFinger = (ms: number, x: number, y: number): void => {
    Object.assign(finger, { x: 0, y: 0, zoom: 0, ms, lastX: x, lastY: y, lastZoom: zoomGoal });
  };
  const trackFinger = (x: number, y: number, ms: number, zoom: number | null): void => {
    const dt = ms - finger.ms;
    if (finger.ms > 0) {
      finger.x = trackSpeed(finger.x, finger.lastX, x, dt);
      finger.y = trackSpeed(finger.y, finger.lastY, y, dt);
      if (zoom !== null) finger.zoom = trackSpeed(finger.zoom, finger.lastZoom, zoom, dt);
    }
    finger.ms = ms;
    finger.lastX = x;
    finger.lastY = y;
    if (zoom !== null) finger.lastZoom = zoom;
  };

  /** While the fingers hold the book: the view is where they put it, with the rubber band past the limits. */
  const follow = (): void => {
    const frame = reader.frame();
    const lim = limits();
    view.zoom = rubber(zoomGoal, lim.lo, lim.hi, t.zoomRubber);
    if (frame) {
      const { bounds } = boundsAt(frame, view.zoom);
      view.x = rubber(pan.x, bounds.minX, bounds.maxX, t.panRubber);
      view.y = rubber(pan.y, bounds.minY, bounds.maxY, t.panRubber);
    } else {
      view.x = pan.x;
      view.y = pan.y;
    }
    ctx.invalidate();
  };

  /** The fingers let go: the goals come back inside the limits, the side is chosen, and the spring takes over with the fingers' speed. */
  const release = (): void => {
    const lim = limits();
    zoomGoal = clamp(zoomGoal, lim.lo, lim.hi);
    const frame = reader.frame();
    if (frame) {
      const at = boundsAt(frame, zoomGoal);
      if (isPhone() && at.bounds.maxX - at.bounds.minX >= 1) side = pickSide(view.x, finger.x, at.bounds, at.snap, t);
      pan.x = clamp(pan.x, at.bounds.minX, at.bounds.maxX);
      pan.y = clamp(pan.y, at.bounds.minY, at.bounds.maxY);
    }
    settled = false;
    speed.x = finger.x;
    speed.y = finger.y;
    speed.zoom = finger.zoom;
    ctx.invalidate();
  };

  /** The goals start from what is shown. */
  const fromView = (): void => {
    zoomGoal = view.zoom;
    pan.x = view.x;
    pan.y = view.y;
  };

  const startPan = (x: number, y: number, ms: number): void => {
    fromView();
    mode = 'pan';
    panFrom = { px: x, py: y, x: pan.x, y: pan.y };
    resetFinger(ms, x, y);
  };

  const startPinch = (ms: number): void => {
    const [a, b] = [...touches.values()];
    if (!a || !b) return;
    if (mode !== 'pan' && mode !== 'pinch') fromView();
    fitting = false;
    mode = 'pinch';
    pinchFrom = { zoom: zoomGoal, panX: pan.x, panY: pan.y, dist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    resetFinger(ms, pinchFrom.cx, pinchFrom.cy);
  };

  const stopHold = (): void => {
    if (hold) clearTimeout(hold);
    hold = 0;
  };

  /** Lets go of a page in the hand, back where it came from. */
  const dropPage = (): void => {
    if (mode === 'page') reader.hand.up(last.x, last.y, press.id, true);
  };

  /** True where the open book is under a point of the window, as it is shown. */
  const onBook = (x: number, y: number): boolean => {
    const frame = reader.frame();
    if (!frame) return false;
    const w = frame.pageW * view.zoom;
    const h = frame.pageH * view.zoom;
    const cx = frame.x + view.x;
    const cy = frame.y + view.y;
    return x >= cx - w && x <= cx + w && y >= cy - h / 2 && y <= cy + h / 2;
  };

  const live = (): boolean => reader.isOpen && !!reader.book && !reader.handsOff && !(opts.paused?.() ?? false);

  const onDown = (ev: PointerEvent): void => {
    if (ev.pointerType !== 'touch' || !live()) return;
    if (ev.target instanceof Element && ev.target.closest(ignore)) return;
    if (touches.size === 0 && !onBook(ev.clientX, ev.clientY)) return;
    touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    ev.stopPropagation();
    if (touches.size >= 2) {
      stopHold();
      dropPage();
      startPinch(ev.timeStamp);
      return;
    }
    press = { x: ev.clientX, y: ev.clientY, id: ev.pointerId };
    last = { x: ev.clientX, y: ev.clientY };
    stopHold();
    resetFinger(ev.timeStamp, ev.clientX, ev.clientY);
    if (isPhone()) {
      mode = 'pending';
      return;
    }
    // A wide screen: the page is in the hand at once, and a finger that rests on it pans instead.
    mode = 'page';
    reader.hand.down(ev.clientX, ev.clientY, ev.pointerId);
    hold = window.setTimeout(() => {
      hold = 0;
      if (mode !== 'page' || Math.hypot(last.x - press.x, last.y - press.y) >= t.slop) return;
      dropPage();
      startPan(last.x, last.y, performance.now());
    }, t.hold * 1000);
  };

  const onMove = (ev: PointerEvent): void => {
    if (!touches.has(ev.pointerId)) return;
    touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    ev.stopPropagation();
    if (touches.size >= 2) {
      if (mode !== 'pinch') {
        stopHold();
        dropPage();
        startPinch(ev.timeStamp);
        return;
      }
      const [a, b] = [...touches.values()];
      const frame = reader.frame();
      if (!a || !b || !pinchFrom || !frame) return;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const got = pinch(pinchFrom, Math.hypot(b.x - a.x, b.y - a.y), cx, cy, frame, limits(), t);
      zoomGoal = got.zoom;
      pan.x = got.panX;
      pan.y = got.panY;
      follow();
      trackFinger(cx, cy, ev.timeStamp, zoomGoal);
      return;
    }
    if (ev.pointerId !== press.id || (mode !== 'pending' && mode !== 'page' && mode !== 'pan')) return;
    last = { x: ev.clientX, y: ev.clientY };
    trackFinger(ev.clientX, ev.clientY, ev.timeStamp, null);
    if (mode === 'pending') {
      const dx = ev.clientX - press.x;
      const dy = ev.clientY - press.y;
      if (Math.hypot(dx, dy) < t.slop) return;
      if (Math.abs(dx) >= Math.abs(dy)) {
        // Sideways at the end of the pan: the page on that side is taken from where the finger first touched.
        const frame = reader.frame();
        const lim = limits();
        const at = frame ? boundsAt(frame, clamp(zoomGoal, lim.lo, lim.hi)) : null;
        const free = edgesFree(view.x, at?.bounds ?? null, at?.snap ?? false, side, t);
        const half = dx > 0 ? (free.left ? -1 : 0) : free.right ? 1 : 0;
        if (half && reader.hand.down(press.x, press.y, press.id, half)) {
          mode = 'page';
          reader.hand.move(ev.clientX, ev.clientY, press.id);
          return;
        }
      }
      startPan(ev.clientX, ev.clientY, ev.timeStamp);
      return;
    }
    if (mode === 'page') {
      reader.hand.move(ev.clientX, ev.clientY, press.id);
      return;
    }
    pan.x = panFrom.x + (ev.clientX - panFrom.px);
    pan.y = panFrom.y + (ev.clientY - panFrom.py);
    follow();
  };

  const onUp = (ev: PointerEvent): void => {
    if (!touches.has(ev.pointerId)) return;
    touches.delete(ev.pointerId);
    ev.stopPropagation();
    const cancel = ev.type === 'pointercancel';
    if (mode === 'pinch') {
      if (touches.size >= 2) startPinch(ev.timeStamp);
      else {
        // One finger may stay down; it does nothing until it is lifted too.
        mode = 'idle';
        release();
      }
      return;
    }
    if (touches.size > 0 || ev.pointerId !== press.id) return;
    const was = mode;
    mode = 'idle';
    stopHold();
    if (was === 'pending' && !cancel) {
      if (opts.onTap?.(press.x, press.y)) return;
      // A tap turns a page, as a click does.
      reader.hand.down(press.x, press.y, press.id);
      reader.hand.up(press.x, press.y, press.id);
    } else if (was === 'page') reader.hand.up(ev.clientX, ev.clientY, press.id, cancel);
    else if (was === 'pan') release();
  };

  /** Back to the start: one page to the width, the left one. */
  const reset = (): void => {
    stopHold();
    mode = 'idle';
    side = 'left';
    zoomGoal = 1;
    pan.x = pan.y = 0;
    view.zoom = 1;
    view.x = view.y = 0;
    speed.zoom = speed.x = speed.y = 0;
    fitting = true;
    settled = false;
    fit = null;
    ramp = null;
    touches.clear();
  };

  const unsub = ctx.onFrame('layout', (f) => {
    const open = reader.isOpen && !!reader.book;
    if (open !== wasOpen) {
      wasOpen = open;
      if (open) {
        reset();
        armed = true;
      }
      // The browser keeps its hands off the open book: every touch on it is ours.
      if (open && touchAction === null) {
        touchAction = document.documentElement.style.touchAction;
        document.documentElement.style.touchAction = 'none';
      } else if (!open && touchAction !== null) {
        document.documentElement.style.touchAction = touchAction;
        touchAction = null;
      }
    }
    // Closed: the zoom and the pan go with the opening, and are put back once the book is gone.
    if (!open) {
      if (reader.openness <= 1e-4 && (view.zoom !== 1 || view.x !== 0 || view.y !== 0)) reset();
      return;
    }
    const phone = isPhone();
    if (phone !== wasPhone) {
      wasPhone = phone;
      reset();
    }
    if (mode === 'pan' || mode === 'pinch') {
      speed.zoom = speed.x = speed.y = 0;
      return;
    }
    const frame = reader.frame();
    if (!frame) return;
    const lim = limits();
    let zoom: number;
    let x = pan.x;
    let y = pan.y;
    if (phone) {
      fit = fitZoom(frame, area(), t);
      if (fitting) zoomGoal = fit;
      zoom = clamp(zoomGoal, lim.lo, lim.hi);
      const at = boundsAt(frame, zoom);
      x = at.snap ? (side === 'left' ? at.bounds.maxX : at.bounds.minX) : clamp(x, at.bounds.minX, at.bounds.maxX);
      if (!settled) y = clamp(y, at.bounds.minY, at.bounds.maxY);
      pan.x = x;
      pan.y = y;
      // An opening book: from where the view was to the first side, in `ramp` seconds, eased.
      if (armed) {
        armed = false;
        if (reader.openness < 0.999 && !f.still) ramp = { from: { zoom: view.zoom, x: view.x, y: view.y }, elapsed: 0 };
      }
      if (ramp) {
        ramp.elapsed += f.dt;
        const k = smoothstep(0, 1, ramp.elapsed / Math.max(1e-3, t.ramp));
        if (k >= 1 && reader.openness >= 0.999) ramp = null;
        else {
          view.zoom = lerp(ramp.from.zoom, zoom, k);
          view.x = lerp(ramp.from.x, x, k);
          view.y = lerp(ramp.from.y, y, k);
          settled = false;
          ctx.invalidate();
          return;
        }
      }
    } else {
      armed = false;
      zoom = clamp(zoomGoal, lim.lo, lim.hi);
      const { bounds } = boundsAt(frame, zoom);
      x = clamp(x, bounds.minX, bounds.maxX);
      y = clamp(y, bounds.minY, bounds.maxY);
    }
    const near = Math.abs(view.zoom - zoom) < 1e-4 && Math.abs(speed.zoom) < 1e-3 && Math.abs(view.x - x) < 0.05 && Math.abs(speed.x) < 0.5 && Math.abs(view.y - y) < 0.05 && Math.abs(speed.y) < 0.5;
    if (near || f.still) {
      if (!settled || view.zoom !== zoom || view.x !== x || view.y !== y) {
        settled = true;
        view.zoom = zoomGoal = zoom;
        view.x = pan.x = x;
        view.y = pan.y = y;
        ctx.invalidate();
      }
      speed.zoom = speed.x = speed.y = 0;
      return;
    }
    settled = false;
    const dt = Math.min(0.05, f.dt);
    const z = springStep(view.zoom, zoom, speed.zoom, dt, t);
    const sx = springStep(view.x, x, speed.x, dt, t);
    const sy = springStep(view.y, y, speed.y, dt, t);
    view.zoom = z.value;
    view.x = sx.value;
    view.y = sy.value;
    speed.zoom = z.speed;
    speed.x = sx.speed;
    speed.y = sy.speed;
    ctx.invalidate();
  });

  window.addEventListener('pointerdown', onDown, { capture: true });
  window.addEventListener('pointermove', onMove, { capture: true });
  window.addEventListener('pointerup', onUp, { capture: true });
  window.addEventListener('pointercancel', onUp, { capture: true });

  return {
    get mode() {
      return mode;
    },
    get side() {
      return side;
    },
    reset,
    dispose: () => {
      unsub();
      stopHold();
      window.removeEventListener('pointerdown', onDown, { capture: true });
      window.removeEventListener('pointermove', onMove, { capture: true });
      window.removeEventListener('pointerup', onUp, { capture: true });
      window.removeEventListener('pointercancel', onUp, { capture: true });
      if (touchAction !== null) document.documentElement.style.touchAction = touchAction;
      reset();
    },
  };
}
