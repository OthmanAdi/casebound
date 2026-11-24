/**
 * One book in the scene: its record (data), its generated textures and materials, and its volume.
 *
 * Group chain, outermost first:
 *   root  - where the shelf or the reader puts the book (position, pose)
 *   tilt  - small pointer tilt
 *   spin  - the reader's own rotation of the book, plus the yaw that presents the cover or the spread
 *   volume.group - the geometry, in the open-book frame
 */
import { Group, Quaternion, Vector3, type Material, type Texture } from 'three';
import { DEG } from '../core/math';
import type { ParamSpec, Registry } from '../core/registry';
import { makeDims, type BookDims } from './dims';
import { COVER_RELIEF, DEFAULT_FACES, GRAIN_PER_UNIT, edgeTexture, endpaperTexture, grainTexture, paintCover, paintPage, type CoverDesign, type CoverRelief, type CoverTextures, type PageContent, type Typefaces } from './painter';
import { CLOTH, PAGE_PAPER, createEdgeMaterial, createSurfaceMaterial, setOverlay, type ClothParams, type SurfaceFx } from './surface';
import { Volume, type ChunkPose } from './volume';
import { hashString } from '../core/math';

export interface BookRecord {
  slug: string;
  title: string;
  subtitle?: string;
  author: string;
  /** Page count. Sets the number of leaves and, unless `thickness` is given, the thickness. */
  pages?: number;
  /** Closed thickness in world units, about 1.6 to 3.0. */
  thickness?: number;
  /** Colour behind the book on its panel. Also tints the light in the colour theme. */
  background?: string;
  /** Colour of the paper: pages and page edges. Default a cool white. An old book reads well on cream, for example "#e9e2cd". */
  paper?: string;
  /** Year of first publication, shown next to the title. */
  year?: number;
  /** A few sentences about the book, for the detail view. */
  blurb?: string;
  /** Where the text comes from. */
  source?: { name: string; id?: number; url?: string; note?: string };
  imprint?: string;
  cover: CoverDesign;
  /** Overrides for the surface model. */
  material?: {
    shininess?: number;
    reflectiveness?: number;
    bumpGrain?: number;
    bumpEmboss?: number;
    foilSpecular?: number;
    foilDetail?: number;
    cloth?: Partial<ClothParams>;
  };
  /** Body text, one string per paragraph. The reader flows it over the pages. */
  text?: string[];
  /** Chapter headings by the paragraph index they stand before. */
  headings?: Record<number, string>;
}

/**
 * Width of the cloth that is turned in over the edges of the boards, world units. It has to be wider than the
 * boards stand out beyond the pages (0.335), or endpaper shows beside the page block. Range 0.4 to 2; on a real
 * book it is about 1.4.
 */
export const TURN_IN = 0.7;

/**
 * The cover material of one book as live parameters, so its look can be tried on the running page. The values
 * last until reload: to keep one, write it into the book's `book.json` under the field named in its help.
 */
export function coverParams(mat: ReturnType<typeof createSurfaceMaterial>): ParamSpec[] {
  const u = mat.userData.uniforms as Record<string, { value: number }>;
  const uniform = (key: string, name: string, min: number, max: number, help: string): ParamSpec => ({
    key, label: key, type: 'number', min, max, help,
    get: () => u[name]!.value,
    set: (v) => {
      u[name]!.value = v as number;
    },
  });
  return [
    { key: 'shininess', label: 'shininess', type: 'number', min: 1, max: 40, help: 'Tightness of the highlight. Measured 3.3 to 21.4, median 9.9. `material.shininess`', get: () => mat.shininess, set: (v) => void (mat.shininess = v as number) },
    { key: 'reflectiveness', label: 'reflectiveness', type: 'number', min: 0, max: 1.2, help: 'Strength of the highlight. Measured 0.17 to 1.01, median 0.5. `material.reflectiveness`', get: () => mat.specular.r, set: (v) => void mat.specular.setScalar(v as number) },
    uniform('bumpGrain', 'uBumpGrain', 0, 0.2, 'Depth of the grain of the binding material. Measured 0.01 to 0.10, median 0.055. `material.bumpGrain`'),
    uniform('bumpEmboss', 'uBumpEmboss', 0, 0.4, 'Depth of stamped type and ornament. Measured 0.05 to 0.25, median 0.119. `material.bumpEmboss`'),
    uniform('foilSpecular', 'uFoilSpecular', -0.5, 2.5, 'Added to the strength of the highlight where there is foil. Measured -0.49 to 2.2, median 0. `material.foilSpecular`'),
    uniform('foilDetail', 'uFoilDetail', 0, 8, 'How fast the tone of the foil changes across the cover and as the book turns. Measured 0.4 to 6.3, median 2.6. `material.foilDetail`'),
    uniform('foilRainbow', 'uFoilRainbow', 0, 1, '0 is plain metal, 1 is fully iridescent. `cover.foilRainbow`'),
    uniform('gloss', 'uGloss', 0, 1.5, 'Share of the highlight that cloth keeps. Measured 0.31 to 1.12. `material.cloth.gloss`'),
    uniform('sheen', 'uSheen', 0, 1.5, 'Soft lift of fabric toward grazing light. Measured 0.19 to 0.82. `material.cloth.sheen`'),
    uniform('sheenRough', 'uSheenRough', 0.05, 1, 'Width of the sheen, higher is broader. `material.cloth.sheenRough`'),
    uniform('wrap', 'uWrap', 0, 1, 'How far light creeps past the edge of the shade. `material.cloth.wrap`'),
    uniform('weave', 'uWeave', 0, 1, 'Darkening of the gaps between threads, seen from close by. Measured 0.01 to 0.32. `material.cloth.weave`'),
    uniform('fibre', 'uFibre', 0, 0.2, 'Fine fibre streaks, seen from close by. Measured 0 to 0.068. `material.cloth.fibre`'),
    uniform('mottle', 'uMottle', 0, 0.1, 'Soft blotches in colour and relief that do not fade with distance. `material.cloth.mottle`'),
    uniform('relief', 'uGrainRelief', 0, 1, 'How much of the grain tile is real relief. Times bumpGrain it is the depth of the grain. `material.cloth.relief`'),
  ];
}

/** Opening angle of each board when the book lies open at its middle (SPEC S-RD-3: 28 degrees x 3.36). */
export const OPEN_ANGLE = 94 * DEG;

export class Book {
  readonly root = new Group();
  readonly tilt = new Group();
  readonly spin = new Group();
  readonly volume: Volume;
  readonly dims: BookDims;
  /** 0 = closed, 1 = open. */
  open = 0;
  /** Reading progress 0..1: the share of leaves on the left. */
  reading = 0.5;
  /**
   * Page progress 0..1. A book opens in two stages: first the front cover swings all the way round, showing
   * the first page, then the pages part to the place where it is being read.
   */
  pages = 1;
  /** Yaw that presents the closed cover to the camera. */
  presentYaw = Math.PI / 2;
  /**
   * Shift of the reading place as far as the case is concerned, as a share of the book. The stacks keep their
   * leaves; the spine rolls as if the book were open that much later (or, negative, earlier). See reader/push.ts.
   */
  push = 0;
  /** A turn the closed book was given by hand: pitch about X and yaw about Y, radians. It fades as the book opens. */
  readonly turned = { pitch: 0, yaw: 0 };
  /** How far each cover is lifted off the pages of the closed book, radians. */
  readonly flap = { front: 0, back: 0 };
  /** Where the shelf wants this book. The root follows it unless a view holds the book. */
  readonly home = { position: new Vector3(), quaternion: new Quaternion(), scale: 1 };
  /** True while a view such as the reader places the root itself. */
  held = false;
  /**
   * Says which overlay lies on a page, given the page's own picture: the marks of a pen, say. Null for none. Set by
   * the view that paints the pages; the turning leaves ask it too.
   */
  overlayFor: ((map: Texture) => Texture | null) | null = null;
  /** Held by the reader, but its cover has not started to move yet: on the shelf it still follows the pointer. */
  poised = false;
  /**
   * A bundle of leaves in the air (see `ChunkPose`), with `under`: the share of the leaves that lie under it on
   * the left. While there is one the stacks go by it and `reading` only places the case. Set by the reader.
   */
  bundle: (ChunkPose & { under: number }) | null = null;

  private readonly textures: Texture[] = [];
  private readonly materials: Material[] = [];
  private readonly pageMaterials: Record<'left' | 'right' | 'bundleTop' | 'bundleUnder', ReturnType<typeof createSurfaceMaterial>>;
  private readonly coverMaterial: ReturnType<typeof createSurfaceMaterial>;
  private cover: CoverTextures;

  constructor(
    readonly record: BookRecord,
    private readonly registry: Registry,
    fx: SurfaceFx,
    readonly faces: Typefaces = DEFAULT_FACES,
    relief: CoverRelief = COVER_RELIEF,
  ) {
    const dims = (this.dims = makeDims({ pages: record.pages, thickness: record.thickness }));
    const seed = record.cover.seed ?? hashString(record.slug);
    const grainKind = record.cover.grain ?? 'buckram';
    const cloth: ClothParams = { ...CLOTH[grainKind], ...record.material?.cloth };
    const foil = record.cover.foil && record.cover.foil !== 'none' ? record.cover.foil : null;

    // The volume needs materials, the painter needs the volume's atlas layout: build with placeholders first.
    const paper = grainTexture('paper');
    const blank = paintPage({ folio: null, left: true }, dims.pageW / dims.pageH, faces, 256, record.paper);
    const edge = edgeTexture(seed, record.paper);
    const end = endpaperTexture(record.cover, seed);
    this.textures.push(blank, edge, end);

    const page = (map: Texture, gutter: 0 | 1): ReturnType<typeof createSurfaceMaterial> =>
      createSurfaceMaterial({
        map,
        gutter,
        grain: paper,
        grainRepeat: [dims.pageW * GRAIN_PER_UNIT.paper, dims.pageH * GRAIN_PER_UNIT.paper],
        grainPerUnit: GRAIN_PER_UNIT.paper,
        // Printed pages are smooth: their tooth is the film grain, not the mottle of a cover material.
        cloth: { ...CLOTH.paper, ...PAGE_PAPER, weave: 0.03, fibre: 0.012, sheen: 0.05, mottle: 0 },
        shininess: 12.5,
        reflectiveness: 0.39 * 0.6,
        bumpGrain: 0.05,
        overlay: true,
        fx,
      });
    // The left page is drawn mirrored along the stack, so its spine edge is on the right of its picture.
    // A bundle in the air has a page on both faces: a right-hand one on top and a left-hand one underneath.
    this.pageMaterials = { left: page(blank, 1), right: page(blank, 0), bundleTop: page(blank, 0), bundleUnder: page(blank, 1) };
    const endpaper = createSurfaceMaterial({
      map: end,
      grain: paper,
      grainRepeat: [dims.coverW * GRAIN_PER_UNIT.paper, dims.coverH * GRAIN_PER_UNIT.paper],
      grainPerUnit: GRAIN_PER_UNIT.paper,
      cloth: { ...CLOTH.paper, ...PAGE_PAPER },
      shininess: 12,
      reflectiveness: 0.2,
      bumpGrain: 0.04,
      // The margin is set below, once the length of the case is known.
      turnIn: { color: record.cover.cloth, margin: [0, 0], repeat: [6, 4] },
      fx,
    });
    end.repeat.set(6, 4);
    const edgeMat = createEdgeMaterial(edge, undefined, fx.uEdgeEnds, dims.pageW);

    // Temporary cover material so the volume can be built; replaced right below once the atlas is known.
    const volume = (this.volume = new Volume(dims, {
      cover: endpaper,
      endpaper,
      pageLeft: this.pageMaterials.left,
      pageRight: this.pageMaterials.right,
      edge: edgeMat,
      chunkTop: this.pageMaterials.bundleTop,
      chunkUnder: this.pageMaterials.bundleUnder,
    }));
    const atlas = volume.atlas;
    const cover = (this.cover = this.paintCover(relief));
    const stripLength = atlas.aspect * dims.coverH;
    (endpaper.userData.uniforms as { uTurnIn: { value: { set(x: number, y: number, z: number, w: number): void } } }).uTurnIn.value.set(TURN_IN / stripLength, TURN_IN / dims.coverH, 6, 4);
    const coverMat = (this.coverMaterial = createSurfaceMaterial({
      map: cover.map,
      grain: grainTexture(grainKind),
      grainRepeat: [stripLength * GRAIN_PER_UNIT[grainKind], dims.coverH * GRAIN_PER_UNIT[grainKind]],
      grainPerUnit: GRAIN_PER_UNIT[grainKind],
      emboss: cover.emboss,
      finish: foil ? cover.finish : null,
      cloth,
      shininess: record.material?.shininess ?? 9.9,
      reflectiveness: record.material?.reflectiveness ?? 0.5,
      bumpGrain: record.material?.bumpGrain ?? 0.055,
      bumpEmboss: record.material?.bumpEmboss ?? 0.119,
      foilColor: foil ?? undefined,
      foilRainbow: record.cover.foilRainbow ?? 0,
      foilSpecular: record.material?.foilSpecular ?? 0,
      foilDetail: record.material?.foilDetail ?? 2.6,
      joint: { back: atlas.back[1], front: atlas.front[0], half: atlas.hinge, length: stripLength },
      fx,
    }));
    volume.caseMesh.material = [coverMat, endpaper];
    this.materials.push(coverMat, endpaper, edgeMat, ...Object.values(this.pageMaterials));

    this.root.name = `book.${record.slug}`;
    this.root.add(this.tilt);
    this.tilt.add(this.spin);
    this.spin.add(volume.group);
    this.applyPose();

    registry.add({
      id: `book.${record.slug}`,
      label: record.title,
      kind: 'book',
      tags: ['book', 'object'],
      object: this.root,
      describe: `${record.title} by ${record.author}. ${dims.leaves} leaves, ${dims.thickness.toFixed(2)} thick.`,
      source: `content/books/${record.slug}/book.json`,
      params: [
        { key: 'open', label: 'Open', type: 'number', min: 0, max: 1, help: '0 closed, 1 lying open', get: () => this.open, set: (v) => this.setOpen(v as number, this.reading) },
        { key: 'reading', label: 'Reading progress', type: 'number', min: 0, max: 1, help: 'Share of the leaves on the left side', get: () => this.reading, set: (v) => this.setOpen(this.open, v as number) },
        ...coverParams(coverMat),
      ],
    });
  }

  /** Sets how far the book is open, where in the book it is open, and how far the pages have parted. */
  setOpen(open: number, reading = this.reading, pages = this.pages): void {
    this.open = open;
    this.reading = reading;
    this.pages = pages;
    this.applyPose();
  }

  /** Replaces the texture on one of the two visible pages, or on a face of a bundle in the air. */
  setPage(side: 'left' | 'right' | 'bundleTop' | 'bundleUnder', map: Texture): void {
    const m = this.pageMaterials[side];
    setOverlay(m, this.overlayFor?.(map) ?? null);
    if (m.map === map) return;
    m.map = map;
    m.needsUpdate = true;
  }

  /** Looks the overlays of the pages on show up again, after a page got one or lost it. */
  refreshOverlays(): void {
    for (const m of Object.values(this.pageMaterials)) setOverlay(m, (m.map && this.overlayFor?.(m.map)) || null);
  }

  /** Re-applies the pose after `push` or `presentYaw` changed. */
  refresh(): void {
    this.applyPose();
  }

  /** Turns the closed book and lifts its covers. The shape is only rebuilt when a cover moved. */
  setTurn(pitch: number, yaw: number, front = 0, back = 0): void {
    const lifted = Math.abs(front - this.flap.front) > 1e-4 || Math.abs(back - this.flap.back) > 1e-4;
    this.turned.pitch = pitch;
    this.turned.yaw = yaw;
    if (lifted) {
      this.flap.front = front;
      this.flap.back = back;
      this.applyPose();
    } else this.applyTurn();
  }

  private paintCover(relief: CoverRelief): CoverTextures {
    const r = this.record;
    return paintCover(r.cover, { title: r.title, subtitle: r.subtitle, author: r.author, imprint: r.imprint }, this.volume.atlas, this.faces, 2048, relief);
  }

  /** Paints the cover again, for instance after the shape of its relief was changed. */
  repaintCover(relief: CoverRelief): void {
    const old = this.cover;
    const cover = (this.cover = this.paintCover(relief));
    const uniforms = this.coverMaterial.userData.uniforms as Record<string, { value: unknown }>;
    this.coverMaterial.map = cover.map;
    uniforms.tEmboss!.value = cover.emboss;
    if (uniforms.tFinish!.value) uniforms.tFinish!.value = cover.finish;
    for (const t of [old.map, old.emboss, old.finish]) t.dispose();
  }

  paintPage(content: PageContent, height = 1536): Texture {
    return paintPage(content, this.dims.pageW / this.dims.pageH, this.faces, height, this.record.paper);
  }

  private applyPose(): void {
    // Until the pages part, every leaf lies on the back board and the front cover alone opens (SPEC S-RD-3).
    // A closed book keeps all its leaves on the back board too, so a lifted cover lifts alone.
    const n = this.open > 0 ? Math.min(Math.max(this.reading + this.push, 0), 1) * this.pages : 0;
    const closed = 1 - this.open;
    // The pages part by turning everything before the reading place over in one wad, first leaf up until it lands.
    // The volume lets both stacks trail their boards on the way (see `VolumePose.turn`).
    const pose = {
      front: this.open * OPEN_ANGLE * (2 - 2 * n) + this.flap.front * closed,
      back: this.open * OPEN_ANGLE * 2 * n + this.flap.back * closed,
      split: this.open > 0 ? (this.bundle ? this.bundle.under : this.reading) : 0,
      turn: this.pages,
      chunk: this.open > 0 && this.bundle ? this.bundle : undefined,
    };
    this.volume.setPose(pose);
    if (this.bundle) {
      // Rings lift both faces of the bundle alike, by where it is across the spread, as they do a single leaf.
      const side = Math.cos(Math.PI * this.bundle.turn);
      for (const m of [this.pageMaterials.bundleTop, this.pageMaterials.bundleUnder]) (m.userData.uniforms as { uRingSide: { value: number } }).uRingSide.value = side;
    }
    // The joint relief follows the hinges: a quarter turn when the book is closed, none when a board lies flat.
    const hinge = (this.coverMaterial.userData.uniforms as { uHinge: { value: { set(x: number, y: number): void } } }).uHinge;
    hinge.value.set(Math.max(0, Math.PI / 2 - pose.back), Math.max(0, Math.PI / 2 - pose.front));
    this.applyTurn();
  }

  private applyTurn(): void {
    const n = this.open > 0 ? Math.min(Math.max(this.reading + this.push, 0), 1) * this.pages : 0;
    const closed = 1 - this.open;
    // Present the cover when closed; when open, turn so the spread faces the camera wherever the book is open.
    // With the pages not yet parted that is almost the same direction the cover faced, so the book only
    // turns once the pages part. The boards therefore keep their place whatever the reading place is: a shift
    // of it rolls the spine and nothing else.
    const facing = (this.open * OPEN_ANGLE * (2 - 2 * n) - this.open * OPEN_ANGLE * 2 * n) / 2;
    this.spin.rotation.set(this.turned.pitch * closed, (this.presentYaw + this.turned.yaw) * closed + facing, 0);
    // Closed, the book turns about its middle. Open, it turns about its spine.
    this.volume.group.position.z = -this.volume.closedCentreZ * closed;
  }

  dispose(): void {
    this.registry.remove(`book.${this.record.slug}`);
    this.root.removeFromParent();
    for (const t of [...this.textures, this.cover.map, this.cover.emboss, this.cover.finish]) t.dispose();
    for (const m of this.materials) m.dispose();
    this.volume.caseMesh.geometry.dispose();
    this.volume.leftBlock.geometry.dispose();
    this.volume.rightBlock.geometry.dispose();
    this.volume.chunkBlock.geometry.dispose();
  }
}
