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
import { DEFAULT_FACES, GRAIN_PER_UNIT, edgeTexture, endpaperTexture, grainTexture, paintCover, paintPage, type CoverDesign, type PageContent, type Typefaces } from './painter';
import { CLOTH, createEdgeMaterial, createSurfaceMaterial, type ClothParams, type SurfaceFx } from './surface';
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
  /** Yaw that presents the closed cover to the camera. */
  presentYaw = Math.PI / 2;
  /** Extra yaw of the open book, for leaning toward the pointer. */
  lean = 0;
  /** Where the shelf wants this book. The root follows it unless a view holds the book. */
  readonly home = { position: new Vector3(), quaternion: new Quaternion(), scale: 1 };
  /** True while a view such as the reader places the root itself. */
  held = false;

  private readonly textures: Texture[] = [];
  private readonly materials: Material[] = [];
  private readonly pageMaterials: { left: ReturnType<typeof createSurfaceMaterial>; right: ReturnType<typeof createSurfaceMaterial> };

  constructor(
    readonly record: BookRecord,
    private readonly registry: Registry,
    fx: SurfaceFx,
    readonly faces: Typefaces = DEFAULT_FACES,
  ) {
    const dims = (this.dims = makeDims({ pages: record.pages, thickness: record.thickness }));
    const seed = record.cover.seed ?? hashString(record.slug);
    const grainKind = record.cover.grain ?? 'buckram';
    const cloth: ClothParams = { ...CLOTH[grainKind], ...record.material?.cloth };
    const foil = record.cover.foil && record.cover.foil !== 'none' ? record.cover.foil : null;

    // The volume needs materials, the painter needs the volume's atlas layout: build with placeholders first.
    const paper = grainTexture('paper');
    const blank = paintPage({ folio: null, left: true }, dims.pageW / dims.pageH, faces, 256);
    const edge = edgeTexture(seed);
    const end = endpaperTexture(record.cover, seed);
    this.textures.push(blank, edge, end);

    const page = (map: Texture): ReturnType<typeof createSurfaceMaterial> =>
      createSurfaceMaterial({
        map,
        grain: paper,
        grainRepeat: [dims.pageW * GRAIN_PER_UNIT.paper, dims.pageH * GRAIN_PER_UNIT.paper],
        cloth: { ...CLOTH.paper, weave: 0.03, fibre: 0.012, sheen: 0.05 },
        shininess: 12.5,
        reflectiveness: 0.39 * 0.6,
        bumpGrain: 0.05,
        fx,
      });
    this.pageMaterials = { left: page(blank), right: page(blank) };
    const endpaper = createSurfaceMaterial({
      map: end,
      grain: paper,
      grainRepeat: [dims.coverW * GRAIN_PER_UNIT.paper, dims.coverH * GRAIN_PER_UNIT.paper],
      cloth: CLOTH.paper,
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
    const cover = paintCover(record.cover, { title: record.title, subtitle: record.subtitle, author: record.author, imprint: record.imprint }, atlas, faces);
    const stripLength = atlas.aspect * dims.coverH;
    const coverMat = createSurfaceMaterial({
      map: cover.map,
      grain: grainTexture(grainKind),
      grainRepeat: [stripLength * GRAIN_PER_UNIT[grainKind], dims.coverH * GRAIN_PER_UNIT[grainKind]],
      emboss: cover.emboss,
      finish: foil ? cover.finish : null,
      cloth,
      shininess: record.material?.shininess ?? 9.9,
      reflectiveness: record.material?.reflectiveness ?? 0.5,
      bumpGrain: record.material?.bumpGrain ?? 0.055,
      bumpEmboss: record.material?.bumpEmboss ?? 0.119,
      foilColor: foil ?? undefined,
      foilRainbow: record.cover.foilRainbow ?? 0,
      foilSpecular: record.material?.foilSpecular ?? 1.2,
      foilDetail: record.material?.foilDetail ?? 2.6,
      fx,
    });
    volume.caseMesh.material = [coverMat, endpaper];
    this.textures.push(cover.map, cover.emboss, cover.finish);
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

  /** Sets how far the book is open and where in the book it is open. */
  setOpen(open: number, reading = this.reading): void {
    this.open = open;
    this.reading = reading;
    this.applyPose();
  }

  /** Replaces the texture on one of the two visible pages. */
  setPage(side: 'left' | 'right', map: Texture): void {
    const m = this.pageMaterials[side];
    if (m.map === map) return;
    m.map = map;
    m.needsUpdate = true;
  }

  /** Re-applies the pose after `lean` or `presentYaw` changed. */
  refresh(): void {
    this.applyPose();
  }

  paintPage(content: PageContent, height = 1536): Texture {
    return paintPage(content, this.dims.pageW / this.dims.pageH, this.faces, height);
  }

  private applyPose(): void {
    const n = this.reading;
    const front = this.open * OPEN_ANGLE * (2 - 2 * n);
    const back = this.open * OPEN_ANGLE * 2 * n;
    this.volume.setPose({ front, back, split: n });
    // Present the cover when closed; when open, turn so the spread faces the camera wherever the book is open.
    this.spin.rotation.y = this.presentYaw * (1 - this.open) + (front - back) / 2 + this.lean * this.open;
    // Closed, the book turns about its middle. Open, it turns about its spine.
    this.volume.group.position.z = -this.volume.closedCentreZ * (1 - this.open);
  }

  dispose(): void {
    this.registry.remove(`book.${this.record.slug}`);
    this.root.removeFromParent();
    for (const t of this.textures) t.dispose();
    for (const m of this.materials) m.dispose();
    this.volume.caseMesh.geometry.dispose();
    this.volume.leftBlock.geometry.dispose();
    this.volume.rightBlock.geometry.dispose();
  }
}
