import { ShaderChunk } from 'three';
import { describe, expect, it } from 'vitest';
import { JOINT, SHADOW_TAPS, SHEET_LIGHTS, SOFT_SHADOWS, jointSlope } from './surface';

describe('the joint relief', () => {
  const half = 0.2;
  const closed = Math.PI / 2;
  const cornerOnly = { ...JOINT, drop: 0 };

  it('turns the hinge of a closed book toward the spine before its middle and toward the board after it', () => {
    expect(jointSlope(-0.1, half, closed, cornerOnly)).toBeGreaterThan(0);
    expect(jointSlope(0.1, half, closed, cornerOnly)).toBeLessThan(0);
    // Symmetric about the middle, and smooth through it.
    expect(jointSlope(0.1, half, closed, cornerOnly)).toBeCloseTo(-jointSlope(-0.1, half, closed, cornerOnly), 10);
    expect(jointSlope(0, half, closed, cornerOnly)).toBeCloseTo(0, 10);
  });

  it('leaves a flat hinge alone', () => {
    expect(jointSlope(-0.1, half, 0, cornerOnly)).toBeCloseTo(0, 12);
    expect(jointSlope(0.1, half, -0.4, cornerOnly)).toBeCloseTo(0, 12);
  });

  it('comes down onto the board by the drop, and is level beyond', () => {
    const descent = { ...JOINT, corner: 0 };
    let height = 0;
    const step = 1e-4;
    for (let s = -1; s < 2; s += step) height += jointSlope(s + step / 2, half, closed, descent) * step;
    expect(height).toBeCloseTo(-JOINT.drop, 4);
    expect(jointSlope(JOINT.start + JOINT.run + 0.01, half, closed, descent)).toBeCloseTo(0, 12);
    expect(jointSlope(-0.5, half, closed)).toBeCloseTo(0, 12);
  });
});

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
