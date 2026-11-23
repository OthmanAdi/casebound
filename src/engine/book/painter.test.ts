import { describe, expect, it } from 'vitest';
import { COVER_RELIEF, reliefLevel } from './painter';

describe('the relief map', () => {
  it('puts the cloth at mid grey and pressed type below it', () => {
    expect(reliefLevel(0.5)).toBe('rgb(128,128,128)');
    expect(reliefLevel(0.5 - COVER_RELIEF.press)).toBe('rgb(36,36,36)');
  });

  it('stays inside the range a texture can hold', () => {
    expect(reliefLevel(-1)).toBe('rgb(0,0,0)');
    expect(reliefLevel(2)).toBe('rgb(255,255,255)');
  });
});
