import { ShaderChunk } from 'three';
import { describe, expect, it } from 'vitest';
import { SHADOW_TAPS, SHEET_LIGHTS, SOFT_SHADOWS } from './surface';

describe('the soft shadow lookup', () => {
  it('still finds the five samples of the three.js version in use and replaces them', () => {
    // If a library update rewrites the lookup, the pattern finds nothing and book surfaces fall back to the
    // stock five samples, which show as a stipple in wide shadows.
    expect(SOFT_SHADOWS).not.toBe(ShaderChunk.shadowmap_pars_fragment);
    expect(SOFT_SHADOWS).toContain(`vogelDiskSample( i, ${SHADOW_TAPS}, phi )`);
    expect(SOFT_SHADOWS).not.toMatch(/vogelDiskSample\( \d, 5, phi \)/);
  });
});

describe('the light loop of a single sheet', () => {
  it('still finds the shadow lines of the three.js version in use', () => {
    // The sheet's loop is the library's loop with every shadow weighed by the angle to the light. If a library
    // update rewrites those lines, the patch finds nothing and sheets would take shadows like solid things.
    const shadows = ShaderChunk.lights_fragment_begin.match(/receiveShadow \) \? get\w*Shadow\(/g) ?? [];
    const weighed = SHEET_LIGHTS.match(/uAloft/g) ?? [];
    expect(shadows.length).toBeGreaterThanOrEqual(3);
    expect(weighed.length).toBe(shadows.length);
  });

  it('changes nothing else in the loop', () => {
    const restored = SHEET_LIGHTS.replace(/mix\( 1\.0, (\( directLight\.visible && receiveShadow \) \? get\w*Shadow\([^;]*\) : 1\.0), mix\( 1\.0, smoothstep\([^;]*uAloft \) \);/g, '$1;');
    expect(restored).toBe(ShaderChunk.lights_fragment_begin);
  });
});
