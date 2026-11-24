/**
 * The pen as an object in the scene: a highlighter that stands on the pointer over the pages of the open book.
 *
 * Its shape comes from pen-shape.ts, its motion from pen-motion.ts. This unit puts the two into the scene: it
 * finds the place on the paper under the pointer (or the nearest page edge when the pointer is beside the book),
 * poses the pen on the pointer's ray with its nib clear of the paper, draws the footprint a press would leave,
 * hides the cursor over a page, and gives the pen its gloss and its shadow (SPEC S-RD-13).
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  MultiplyBlending,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  RGBADepthPacking,
  SRGBColorSpace,
  Vector3,
  type Texture,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Engine } from '../index';
import { tunable } from '../core/tune';
import type { Reader } from '../reader/reader';
import { PEN_DEFAULT, createPen, penLean, penMoving, restPen, stepPen } from './pen-motion';
import { penMeshes, type PartMesh } from './pen-shape';

/** One pen: the colours of its parts, and the ink it leaves. */
export interface PenColor {
  name: string;
  /** Barrel and cap. */
  body: string;
  collar: string;
  nib: string;
  /** The colour the paper is dyed, and how strongly, 0 to 1. */
  ink: string;
  strength: number;
}

/** What the hand is doing, asked once a frame. */
export interface PenHand {
  /** The pen is out. */
  on: boolean;
  /** The button is down. */
  pressed: boolean;
  color: PenColor;
  /** The pointer in window pixels, and whether it is on a control. Null: no pointer, or it has left the window. */
  pointer: { x: number; y: number; blocked: boolean } | null;
  /** Width of the line as a share of the page height, for the footprint. */
  width: number;
}

export interface PenObject {
  /** True while the pen stands on a page, not beside it. */
  readonly onPage: boolean;
  dispose(): void;
}

/** The filmic curve (ACES, fitted), written out because the renderer only carries it when it applies it to everything. */
const FILMIC = /* glsl */ `
vec3 penFilmic( vec3 color ) {
	const mat3 toAces = mat3( vec3( 0.59719, 0.07600, 0.02840 ), vec3( 0.35458, 0.90834, 0.13383 ), vec3( 0.04823, 0.01566, 0.83777 ) );
	const mat3 fromAces = mat3( vec3( 1.60475, -0.10208, -0.00327 ), vec3( -0.53108, 1.10813, -0.07276 ), vec3( -0.07367, -0.00605, 1.07602 ) );
	color = toAces * ( color / 0.6 );
	vec3 a = color * ( color + 0.0245786 ) - 0.000090537;
	vec3 b = color * ( 0.983729 * color + 0.4329510 ) + 0.238081;
	return clamp( fromAces * ( a / b ), 0.0, 1.0 );
}
`;

const geometry = (part: PartMesh): BufferGeometry => {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(part.position), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(part.normal), 3));
  g.setIndex(part.index);
  return g;
};

/**
 * What the lacquer of the pen reflects: not the scene, but a small room of its own, the stock room of three
 * (lit walls, a few boxes, bright panels), blurred once. Its walls fill the barrel with soft light; its panels
 * show as two or three spots on the dome.
 */
function glossRoom(engine: Engine): Texture {
  const room = new RoomEnvironment();
  const pmrem = new PMREMGenerator(engine.ctx.renderer);
  const target = pmrem.fromScene(room, 0.04);
  pmrem.dispose();
  room.dispose();
  return target.texture;
}

export function createPenObject(engine: Engine, reader: Reader, hand: () => PenHand): PenObject {
  const { ctx } = engine;
  const t = tunable(ctx.registry, {
    id: 'marker.pen',
    label: 'The pen in the hand',
    kind: 'object',
    tags: ['object', 'interaction', 'animation'],
    describe: 'The highlighter that stands on the pointer over the open book: its size, how it hovers, leans and swings, its footprint, gloss and shadow.',
    source: 'src/engine/marker/pen.ts',
    params: {
      length: { value: 0.445, min: 0.1, max: 1.5, help: 'From the edge of the nib to the rim of the cap, in page heights. Measured: 0.42 of the height of the open book on screen' },
      hover: { value: PEN_DEFAULT.hover, min: 0, max: 0.5, help: 'How high it hovers when not pressed, as a share of its length. Measured: 0.07' },
      lean: { value: PEN_DEFAULT.lean, min: 0, max: 1.4, unit: 'rad', help: 'How far it leans toward the reader. Measured: 0.42' },
      leanPressed: { value: PEN_DEFAULT.leanPressed, min: 0, max: 0.6, unit: 'rad', help: 'How much further it leans when pressed. Measured: 0.12' },
      twist: { value: PEN_DEFAULT.twist, min: -3.2, max: 3.2, unit: 'rad', help: 'Turn about its own axis. Measured: -0.35' },
      down: { value: PEN_DEFAULT.down, min: 0.001, max: 1, unit: 's', help: 'Smoothing time of the way down onto the paper. Measured: 0.03' },
      up: { value: PEN_DEFAULT.up, min: 0.001, max: 1, unit: 's', help: 'Smoothing time of the way up. Measured: 0.09' },
      rollGain: { value: PEN_DEFAULT.rollGain, min: 0, max: 0.002, help: 'Sideways swing per pointer speed, rad per px/s. Measured: 0.00025. 0: the pen does not swing' },
      rollLimit: { value: PEN_DEFAULT.rollLimit, min: 0, max: 1.2, unit: 'rad', help: 'Measured: 0.4' },
      pitchGain: { value: PEN_DEFAULT.pitchGain, min: 0, max: 0.002, help: 'Swing toward and away from the reader per pointer speed. Measured: 0.00012' },
      pitchLimit: { value: PEN_DEFAULT.pitchLimit, min: 0, max: 1, unit: 'rad', help: 'Measured: 0.2' },
      stiffness: { value: PEN_DEFAULT.stiffness, min: 1, max: 1000, help: 'Pull of the two springs. Measured: 120' },
      loss: { value: PEN_DEFAULT.loss, min: 0, max: 100, help: 'Speed the springs lose per second, as an exponent. Measured: 13' },
      clearance: { value: 0.03, min: 0, max: 1, help: 'Air kept between the lowest corner of the nib and the paper, world units. Measured: 0.03' },
      footprint: { value: PEN_DEFAULT.footprint, min: 0, max: 1, help: 'Opacity of the mark under a hovering nib that shows what a press would paint. Measured: 0.9. 0: none' },
      footprintRate: { value: PEN_DEFAULT.footprintRate, min: 1, max: 200, unit: '1/s', help: 'How fast it comes and goes. Measured: 30' },
      exposure: { value: 1.1, min: 0.1, max: 3, help: 'Brightness of the pen under the lamps of the scene, before its filmic curve. Set by eye against frames of the reference' },
      gloss: { value: 0.3, min: 0, max: 2, help: 'How much of its own small room the lacquer reflects. Measured: 0.3 on the barrel' },
      shadow: { value: 1, min: 0, max: 1, step: 1, help: '1: the pen throws a shadow on the pages. 0: none' },
      shadowSpread: { value: 0.374, min: 0, max: 2, help: 'How much wider than the pen its shadow is at the cap, in model units of a pen 5.62 long. Measured: 0.374' },
      shadowThin: { value: 0.6, min: 0, max: 1, help: 'How much of the shadow is left at the cap, where the pen is furthest from the paper. Measured: 0.6' },
    },
    onChange: () => {
      paint();
      ctx.invalidate();
    },
  });

  const shape = penMeshes();
  const room = glossRoom(engine);
  const nibMat = new MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
  const collarMat = new MeshPhysicalMaterial({ roughness: 0.35, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.1, envMap: room });
  const bodyMat = new MeshPhysicalMaterial({ roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, envMap: room });
  // Measured: the reference draws its whole scene through a filmic curve, which is what makes lacquer in a strong
  // light pale instead of garish. The books here are drawn without one, so the pen brings its own.
  for (const m of [nibMat, collarMat, bodyMat]) {
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('void main() {', `${FILMIC}void main() {`).replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = penFilmic( gl_FragColor.rgb );');
    };
    m.customProgramCacheKey = () => 'casebound-pen-filmic';
  }
  // The shadow, as read on the reference: where the nib meets the paper it is as narrow and as dark as the pen;
  // toward the cap, further from the paper, it is wider and thinner. In the shadow pass the pen is swollen along
  // its normals and let through in part, more so toward the cap and toward its outline as the lamp sees it.
  const cast = { uSwell: { value: 0.374 }, uThin: { value: 0.6 }, uPivot: { value: shape.pivot }, uLength: { value: shape.length } };
  const shadowMat = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  shadowMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, cast);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `uniform float uSwell;
uniform float uPivot;
uniform float uLength;
varying float vPenHigh;
varying float vPenFace;
void main() {`)
      .replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          'vPenHigh = smoothstep( 0.1, 1.0, ( position.y + uPivot ) / uLength );',
          'transformed += normalize( normal ) * uSwell * vPenHigh;',
          // How squarely the point faces the lamp, read across the barrel only: the normal without its part along
          // the pen, and of that the share that points at the lamp, over the most a normal of this pen can reach.
          'vec3 penAlong = normalize( mat3( modelViewMatrix ) * vec3( 0.0, 1.0, 0.0 ) );',
          'vec3 penRound = mat3( modelViewMatrix ) * vec3( normal.x, 0.0, normal.z );',
          'float penReach = length( penRound ) * sqrt( max( 0.0, 1.0 - penAlong.z * penAlong.z ) );',
          'vPenFace = penReach > 1e-4 ? clamp( penRound.z / penReach, -1.0, 1.0 ) : 0.0;',
        ].join(String.fromCharCode(10)),
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `uniform float uThin;
varying float vPenHigh;
varying float vPenFace;
void main() {`)
      .replace(
        '#include <clipping_planes_fragment>',
        [
          '#include <clipping_planes_fragment>',
          'float penSoft = smoothstep( 0.0, 1.0, vPenFace * vPenFace );',
          'float penCover = ( 1.0 - vPenHigh * ( 1.0 - uThin ) ) * ( 1.0 - vPenHigh * ( 1.0 - penSoft ) );',
          'if ( fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) > penCover ) discard;',
        ].join(String.fromCharCode(10)),
      );
  };
  shadowMat.customProgramCacheKey = () => 'casebound-pen-shadow';
  const group = new Group();
  group.name = 'marker.pen';
  group.visible = false;
  const parts: Mesh[] = [
    new Mesh(geometry(shape.nib), nibMat),
    new Mesh(geometry(shape.collar), collarMat),
    new Mesh(geometry(shape.body), bodyMat),
    new Mesh(geometry(shape.dome), bodyMat),
  ];
  for (const m of parts) {
    m.castShadow = true;
    m.receiveShadow = false;
    m.customDepthMaterial = shadowMat;
    m.frustumCulled = false;
    group.add(m);
  }
  ctx.scene.add(group);

  // The footprint: the place a press would paint, dyed onto the page like ink.
  const footMat = new MeshBasicMaterial({ blending: MultiplyBlending, premultipliedAlpha: true, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  const foot = new Mesh(new PlaneGeometry(1, 1), footMat);
  foot.name = 'marker.footprint';
  foot.visible = false;
  foot.renderOrder = 3;
  ctx.scene.add(foot);

  let color: PenColor | null = null;
  const body = new Color();
  const seen = { r: 1, g: 1, b: 1 };
  /** Gives the parts the colours of the pen that is out. */
  const paint = (): void => {
    if (!color) return;
    nibMat.color.set(color.nib).multiplyScalar(t.exposure);
    collarMat.color.set(color.collar).multiplyScalar(t.exposure);
    bodyMat.color.set(color.body).multiplyScalar(t.exposure);
    collarMat.envMapIntensity = t.gloss * (0.25 / 0.3);
    bodyMat.envMapIntensity = t.gloss;
    body.set(color.body);
    for (const m of parts) m.castShadow = t.shadow >= 0.5;
    cast.uSwell.value = t.shadowSpread;
    cast.uThin.value = t.shadowThin;
  };

  const state = createPen();
  let onPage = false;
  let release: (() => void) | null = null;
  let hidCursor = false;
  const setCursor = (hide: boolean): void => {
    if (hide === hidCursor) return;
    hidCursor = hide;
    // Controls keep their own cursor: only what inherits from the root loses it.
    document.documentElement.style.cursor = hide ? 'none' : '';
  };
  const hide = (): void => {
    group.visible = false;
    foot.visible = false;
    onPage = false;
    restPen(state);
    state.footprint = 0;
    setCursor(false);
    release?.();
    release = null;
  };

  const origin = new Vector3();
  const dir = new Vector3();
  const toCam = new Vector3();
  const up = new Vector3();
  const right = new Vector3();
  const axis = new Vector3();
  const zAxis = new Vector3();
  const basis = new Matrix4();
  const q = new Quaternion();
  const turn = new Quaternion();
  const corner = new Vector3();
  const pageUp = new Vector3();
  const pageRight = new Vector3();
  const pageN = new Vector3();
  const Y = new Vector3(0, 1, 0);

  const unsub = ctx.onFrame('effects', (f) => {
    const h = hand();
    const book = reader.book;
    const p = h.pointer;
    if (!h.on || !book || !reader.isOpen || !p) return hide();
    if (h.color !== color) {
      color = h.color;
      paint();
    }
    // On a page the pen stands under the pointer. Beside the book it waits on the nearest page edge. Over a
    // control that covers a page it is out of the way.
    const under = reader.pageAt(p.x, p.y);
    if (p.blocked && under) return hide();
    const hit = p.blocked ? null : under;
    const near = hit ? null : reader.pageNear(p.x, p.y);
    const at = hit ?? near;
    if (!at) return hide();
    onPage = !!hit;
    stepPen(state, { x: p.x, y: p.y, onPage, pressed: h.pressed }, f.dt, { ...PEN_DEFAULT, ...t });

    // The ray of the pointer, or of the place on the edge.
    const rect = ctx.canvas.getBoundingClientRect();
    const sx = near ? near.x : p.x;
    const sy = near ? near.y : p.y;
    origin.setFromMatrixPosition(ctx.camera.matrixWorld);
    dir.set(((sx - rect.left) / Math.max(1, rect.width)) * 2 - 1, 1 - ((sy - rect.top) / Math.max(1, rect.height)) * 2, 0.5).unproject(ctx.camera).sub(origin).normalize();
    toCam.copy(dir).negate();
    up.set(0, 1, 0).transformDirection(ctx.camera.matrixWorld);
    up.addScaledVector(toCam, -up.dot(toCam)).normalize();
    right.crossVectors(up, toCam).normalize();

    // The pen's own frame: its length leans toward the reader, it swings about the line of sight, and it is
    // turned a little about itself.
    const lean = penLean(state, { ...PEN_DEFAULT, ...t });
    axis.copy(up).multiplyScalar(Math.cos(lean)).addScaledVector(toCam, Math.sin(lean)).normalize();
    zAxis.crossVectors(right, axis).normalize();
    q.setFromRotationMatrix(basis.makeBasis(right, axis, zAxis));
    q.premultiply(turn.setFromAxisAngle(toCam, state.roll));
    q.multiply(turn.setFromAxisAngle(Y, t.twist));
    const scale = Math.max(1e-3, (t.length * book.dims.pageH * book.root.scale.x) / shape.length);

    // Back along the ray until the lowest corner of the nib is clear of the paper.
    const facing = Math.max(0.15, -dir.dot(at.normal));
    let back = 0;
    for (let i = 0; i < shape.corners.length; i += 3) {
      corner.set(shape.corners[i]!, shape.corners[i + 1]!, shape.corners[i + 2]!).multiplyScalar(scale).applyQuaternion(q);
      back = Math.max(back, (t.clearance - corner.dot(at.normal)) / facing);
    }
    // Its length after the swing, for the hover along its own axis.
    axis.set(0, 1, 0).applyQuaternion(q);
    group.position.copy(at.point).addScaledVector(dir, -back).addScaledVector(axis, t.hover * state.lift * shape.length * scale);
    group.quaternion.copy(q);
    group.scale.setScalar(scale);
    group.visible = true;

    // The footprint lies in the page, as wide and as high as the line a press would draw.
    if (state.footprint > 0.01 && onPage && t.footprint > 0) {
      pageN.copy(at.normal).normalize();
      pageUp.set(0, 1, 0).transformDirection(book.volume.group.matrixWorld);
      pageRight.crossVectors(pageUp, pageN).normalize();
      pageUp.crossVectors(pageN, pageRight).normalize();
      foot.quaternion.setFromRotationMatrix(basis.makeBasis(pageRight, pageUp, pageN));
      foot.position.copy(at.point).addScaledVector(toCam, 0.01);
      const s = book.root.scale.x;
      foot.scale.set(h.width * book.dims.pageW * s, h.width * book.dims.pageH * s, 1);
      body.getRGB(seen, SRGBColorSpace);
      footMat.color.setRGB(1 - state.footprint * (1 - seen.r), 1 - state.footprint * (1 - seen.g), 1 - state.footprint * (1 - seen.b), SRGBColorSpace);
      foot.visible = true;
    } else foot.visible = false;

    setCursor(onPage);
    // While it swings or settles the picture has to be drawn again.
    const moving = penMoving(state) || Math.abs(state.footprint - (onPage && !h.pressed ? t.footprint : 0)) > 0.005 || Math.abs(state.lift - (h.pressed && onPage ? 0 : 1)) > 0.002;
    if (moving) release ??= ctx.lease('marker.pen');
    else {
      release?.();
      release = null;
    }
  });

  return {
    get onPage() {
      return onPage;
    },
    dispose: () => {
      unsub();
      hide();
      group.removeFromParent();
      foot.removeFromParent();
      for (const m of parts) m.geometry.dispose();
      foot.geometry.dispose();
      shadowMat.dispose();
      nibMat.dispose();
      collarMat.dispose();
      bodyMat.dispose();
      footMat.dispose();
      room.dispose();
      ctx.registry.remove('marker.pen');
    },
  };
}
