/**
 * The light rig: ambient, a shadow-casting key, a sun for fill and rim, and a spot that follows the pointer.
 * Every frame the rig blends the active presets and writes the result into the lights (SPEC section 3).
 */
import { AmbientLight, Color, DirectionalLight, Group, Object3D, SpotLight, Vector3 } from 'three';
import { approach, frameFactor, smoothstep } from '../core/math';
import type { Registry } from '../core/registry';
import { tunable } from '../core/tune';
import { BUILT_IN_PRESETS, blendPresets, mixHex, type LightPreset, type ThemeName } from './presets';

export interface RigInputs {
  /** Pointer in normalised device coordinates, -1..1, y up. Null on touch devices: no pointer coupling. */
  pointer: { x: number; y: number } | null;
  /** 0 = shelf, 1 = reader open. */
  inside: number;
  /** Background colour of the active book, used to tint the rig in the colour theme. */
  bookColor: string | null;
  /** Point the key light's shadow frustum is centred on (the wall centre). */
  shadowCentre: Vector3;
  /** Small-viewport tier: smaller shadow map, no pointer coupling. */
  compact: boolean;
}

/** How many direction-lengths from the wall centre the key light is placed. */
const KEY_REACH = 4.611;

export class LightRig {
  readonly group = new Group();
  readonly ambient = new AmbientLight('#ffffff', 0.83);
  readonly key = new DirectionalLight('#b3aba2', 3.61);
  readonly sun = new DirectionalLight('#aea7a7', 2.63);
  readonly spot = new SpotLight('#fffadb', 0.5, 0, 0.36, 0.94, 0);

  theme: ThemeName = 'light';
  /** The preset the rig resolved this frame, for the inspector and for tests. */
  current: LightPreset = BUILT_IN_PRESETS.browse!;

  private readonly presets = new Map<string, LightPreset>(Object.entries(BUILT_IN_PRESETS));
  private darkW = 0;
  private lightW = 1;
  private colourW = 0;
  private insideW = 0;
  private seeded = false;
  private readonly spotGoal = new Vector3();
  private readonly spotTargetGoal = new Vector3();
  private readonly tmp = new Color();
  private readonly tune;

  constructor(registry: Registry) {
    this.group.name = 'stage.lights';
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.spot.castShadow = false;
    this.spot.shadow.mapSize.set(2048, 2048);
    this.spot.shadow.bias = -0.00004;
    this.spot.shadow.normalBias = 0.0165;
    this.spot.shadow.radius = 3.2;
    this.spot.shadow.camera.near = 1;
    this.spot.shadow.camera.far = 275;
    this.spot.position.set(24, 5.4, 10);
    this.spot.target.position.set(0, 0, -50);
    this.group.add(this.ambient, this.key, this.key.target, this.sun, this.sun.target, this.spot, this.spot.target);

    this.tune = tunable(registry, {
      id: 'light.rig',
      label: 'Light rig',
      kind: 'light-rig',
      tags: ['light', 'environment'],
      describe: 'Blends the light presets by theme and by reader state, and makes the spot follow the pointer.',
      source: 'src/engine/stage/rig.ts',
      params: {
        darkRate: { value: 1, min: 0.05, max: 20, unit: '1/s', help: 'How fast the rig moves to and from the dark theme' },
        insideRate: { value: 1.8, min: 0.05, max: 20, unit: '1/s', help: 'How fast the rig moves to and from the reader preset' },
        tintRate: { value: 3, min: 0.05, max: 20, unit: '1/s', help: 'How fast the colour theme tint follows the active book' },
        lightBoost: { value: 0.1, min: 0, max: 1, help: 'Extra key and sun intensity in the light theme, as a fraction' },
        parallax: { value: 0.7, min: 0, max: 5, help: 'How far key and sun shift with the pointer in the light theme, world units' },
        spotSwing: { value: 36, min: 0, max: 120, help: 'How far the spot travels with the pointer, world units' },
        spotFollow: { value: 0.06, min: 0.005, max: 1, help: 'Fraction the spot moves toward the pointer per 60 Hz frame' },
        spotZ: { value: 10, min: -40, max: 60, help: 'Depth of the spot light' },
        spotTargetZ: { value: -50, min: -120, max: 0, help: 'Depth of the plane the spot aims at' },
        spotTargetShare: { value: 0.3, min: 0, max: 1, help: 'Share of the spot offset its target follows' },
        ambientTint: { value: 0.25, min: 0, max: 1, help: 'Pull of ambient colour toward the pale book colour in the colour theme' },
        keyTint: { value: 0.2, min: 0, max: 1, help: 'Pull of key colour toward the muted book colour in the colour theme' },
      },
    });

    for (const [id, light, label] of [
      ['light.ambient', this.ambient, 'Ambient light'],
      ['light.key', this.key, 'Key light'],
      ['light.sun', this.sun, 'Sun light'],
      ['light.spot', this.spot, 'Pointer spot light'],
    ] as const) {
      registry.add({ id, label, kind: light.type, tags: ['light'], object: light as Object3D, source: 'src/engine/stage/presets.ts', describe: 'Driven by the rig every frame. Change the presets or light.rig to change it durably.' });
    }
  }

  /** Adds or replaces a preset. Use `setPresetNames` to make the rig use it. */
  definePreset(name: string, preset: LightPreset): void {
    this.presets.set(name, preset);
  }

  /** Which presets the rig blends between: shelf, shelf dark, reader, reader dark. */
  private names = { shelf: 'browse', shelfDark: 'dark', inside: 'look-inside', insideDark: 'dark-look-inside' };
  setPresetNames(names: Partial<typeof this.names>): void {
    Object.assign(this.names, names);
  }

  private preset(name: string): LightPreset {
    const p = this.presets.get(name);
    if (!p) throw new Error(`casebound: light preset "${name}" is not defined. Defined: ${[...this.presets.keys()].join(', ')}`);
    return p;
  }

  /** Returns true while anything is still moving, so the caller can keep drawing. */
  update(dt: number, input: RigInputs, still: boolean): boolean {
    const t = this.tune;
    const goalDark = this.theme === 'dark' ? 1 : 0;
    const goalLight = this.theme === 'light' ? 1 : 0;
    const goalColour = this.theme === 'colour' ? 1 : 0;
    const before = this.darkW + this.lightW + this.colourW + this.insideW;
    if (!this.seeded || still) {
      this.darkW = goalDark;
      this.lightW = goalLight;
      this.colourW = goalColour;
      this.insideW = input.inside;
    } else {
      this.darkW = approach(this.darkW, goalDark, t.darkRate, dt);
      this.lightW = approach(this.lightW, goalLight, t.darkRate, dt);
      this.colourW = approach(this.colourW, goalColour, t.tintRate, dt);
      this.insideW = approach(this.insideW, input.inside, t.insideRate, dt);
    }

    const shelf = blendPresets(this.preset(this.names.shelf), this.preset(this.names.shelfDark), this.darkW);
    const inside = blendPresets(this.preset(this.names.inside), this.preset(this.names.insideDark), this.darkW);
    const p = blendPresets(shelf, inside, smoothstep(0, 1, this.insideW));
    this.current = p;

    const px = input.pointer && !input.compact ? input.pointer.x : 0;
    const py = input.pointer && !input.compact ? input.pointer.y : 0;
    // Measured in the running scene: Noon carries the same lift of key and sun as Morning.
    const boost = 1 + t.lightBoost * Math.min(1, this.lightW + this.colourW);
    const shift = t.parallax * this.lightW;

    // Ambient: preset colour, pulled toward a pale version of the book colour in the colour theme.
    let ambientColor = p.ambient.color;
    let keyColor = p.key.color;
    if (input.bookColor && this.colourW > 0.001) {
      const pale = mixHex(input.bookColor, '#ffffff', 0.6);
      ambientColor = mixHex(ambientColor, pale, t.ambientTint * this.colourW);
      this.tmp.set(input.bookColor);
      const grey = (this.tmp.r + this.tmp.g + this.tmp.b) / 3;
      this.tmp.setRGB((this.tmp.r + grey) / 2, (this.tmp.g + grey) / 2, (this.tmp.b + grey) / 2);
      keyColor = mixHex(keyColor, '#' + this.tmp.getHexString(), t.keyTint * this.colourW);
    }
    this.ambient.color.set(ambientColor);
    this.ambient.intensity = p.ambient.intensity;

    // Key: position plus pointer parallax, then shifted sideways so its shadow frustum stays on the wall centre.
    this.key.color.set(keyColor);
    this.key.intensity = p.key.intensity * boost;
    // Measured live: the light sits on the line from the wall centre along (preset.x, preset.y, preset.z + 4),
    // 4.611 direction-lengths out, so its shadow frustum stays centred on the wall.
    const kx = p.key.position[0] + px * shift;
    const ky = p.key.position[1] + py * shift;
    const kz = p.key.position[2] + 4 * this.lightW;
    const c = input.shadowCentre;
    this.key.target.position.copy(c);
    this.key.position.set(c.x + kx * KEY_REACH, c.y + ky * KEY_REACH, c.z + kz * KEY_REACH);
    const sh = this.key.shadow;
    const cam = sh.camera;
    cam.left = cam.bottom = -p.shadow.frustumHalf;
    cam.right = cam.top = p.shadow.frustumHalf;
    cam.near = p.shadow.near;
    cam.far = p.shadow.far;
    cam.updateProjectionMatrix();
    sh.bias = p.shadow.bias;
    sh.normalBias = p.shadow.normalBias;
    sh.radius = p.shadow.radius;
    const size = input.compact ? Math.min(512, p.shadow.mapSize) : p.shadow.mapSize;
    if (sh.mapSize.x !== size) {
      sh.mapSize.set(size, size);
      sh.map?.dispose();
      sh.map = null;
    }

    // Sun: same parallax, no recentring.
    this.sun.color.set(p.sun.color);
    this.sun.intensity = p.sun.intensity * boost;
    this.sun.position.set(p.sun.position[0] + px * shift, p.sun.position[1] + py * shift, p.sun.position[2] + 4 * this.lightW);
    this.sun.target.position.set(0, 0, 0);

    // Spot: follows the pointer with a per-frame ease. It only casts in the dark theme.
    this.spot.color.set(p.spot.color);
    this.spot.intensity = p.spot.intensity * (input.compact ? 0.9 : 1);
    this.spot.angle = p.spot.angle;
    this.spot.castShadow = this.darkW > 0.5;
    const ox = t.spotSwing * Math.sin(0.7 * Math.PI * px);
    const oy = t.spotSwing * Math.sin(0.6 * Math.PI * py);
    this.spotGoal.set(p.spot.base[0] + ox, p.spot.base[1] + oy, t.spotZ);
    this.spotTargetGoal.set(ox * t.spotTargetShare, oy * t.spotTargetShare, t.spotTargetZ);
    const f = !this.seeded || still ? 1 : frameFactor(t.spotFollow, dt);
    const moved = this.spot.position.distanceToSquared(this.spotGoal) + this.spot.target.position.distanceToSquared(this.spotTargetGoal);
    this.spot.position.lerp(this.spotGoal, f);
    this.spot.target.position.lerp(this.spotTargetGoal, f);

    this.seeded = true;
    const after = this.darkW + this.lightW + this.colourW + this.insideW;
    return moved > 1e-6 || Math.abs(after - before) > 1e-5;
  }
}
