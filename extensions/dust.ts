/**
 * Example extension: dust motes drifting through the light in front of the books.
 * Shows how to add an object to the scene with named, ranged parameters.
 *
 * Turn it on with `?ext=dust`, or list "dust" under "extensions" in content/library.json.
 */
import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, PointsMaterial } from 'three';
import { tunable, type Extension } from '../src/engine';
import { seeded } from '../src/engine/core/math';

const dust: Extension = (engine) => {
  const { ctx } = engine;
  const COUNT = 500;
  const rnd = seeded(7);
  const base = new Float32Array(COUNT * 3);
  const phase = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    base[i * 3] = (rnd() - 0.5) * 46;
    base[i * 3 + 1] = (rnd() - 0.5) * 30;
    base[i * 3 + 2] = -40 + rnd() * 26;
    phase[i] = rnd() * Math.PI * 2;
  }
  const positions = new Float32Array(base);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  const material = new PointsMaterial({ color: '#fff4d6', size: 0.09, transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false, sizeAttenuation: true });
  const points = new Points(geometry, material);
  points.frustumCulled = false;

  // `tunable` registers the parameters and hands back a live object to read them from.
  const t = tunable(ctx.registry, {
    id: 'prop.dust.motion',
    label: 'Dust motion',
    kind: 'animation',
    tags: ['animation', 'effect'],
    describe: 'How the dust motes drift.',
    source: 'extensions/dust.ts',
    params: {
      drift: { value: 0.25, min: 0, max: 3, help: 'Sideways wander, world units' },
      rise: { value: 0.12, min: -2, max: 2, unit: '1/s', help: 'Upward speed, in box heights per ten seconds' },
      opacity: { value: 0.5, min: 0, max: 1 },
      size: { value: 0.09, min: 0.01, max: 1 },
    },
  });

  const remove = engine.addObject({
    id: 'prop.dust',
    label: 'Dust motes',
    object: points,
    tags: ['effect'],
    describe: 'Small bright points that drift slowly through the key light.',
    source: 'extensions/dust.ts',
    update: (f) => {
      if (ctx.still) return false;
      material.opacity = t.opacity;
      material.size = t.size;
      for (let i = 0; i < COUNT; i++) {
        const p = phase[i]!;
        positions[i * 3] = base[i * 3]! + Math.sin(f.time * 0.21 + p) * t.drift * 2;
        positions[i * 3 + 1] = ((base[i * 3 + 1]! + 15 + f.time * t.rise * 3) % 30) - 15 + Math.cos(f.time * 0.17 + p * 1.7) * t.drift;
        positions[i * 3 + 2] = base[i * 3 + 2]! + Math.sin(f.time * 0.13 + p * 2.3) * t.drift;
      }
      geometry.attributes.position!.needsUpdate = true;
      return true;
    },
  });

  return () => {
    remove();
    ctx.registry.remove('prop.dust.motion');
    geometry.dispose();
    material.dispose();
  };
};

export default dust;
