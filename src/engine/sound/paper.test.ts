import { describe, expect, it } from 'vitest';
import { FLOP_VOICE, GRAB_VOICE, HIT_VOICE, SHUFFLE_VOICE, THUD_VOICE, TURN_VOICES, flopRate, renderVoice, seeded, thud, turnRate } from './paper';

const RATE = 24000;

/** Loudness of a stretch of samples. */
const rms = (s: Float32Array, from = 0, to = s.length): number => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += s[i]! * s[i]!;
  return Math.sqrt(sum / Math.max(1, to - from));
};

/** How often the samples change sign per second: a rough measure of pitch. */
const crossings = (s: Float32Array): number => {
  let n = 0;
  for (let i = 1; i < s.length; i++) if (s[i - 1]! < 0 !== s[i]! < 0) n++;
  return (n / s.length) * RATE;
};

describe('the sounds of paper', () => {
  it('are rendered as long as they say, between -1 and 1, loudest at 0.9', () => {
    for (const voice of [...TURN_VOICES, GRAB_VOICE, FLOP_VOICE, SHUFFLE_VOICE, HIT_VOICE, THUD_VOICE]) {
      const s = renderVoice(voice, RATE, 7);
      expect(s.length).toBe(Math.round(voice.length * RATE));
      let peak = 0;
      for (const v of s) peak = Math.max(peak, Math.abs(v));
      expect(peak).toBeCloseTo(0.9, 5);
      expect(s.every((v) => Number.isFinite(v))).toBe(true);
    }
  });

  it('start and end in silence, so nothing clicks', () => {
    for (const voice of [...TURN_VOICES, SHUFFLE_VOICE, GRAB_VOICE]) {
      const s = renderVoice(voice, RATE, 3);
      expect(Math.abs(s[0]!)).toBeLessThan(0.05);
      expect(Math.abs(s[s.length - 1]!)).toBeLessThan(1e-6);
    }
  });

  it('are the same for the same seed and different for another', () => {
    const a = renderVoice(TURN_VOICES[0]!, RATE, 11);
    const b = renderVoice(TURN_VOICES[0]!, RATE, 11);
    const c = renderVoice(TURN_VOICES[0]!, RATE, 12);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });

  it('come in eight turns that do not sound alike: brighter ones cross zero more often', () => {
    expect(TURN_VOICES.length).toBe(8);
    const light = crossings(renderVoice(TURN_VOICES[1]!, RATE, 5));
    const deep = crossings(renderVoice(TURN_VOICES[5]!, RATE, 5));
    expect(light).toBeGreaterThan(deep * 1.5);
  });

  it('fall away: a turn is louder in its first third than in its last', () => {
    for (const voice of TURN_VOICES) {
      const s = renderVoice(voice, RATE, 9);
      const third = Math.floor(s.length / 3);
      expect(rms(s, 0, third)).toBeGreaterThan(rms(s, 2 * third) * 1.5);
    }
  });

  it('give a landing block and a shutting cover a low knock', () => {
    // Far fewer zero crossings than a turn: most of the sound is a low tone.
    const turn = crossings(renderVoice(TURN_VOICES[0]!, RATE, 5));
    expect(crossings(renderVoice(THUD_VOICE, RATE, 5))).toBeLessThan(turn / 3);
    expect(crossings(renderVoice(HIT_VOICE, RATE, 5))).toBeLessThan(turn / 2);
  });

  it('make a block of leaves riffle for longer than a single leaf turns', () => {
    expect(SHUFFLE_VOICE.length).toBeGreaterThan(Math.max(...TURN_VOICES.map((v) => v.length)));
  });

  it('play a turn at the measured pace: forward faster than back, and faster for a fast hand', () => {
    expect(turnRate(1)).toBeCloseTo(1.1, 9);
    expect(turnRate(-1)).toBeCloseTo(0.91, 9);
    expect(turnRate(1, 1)).toBeCloseTo(1.8, 9);
    expect(turnRate(-1, 1)).toBeCloseTo(1.17, 9);
    expect(turnRate(1, 7)).toBeCloseTo(1.8, 9);
    expect(flopRate(0)).toBeCloseTo(0.8, 9);
    expect(flopRate(1)).toBeCloseTo(1.05, 9);
  });

  it('make a cover that shuts fast louder and higher than one that shuts slowly', () => {
    expect(thud(0, 1).gain).toBeCloseTo(0.01, 9);
    expect(thud(1, 1).gain).toBeCloseTo(0.5, 9);
    expect(thud(1, 0).gain).toBeCloseTo(0.25, 9);
    expect(thud(0, 0).rate).toBeCloseTo(0.8, 9);
    expect(thud(1, 0).rate).toBeCloseTo(1.3, 9);
  });

  it('draw random numbers between 0 and 1 that repeat for a seed', () => {
    const a = seeded(42);
    const b = seeded(42);
    for (let i = 0; i < 50; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
