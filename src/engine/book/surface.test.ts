import { ShaderChunk } from 'three';
import { describe, expect, it } from 'vitest';
import { SHEET_LIGHTS } from './surface';

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
