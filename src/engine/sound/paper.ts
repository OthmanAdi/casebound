/**
 * The sounds of paper, made from noise. No recordings are loaded.
 *
 * A sheet that turns is a rush of air over its face and a rustle in its fibres: noise through a band that slides
 * as the sheet speeds up, breathing in and out in small irregular steps. A block of leaves that lands, a cover
 * that falls shut, adds a knock: a short low tone under the noise. Each sound is described by a few numbers (a
 * voice) and rendered once into samples; playing it faster makes it shorter and higher, as a recording would be.
 *
 * When each sound plays, how loud and how fast is read on the reference (SPEC S-SND-1). What it sounds like is
 * ours: the reference plays recordings, and those are not ours to ship.
 */

export interface PaperVoice {
  /** Length in seconds at its own pace. */
  length: number;
  /** Centre of the band of noise at the start and at the end, Hz. */
  from: number;
  to: number;
  /** Sharpness of the band: 0.7 is broad, 3 is narrow. */
  q: number;
  /** Seconds to full loudness, and the time constant with which it falls away. */
  attack: number;
  fall: number;
  /** The rustle: steps of loudness per second, and how far each may dip, 0 to 1. */
  crinkle: number;
  depth: number;
  /** A knock under the noise: its pitch in Hz, its share of the loudness 0 to 1, when it falls and how fast it dies. */
  knock?: number;
  knockGain?: number;
  knockAt?: number;
  knockFall?: number;
  /** Share of the noise beside the knock, 0 to 1. Default 1. */
  air?: number;
}

/** Eight ways a single leaf sounds as it turns. One is picked at random for every turn. */
export const TURN_VOICES: PaperVoice[] = [
  { length: 0.22, from: 2600, to: 5200, q: 1.4, attack: 0.012, fall: 0.06, crinkle: 60, depth: 0.5 },
  { length: 0.18, from: 3200, to: 6400, q: 1.2, attack: 0.01, fall: 0.045, crinkle: 70, depth: 0.4 },
  { length: 0.24, from: 2200, to: 4800, q: 1.7, attack: 0.014, fall: 0.07, crinkle: 48, depth: 0.6 },
  { length: 0.34, from: 1500, to: 3600, q: 1.3, attack: 0.03, fall: 0.1, crinkle: 36, depth: 0.55 },
  { length: 0.38, from: 1300, to: 3000, q: 1.5, attack: 0.035, fall: 0.11, crinkle: 30, depth: 0.6 },
  { length: 0.4, from: 900, to: 2400, q: 1.2, attack: 0.04, fall: 0.13, crinkle: 26, depth: 0.5 },
  { length: 0.3, from: 1800, to: 4200, q: 1.6, attack: 0.02, fall: 0.085, crinkle: 44, depth: 0.65 },
  { length: 0.3, from: 1600, to: 3200, q: 1.0, attack: 0.03, fall: 0.09, crinkle: 34, depth: 0.3 },
];

/** A page taken into the hand: a short brush of a finger on paper. */
export const GRAB_VOICE: PaperVoice = { length: 0.09, from: 2600, to: 1800, q: 1.1, attack: 0.004, fall: 0.025, crinkle: 90, depth: 0.4 };
/** A held leaf falling over as it passes upright: a rush that sinks, with a soft slap at its end. */
export const FLOP_VOICE: PaperVoice = { length: 0.3, from: 1900, to: 900, q: 1.2, attack: 0.02, fall: 0.09, crinkle: 30, depth: 0.5, knock: 150, knockGain: 0.35, knockAt: 0.1, knockFall: 0.04 };
/** A block of leaves on its way over: many edges riffling past each other. */
export const SHUFFLE_VOICE: PaperVoice = { length: 0.5, from: 1700, to: 3400, q: 1.3, attack: 0.03, fall: 0.2, crinkle: 28, depth: 0.9 };
/** A block of leaves landing on its stack. */
export const HIT_VOICE: PaperVoice = { length: 0.2, from: 900, to: 400, q: 0.9, attack: 0.003, fall: 0.035, crinkle: 20, depth: 0.2, knock: 120, knockGain: 0.8, knockAt: 0, knockFall: 0.045, air: 0.5 };
/** A cover falling shut on its book. */
export const THUD_VOICE: PaperVoice = { length: 0.24, from: 500, to: 220, q: 0.8, attack: 0.002, fall: 0.03, crinkle: 16, depth: 0.2, knock: 85, knockGain: 1, knockAt: 0, knockFall: 0.06, air: 0.35 };

/** A small generator of random numbers that gives the same run for the same seed. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Renders a voice into samples between -1 and 1, loudest at 0.9. The same seed gives the same samples. */
export function renderVoice(voice: PaperVoice, sampleRate: number, seed = 1): Float32Array {
  const n = Math.max(1, Math.round(voice.length * sampleRate));
  const out = new Float32Array(n);
  const random = seeded(seed);
  const air = voice.air ?? 1;
  // A state-variable filter gives the band; its centre slides from one pitch to the other.
  let low = 0;
  let band = 0;
  const damp = 1 / Math.max(0.5, voice.q);
  // The rustle: the loudness steps to a new level at irregular moments and eases there.
  let level = 1;
  let goal = 1;
  let until = 0;
  let phase = 0;
  const fade = Math.min(n, Math.round(0.012 * sampleRate));
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const along = i / n;
    const centre = voice.from * Math.pow(voice.to / voice.from, along);
    const f = 2 * Math.sin((Math.PI * Math.min(centre, sampleRate * 0.22)) / sampleRate);
    const noise = random() * 2 - 1;
    low += f * band;
    const high = noise - low - damp * band;
    band += f * high;
    if (t >= until) {
      goal = 1 - voice.depth * random();
      until = t + (0.4 + 1.2 * random()) / Math.max(1, voice.crinkle);
    }
    level += (goal - level) * Math.min(1, (voice.crinkle * 3) / sampleRate);
    const env = Math.min(1, t / Math.max(1e-4, voice.attack)) * Math.exp(-Math.max(0, t - voice.attack) / Math.max(1e-4, voice.fall));
    let sample = band * env * level * air;
    if (voice.knock && voice.knockGain) {
      const since = t - (voice.knockAt ?? 0);
      if (since >= 0) {
        // The pitch of a knock drops in its first hundredths of a second, like a struck board.
        const pitch = voice.knock * (1 + 0.6 * Math.exp(-since / 0.012));
        phase += (2 * Math.PI * pitch) / sampleRate;
        sample += Math.sin(phase) * voice.knockGain * Math.exp(-since / Math.max(1e-4, voice.knockFall ?? 0.05));
      }
    }
    // No click at the end: the last hundredth fades to nothing.
    if (i >= n - fade) sample *= (n - 1 - i) / Math.max(1, fade);
    out[i] = sample;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]!));
  if (peak > 0) for (let i = 0; i < n; i++) out[i] = (out[i]! / peak) * 0.9;
  return out;
}

/**
 * How fast a turn plays, as a share of its own pace. Read on the reference: forward 1.1, and up to 1.8 for the
 * fastest hand; back 0.91, up to 1.17. `speed` is 0 for a key or a button.
 */
export const turnRate = (direction: 1 | -1, speed = 0): number => {
  const s = Math.min(Math.max(speed, 0), 1);
  return direction === 1 ? 1.1 + 0.7 * s : 0.91 + 0.26 * s;
};

/** Pace of the flop of a held leaf, for how fast the hand moved, 0 to 1. Read: 0.8 to 1.05. */
export const flopRate = (speed: number): number => 0.8 + 0.25 * Math.min(Math.max(speed, 0), 1);

/**
 * A cover falling shut: loudness and pace for how fast it closed, 0 to 1, and a random number 0 to 1. Read: loudness
 * (0.02 + 0.98 s) x (0.5 to 1) x 0.5, pace 0.8 + 0.5 s.
 */
export const thud = (speed: number, random: number): { gain: number; rate: number } => {
  const s = Math.min(Math.max(speed, 0), 1);
  return { gain: (0.02 + 0.98 * s) * (0.5 + 0.5 * random) * 0.5, rate: 0.8 + 0.5 * s };
};
