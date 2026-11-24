/**
 * The scratch of a felt nib on paper: a band of noise that follows the hand (SPEC S-RD-13).
 *
 * Read on the reference: every move of a pressed pen on a page plays a short scratch. White noise runs in a loop
 * through a band-pass filter. The faster the hand moves sideways, the higher and the louder the band; a moment
 * after the last move it falls silent. Only sideways travel counts.
 *
 * The sound needs a press before it may play, which a stroke always is. Where the browser has no audio, or
 * refuses it, the pen is silent and nothing else changes.
 */

export interface ScratchTuning {
  /** Sideways travel between two moves, in pixels, at which the scratch is at full strength. */
  full: number;
  /** Centre of the band in Hz: `low` at rest and `low + span` at full strength, times `ratio`, times a random factor between `wobble` and 2 - `wobble`. */
  low: number;
  span: number;
  ratio: number;
  wobble: number;
  /** Sharpness of the band. */
  q: number;
  /** Loudness: `quiet` at rest and `quiet + loud` at full strength, times `level`. */
  quiet: number;
  loud: number;
  level: number;
  /** Seconds a scratch holds after a move, and the time constant with which it falls away. */
  hold: number;
  fall: number;
  /** Time constants with which pitch and loudness follow the hand, seconds. */
  follow: number;
}

/** As read in the reference's script; its logged calls match these to six places. */
export const SCRATCH_DEFAULT: ScratchTuning = { full: 22, low: 110, span: 450, ratio: 2.6, wobble: 0.6, q: 7.2, quiet: 0.015, loud: 0.05, level: 0.392, hold: 0.09, fall: 0.06, follow: 0.025 };

/** The band a move of `travel` pixels sideways asks for: its centre in Hz for a random number 0 to 1, and its loudness. */
export function scratchBand(travel: number, random: number, t: ScratchTuning = SCRATCH_DEFAULT): { frequency: number; gain: number } {
  const s = Math.min(1, Math.max(0, travel) / t.full);
  return { frequency: (t.low + t.span * s) * t.ratio * (t.wobble + (2 - 2 * t.wobble) * random), gain: (t.quiet + t.loud * s) * t.level };
}

export interface Scratch {
  /** A pressed pen moved `travel` pixels sideways. `volume` scales the loudness; 0 is silent. */
  stroke(travel: number, volume?: number): void;
  dispose(): void;
}

export function createScratch(tuning: ScratchTuning = SCRATCH_DEFAULT): Scratch {
  let audio: AudioContext | null = null;
  let filter: BiquadFilterNode | null = null;
  let level: GainNode | null = null;
  let source: AudioBufferSourceNode | null = null;
  let failed = false;

  const start = (): boolean => {
    if (audio) return true;
    if (failed) return false;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) throw new Error('no audio');
      audio = new Ctor();
      // Two seconds of white noise, looped.
      const buffer = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      source = audio.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      filter = audio.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = tuning.q;
      level = audio.createGain();
      level.gain.value = 0;
      source.connect(filter).connect(level).connect(audio.destination);
      source.start();
      return true;
    } catch {
      failed = true;
      audio = null;
      return false;
    }
  };

  return {
    stroke: (travel, volume = 1) => {
      if (volume <= 0 || !start() || !audio || !filter || !level) return;
      if (audio.state === 'suspended') void audio.resume();
      const band = scratchBand(travel, Math.random(), tuning);
      const now = audio.currentTime;
      filter.frequency.setTargetAtTime(band.frequency, now, tuning.follow);
      level.gain.cancelScheduledValues(now);
      level.gain.setTargetAtTime(band.gain * volume, now, tuning.follow);
      // A moment after the last move the scratch falls away.
      level.gain.setTargetAtTime(0, now + tuning.hold, tuning.fall);
    },
    dispose: () => {
      try {
        source?.stop();
        void audio?.close();
      } catch {
        // Already closed.
      }
      audio = null;
    },
  };
}
