/**
 * The sound of the books: every page turn is heard, a page taken into the hand brushes, a held leaf flops as it
 * passes upright, a block of leaves riffles over and lands with a knock, and a cover that falls shut thuds.
 *
 * This unit only listens. The reader and the shelf say what happens through the engine's events, and each event
 * plays one voice (paper.ts) at the loudness and pace read on the reference (SPEC S-SND-1). Browsers allow sound
 * only after a press, a key or a touch, so the first sound may be the second thing a visitor does.
 */
import type { Engine } from '../index';
import { tunable } from '../core/tune';
import { FLOP_VOICE, GRAB_VOICE, HIT_VOICE, SHUFFLE_VOICE, THUD_VOICE, TURN_VOICES, flopRate, renderVoice, thud, turnRate, type PaperVoice } from './paper';

export interface PageSound {
  /** How many times each sound was asked for since the start, whether or not the browser let it play. */
  readonly played: Readonly<Record<'turn' | 'grab' | 'flop' | 'shuffle' | 'hit' | 'thud', number>>;
  /** True once the browser has let a sound play. */
  readonly unlocked: boolean;
  muted: boolean;
  dispose(): void;
}

export interface PageSoundOptions {
  /** Start silent. Default false. */
  muted?: boolean;
}

export function createPageSound(engine: Engine, opts: PageSoundOptions = {}): PageSound {
  const { ctx } = engine;
  const t = tunable(ctx.registry, {
    id: 'sound.paper',
    label: 'Sound of the pages',
    kind: 'effect',
    tags: ['sound', 'paper', 'interaction'],
    describe: 'What a visitor hears: a page turning, a page taken into the hand, a held leaf flopping over, a block of leaves riffling and landing, a cover falling shut. Made from noise in the browser; nothing is loaded.',
    source: 'src/engine/sound/page-sound.ts',
    params: {
      level: { value: 1, min: 0, max: 4, help: 'Loudness of all of it, as a share of the measured levels. 0: silent' },
      turn: { value: 0.25, min: 0, max: 1, help: 'A page turning. Measured: 0.25' },
      grab: { value: 0.1, min: 0, max: 1, help: 'A page taken into the hand. Measured: 0.1' },
      flop: { value: 0.14, min: 0, max: 1, help: 'A held leaf passing upright. Measured: 0.14' },
      shuffle: { value: 0.25, min: 0, max: 1, help: 'A block of leaves on its way over. Measured: 0.25' },
      hit: { value: 0.25, min: 0, max: 1, help: 'A block of more than three leaves landing. Measured: 0.25' },
      thud: { value: 1, min: 0, max: 4, help: 'A cover falling shut, as a share of the measured rule: up to 0.5 for the fastest' },
      thudGap: { value: 0.15, min: 0, max: 2, unit: 's', help: 'Shortest time between two thuds. Measured: 150 ms' },
    },
  });

  const played = { turn: 0, grab: 0, flop: 0, shuffle: 0, hit: 0, thud: 0 };
  let muted = opts.muted ?? false;
  let audio: AudioContext | null = null;
  let failed = false;
  let unlocked = false;
  const buffers = new Map<PaperVoice, AudioBuffer>();
  let lastThud = -Infinity;

  /** The browser's sound, made on the first press, key or touch. Null while there is none. */
  const start = (): AudioContext | null => {
    if (audio || failed) return audio;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) throw new Error('no audio');
      audio = new Ctor();
    } catch {
      failed = true;
      audio = null;
    }
    return audio;
  };
  const unlock = (): void => {
    const a = start();
    if (!a) return;
    if (a.state === 'suspended') void a.resume().catch(() => {});
    unlocked = true;
    for (const type of GESTURES) window.removeEventListener(type, unlock, true);
  };
  const GESTURES = ['pointerdown', 'keydown', 'touchstart'] as const;
  for (const type of GESTURES) window.addEventListener(type, unlock, { capture: true, passive: true });

  const bufferOf = (a: AudioContext, voice: PaperVoice, seed: number): AudioBuffer => {
    let buffer = buffers.get(voice);
    if (!buffer) {
      const samples = renderVoice(voice, a.sampleRate, seed);
      buffer = a.createBuffer(1, samples.length, a.sampleRate);
      buffer.getChannelData(0).set(samples);
      buffers.set(voice, buffer);
    }
    return buffer;
  };

  /** Plays one voice at a loudness and a pace. */
  const play = (kind: keyof typeof played, voice: PaperVoice, gain: number, rate: number, seed: number): void => {
    played[kind] += 1;
    if (muted || t.level <= 0 || gain <= 0 || !unlocked || !audio) return;
    try {
      const source = audio.createBufferSource();
      source.buffer = bufferOf(audio, voice, seed);
      source.playbackRate.value = rate;
      const level = audio.createGain();
      level.gain.value = Math.min(1, gain * t.level);
      source.connect(level).connect(audio.destination);
      source.start();
    } catch {
      // A browser that will not play leaves the page silent and working.
    }
  };

  const off = [
    ctx.events.on('page-turn', (e) => {
      // A block of leaves riffles when it is well on its way (see `page-shuffle`); a single leaf is heard at once.
      if ((e.leaves ?? 1) > 1) return;
      const pick = Math.floor(Math.random() * TURN_VOICES.length);
      play('turn', TURN_VOICES[pick]!, t.turn, turnRate(e.direction, e.speed ?? 0), 101 + pick);
    }),
    ctx.events.on('page-grab', () => play('grab', GRAB_VOICE, t.grab, 0.96 + 0.1 * Math.random(), 201)),
    ctx.events.on('page-upright', (e) => play('flop', FLOP_VOICE, t.flop, flopRate(e.speed), 301)),
    ctx.events.on('page-shuffle', () => play('shuffle', SHUFFLE_VOICE, t.shuffle, 0.98 + 0.08 * Math.random(), 401)),
    ctx.events.on('page-land', (e) => {
      if (e.leaves > 3) play('hit', HIT_VOICE, t.hit, 1, 501);
    }),
    ctx.events.on('cover-shut', (e) => {
      const now = performance.now() / 1000;
      if (now - lastThud < t.thudGap) return;
      lastThud = now;
      const rule = thud(e.speed, Math.random());
      play('thud', THUD_VOICE, rule.gain * t.thud, rule.rate, 601);
    }),
  ];

  return {
    played,
    get unlocked() {
      return unlocked;
    },
    get muted() {
      return muted;
    },
    set muted(next: boolean) {
      muted = next;
    },
    dispose: () => {
      for (const stop of off) stop();
      for (const type of GESTURES) window.removeEventListener(type, unlock, true);
      try {
        void audio?.close();
      } catch {
        // Already closed.
      }
      audio = null;
      buffers.clear();
      ctx.registry.remove('sound.paper');
    },
  };
}
