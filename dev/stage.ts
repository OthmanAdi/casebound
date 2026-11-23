/**
 * Bare test stage: the engine with its shelf, reader, magnifier and effects, no site around it.
 *
 * URL: ?theme=light|colour|dark  ?reader=<slug>  ?page=<n>
 * Keys: Space open or close, arrows turn pages, m magnifier, h hologram, r radio, t next theme, Escape close.
 * Everything is on `window.casebound` for inspection and for the capture tools.
 */
import { createEngine, type BookRecord } from '../src/engine';
import { createMagnifier } from '../src/engine/effects/magnifier';
import { createSurfaceEffects } from '../src/engine/effects/surface-effects';
import { createReader } from '../src/engine/reader/reader';
import { createShelf } from '../src/engine/shelf/shelf';
import type { ThemeName } from '../src/engine/stage/presets';

const q = new URLSearchParams(location.search);

const PASSAGE = [
  'The light that reaches a page has already been somewhere. It has crossed a room, grazed a wall, and lost a little of itself on the way. What arrives is softer than what set out, and it is this softness that lets ink sit quietly on paper.',
  'A sheet held up to a window is not opaque. The words on its far side show through as a grey rumour, and for the length of a turn the leaf is a lantern. Then it falls, and the book is solid again.',
  'Cloth takes light differently. Each thread is a small cylinder, and a woven cover is a field of them lying in two directions. Seen straight on, the gaps between threads go dark. Seen at a slant, the whole surface lifts into a pale sheen.',
  'Foil is the opposite of cloth. It keeps nothing and returns everything, so its colour is borrowed from the lamp and from the angle. Tilt the book and the title changes its mind.',
  'None of this needs to be painted by hand. Give a surface the right few numbers and the day does the rest.',
];

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
    text: PASSAGE,
    headings: { 0: 'What the page keeps', 2: 'Cloth and foil' },
  },
  {
    slug: 'the-marbled-hour',
    title: 'The Marbled Hour',
    author: 'B. Sample',
    pages: 260,
    thickness: 2.2,
    background: '#32506a',
    cover: { cloth: '#1f5a66', ink: '#b9862c', accent: '#d8c08a', pattern: 'marble', foil: '#d9b25a', grain: 'paper' },
    text: PASSAGE,
  },
  {
    slug: 'a-quiet-grid',
    title: 'A Quiet Grid',
    author: 'C. Sample',
    pages: 420,
    thickness: 2.9,
    background: '#6a4a3a',
    cover: { cloth: '#7a2e22', ink: '#f0d9b0', pattern: 'grid', foil: '#e8e8ee', foilRainbow: 0.8, grain: 'buckram' },
    text: PASSAGE,
  },
];

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const engine = createEngine({ canvas, books: SAMPLE, theme: (q.get('theme') as ThemeName) ?? 'light' });
const shelf = createShelf(engine);
const reader = createReader(engine);
const magnifier = createMagnifier(engine);
const effects = createSurfaceEffects(engine);
const hud = document.getElementById('hud')!;

// One viewport of scrolling per book.
const spacer = document.createElement('div');
spacer.style.height = `${SAMPLE.length * 100}vh`;
document.body.append(spacer);

const themes: ThemeName[] = ['light', 'colour', 'dark'];
let holo = false;
let radio = false;
addEventListener('keydown', (e) => {
  const current = engine.books[engine.state.active]!.record.slug;
  if (e.key === ' ') {
    e.preventDefault();
    if (reader.isOpen) reader.close();
    else reader.open(current);
  } else if (e.key === 'Escape') reader.close();
  else if (e.key === 'ArrowRight') reader.next();
  else if (e.key === 'ArrowLeft') reader.previous();
  else if (e.key === 'm') magnifier.toggle();
  else if (e.key === 'h') effects.hologram((holo = !holo));
  else if (e.key === 'r') effects.radio((radio = !radio));
  else if (e.key === 't') engine.setTheme(themes[(themes.indexOf(engine.rig.theme) + 1) % themes.length]!);
});

if (q.has('reader')) reader.open(q.get('reader')!, q.has('page') ? Number(q.get('page')) : undefined);

engine.ctx.onFrame('after-render', () => {
  const info = engine.ctx.renderer.info;
  hud.textContent = `draws ${engine.ctx.loop.draws}  calls ${info.render.calls}  tris ${info.render.triangles}  theme ${engine.rig.theme}  progress ${shelf.state.progress.toFixed(3)}  leases ${engine.ctx.loop.activeLeases.join(',') || '-'}`;
});

engine.start();
Object.assign(window, { casebound: { engine, shelf, reader, magnifier, effects } });
document.documentElement.dataset.caseboundReady = 'true';
