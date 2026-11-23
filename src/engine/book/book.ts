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
import type { Registry } from '../core/registry';
import { makeDims, type BookDims } from './dims';
import { COVER_RELIEF, DEFAULT_FACES, GRAIN_PER_UNIT, edgeTexture, endpaperTexture, grainTexture, paintCover, paintPage, type CoverDesign, type CoverRelief, type CoverTextures, type PageContent, type Typefaces } from './painter';
import { CLOTH, PAGE_PAPER, createEdgeMaterial, createSurfaceMaterial, type ClothParams, type SurfaceFx } from './surface';
import { Volume } from './volume';
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

  private readonly textures: Texture[] = [];
  private readonly materials: Material[] = [];
  private readonly pageMaterials: { left: ReturnType<typeof createSurfaceMaterial>; right: ReturnType<typeof createSurfaceMaterial> };
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
        fx,
      });
    // The left page is drawn mirrored along the stack, so its spine edge is on the right of its picture.
    this.pageMaterials = { left: page(blank, 1), right: page(blank, 0) };
    const endpaper = createSurfaceMaterial({
      map: end,
      grain: paper,
      grainRepeat: [dims.coverW * GRAIN_PER_UNIT.paper, dims.coverH * GRAIN_PER_UNIT.paper],
      grainPerUnit: GRAIN_PER_UNIT.paper,
      cloth: { ...CLOTH.paper, ...PAGE_PAPER },
      shininess: 12,
      reflectiveness: 0.2,
      bumpGrain: 0.04,
      fx,
    });
    end.repeat.set(6, 4);
    const edgeMat = createEdgeMaterial(edge);

    // Temporary cover material so the volume can be built; replaced right below once the atlas is known.
    const volume = (this.volume = new Volume(dims, { cover: endpaper, endpaper, pageLeft: this.pageMaterials.left, pageRight: this.pageMaterials.right, edge: edgeMat }));
    const atlas = volume.atlas;
    const cover = (this.cover = this.paintCover(relief));
    const stripLength = atlas.aspect * dims.coverH;
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
    this.materials.push(coverMat, endpaper, edgeMat, this.pageMaterials.left, this.pageMaterials.right);

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

  /** Replaces the texture on one of the two visible pages. */
  setPage(side: 'left' | 'right', map: Texture): void {
    const m = this.pageMaterials[side];
    if (m.map === map) return;
    m.map = map;
    m.needsUpdate = true;
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
      split: this.open > 0 ? this.reading : 0,
      turn: this.pages,
    };
    this.volume.setPose(pose);
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
  }
}
