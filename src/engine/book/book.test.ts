import { Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { coverParams } from './book';
import { CLOTH, createSurfaceFx, createSurfaceMaterial } from './surface';

const material = (): ReturnType<typeof createSurfaceMaterial> =>
  createSurfaceMaterial({ map: new Texture(), grain: new Texture(), grainRepeat: [8, 5], grainPerUnit: 0.26, cloth: CLOTH.buckram, shininess: 9.9, reflectiveness: 0.5, bumpGrain: 0.055, bumpEmboss: 0.119, fx: createSurfaceFx() });

describe('the live parameters of a cover', () => {
  it('read what the material was made with', () => {
    const mat = material();
    const get = (key: string): unknown => coverParams(mat).find((p) => p.key === key)!.get();
    expect(get('shininess')).toBe(9.9);
    expect(get('reflectiveness')).toBe(0.5);
    expect(get('bumpGrain')).toBe(0.055);
    expect(get('bumpEmboss')).toBe(0.119);
    expect(get('sheen')).toBe(CLOTH.buckram.sheen);
    expect(get('relief')).toBe(CLOTH.buckram.relief);
  });

  it('write through to the material', () => {
    const mat = material();
    const params = coverParams(mat);
    const set = (key: string, v: number): void => params.find((p) => p.key === key)!.set(v);
    set('bumpGrain', 0.09);
    set('reflectiveness', 0.3);
    set('shininess', 14);
    const uniforms = mat.userData.uniforms as Record<string, { value: number }>;
    expect(uniforms.uBumpGrain!.value).toBe(0.09);
    expect(mat.specular.r).toBeCloseTo(0.3, 10);
    expect(mat.shininess).toBe(14);
  });

  it('all have a range, and a help text that names the field of book.json to keep the value in', () => {
    for (const p of coverParams(material())) {
      expect(p.min, p.key).toBeLessThan(p.max!);
      expect(p.help, p.key).toMatch(/`(material|cover)\.[a-zA-Z.]+`/);
    }
  });
});
