/**
 * The frame loop. Update phases run every animation frame (they are cheap arithmetic). The scene is drawn only
 * when something asked for it: a module called `invalidate()`, a lease is held, or the heartbeat is due.
 * This is what keeps an idle shelf at a few draws per second (SPEC S-REN-5).
 */
import { clamp } from './math';

/** Ordered phases. A module hooks into the phase that matches what it computes. */
export const FRAME_PHASES = ['input', 'scroll', 'layout', 'reader', 'lights', 'effects', 'before-render', 'after-render'] as const;
export type FramePhase = (typeof FRAME_PHASES)[number];

export interface FrameInfo {
  /** Seconds since the last frame, clamped to [1/240, 1/20]. */
  dt: number;
  /** Seconds since start (sum of clamped dt). */
  time: number;
  frame: number;
  /** Reduced motion: animations jump to their end state. */
  still: boolean;
}

export type Unsubscribe = () => void;
type FrameFn = (f: FrameInfo) => void;

export interface LoopOptions {
  /** Draws the scene. Called at most once per animation frame. */
  render: (f: FrameInfo) => void;
  /** Seconds between forced draws when nothing changes. */
  heartbeat?: number;
  /** Injected for tests and virtual clocks. Defaults to the browser's. */
  raf?: (cb: (ms: number) => void) => number;
  caf?: (id: number) => void;
}

export class FrameLoop {
  readonly info: FrameInfo = { dt: 1 / 60, time: 0, frame: 0, still: false };
  /** Number of draws since start, for tests and the inspector. */
  draws = 0;

  private readonly subs = new Map<FramePhase, Set<FrameFn>>();
  private readonly leases = new Map<symbol, string>();
  private dirty = true;
  private lastMs = -1;
  private sinceDraw = 0;
  private handle = 0;
  private running = false;
  private readonly heartbeat: number;
  private readonly raf: (cb: (ms: number) => void) => number;
  private readonly caf: (id: number) => void;

  constructor(private readonly opts: LoopOptions) {
    this.heartbeat = opts.heartbeat ?? 1;
    this.raf = opts.raf ?? ((cb) => requestAnimationFrame(cb));
    this.caf = opts.caf ?? ((id) => cancelAnimationFrame(id));
    for (const p of FRAME_PHASES) this.subs.set(p, new Set());
  }

  onFrame(phase: FramePhase, fn: FrameFn): Unsubscribe {
    const set = this.subs.get(phase);
    if (!set) throw new Error(`casebound: unknown frame phase "${phase}". Phases: ${FRAME_PHASES.join(', ')}`);
    set.add(fn);
    return () => set.delete(fn);
  }

  /** Ask for one draw. Call it whenever something visible changed. */
  invalidate(): void {
    this.dirty = true;
  }

  /** Keep drawing every frame until the returned function is called (a transition, the reader, an effect). */
  lease(name: string): Unsubscribe {
    const key = Symbol(name);
    this.leases.set(key, name);
    this.dirty = true;
    return () => {
      this.leases.delete(key);
      this.dirty = true;
    };
  }

  get activeLeases(): string[] {
    return [...this.leases.values()];
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastMs = -1;
    const step = (ms: number): void => {
      if (!this.running) return;
      this.tick(ms);
      this.handle = this.raf(step);
    };
    this.handle = this.raf(step);
  }

  stop(): void {
    this.running = false;
    this.caf(this.handle);
  }

  /** One frame at the given clock time in milliseconds. Public so tests and capture tools can drive it. */
  tick(ms: number): void {
    const raw = this.lastMs < 0 ? 1 / 60 : (ms - this.lastMs) / 1000;
    this.lastMs = ms;
    const f = this.info;
    f.dt = clamp(raw, 1 / 240, 1 / 20);
    f.time += f.dt;
    f.frame += 1;
    for (const phase of FRAME_PHASES) {
      if (phase === 'after-render') break;
      for (const fn of this.subs.get(phase)!) fn(f);
    }
    this.sinceDraw += f.dt;
    if (this.dirty || this.leases.size > 0 || this.sinceDraw >= this.heartbeat) {
      this.dirty = false;
      this.sinceDraw = 0;
      this.draws += 1;
      this.opts.render(f);
      for (const fn of this.subs.get('after-render')!) fn(f);
    }
  }
}
