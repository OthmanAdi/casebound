/**
 * Bare test stage: one book, no site around it. Drive it from the URL:
 *   ?open=0..1  ?reading=0..1  ?theme=light|colour|dark  ?pose=rest|front|flat  ?slug=...
 * The engine is on `window.bindery` for inspection and for the capture tools.
 */
import { Euler } from 'three';
import { createEngine, type BookRecord } from '../src/engine';
import { DEG } from '../src/engine/core/math';
import type { ThemeName } from '../src/engine/stage/presets';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (q.has(k) ? Number(q.get(k)) : d);

const SAMPLE: BookRecord[] = [
  {
    slug: 'field-notes-on-light',
    title: 'Field Notes on Light',
    subtitle: 'How a page catches the day',
    author: 'A. Sample',
    pages: 320,
    thickness: 2.55,
    background: '#8a9a86',
    cover: { cloth: '#2f3b2a', ink: '#c9bd7a', accent: '#8f9a55', pattern: 'strata', foil: 'none', grain: 'buckram' },
  },
  {
    slug: 'the-marbled-hour',
    title: 'The Marbled Hour',
    author: 'B. Sample',
    pages: 260,
    thickness: 2.2,
    background: '#32506a',
    cover: { cloth: '#1f5a66', ink: '#d7a53a', accent: '#f0e2b0', pattern: 'marble', foil: '#d9b25a', grain: 'paper' },
  },
];

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const engine = createEngine({ canvas, books: SAMPLE, theme: (q.get('theme') as ThemeName) ?? 'light' });
const hud = document.getElementById('hud')!;

const slug = q.get('slug') ?? SAMPLE[0]!.slug;
const pose = q.get('pose') ?? 'rest';
for (const [i, book] of engine.books.entries()) {
  const shown = book.record.slug === slug;
  book.root.visible = shown;
  if (!shown) continue;
  engine.state.active = i;
  const open = num('open', 0);
  book.setOpen(open, num('reading', 0.5));
  engine.state.inside = open;
  book.root.position.set(0, -1.48, open > 0.5 ? -22 : -36);
  if (pose === 'rest') book.root.setRotationFromEuler(new Euler(-28 * DEG, 32 * DEG, 12 * DEG));
  else if (pose === 'flat') book.root.setRotationFromEuler(new Euler(-22 * DEG, 0, 0));
  else book.root.rotation.set(0, 0, 0);
  if (q.has('yaw')) book.root.rotation.y = num('yaw', 0) * DEG;
  if (open > 0.5) {
    book.setPage('left', book.paintPage({ folio: 116, left: true, head: book.record.title, paragraphs: Array(9).fill('The light that reaches a page has already been somewhere. It has crossed a room, grazed a wall, and lost a little of itself on the way. What arrives is softer than what set out, and it is this softness that lets ink sit quietly on paper.') }));
    book.setPage('right', book.paintPage({ folio: 117, left: false, head: 'Chapter two', heading: 'What the page keeps', paragraphs: Array(7).fill('A sheet held up to a window is not opaque. The words on its far side show through as a grey rumour, and for the length of a turn the leaf is a lantern. Then it falls, and the book is solid again.') }));
  }
}

if (q.has('holo')) engine.fx.uHolo.value = num('holo', 1);
if (q.has('radio')) engine.fx.uRadio.value = num('radio', 1);

engine.ctx.onFrame('after-render', () => {
  const info = engine.ctx.renderer.info;
  hud.textContent = `draws ${engine.ctx.loop.draws}  calls ${info.render.calls}  tris ${info.render.triangles}  theme ${engine.rig.theme}`;
});

engine.start();
Object.assign(window, { bindery: engine });
document.documentElement.dataset.binderyReady = 'true';
