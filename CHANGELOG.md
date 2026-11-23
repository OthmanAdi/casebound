# Changelog

## 0.1.0 (unreleased)

First public version. A shelf of lit hardcover books you can scroll, open and read, with the tools that measured its feel.

### Added

Books:

- A hardcover generated from dimensions: two boards and a spine joined by rounded hinges, two page blocks and single leaves. No model file is loaded.
- One cross-section model for every sheet in the book. The layers of the page blocks and a leaf in the air use the same function, so a leaf starts and ends exactly on its stack.
- Covers painted in code from a record: cloth colour, one of seven ornaments (plain, marble, rules, grid, rays, strata, dots), title, subtitle and author on board and spine, an emboss map and a foil mask.
- Three binding materials (buckram, paper, cardboard) with a tiled grain, shaded as cloth: wrapped diffuse, a fabric sheen, softened highlights, darker gaps between threads and fine fibre streaks that fade with distance.
- Foil that takes its colour from the angle of view, from plain metal to fully iridescent.
- Page edges with one stripe per leaf, endpapers in the book's colour, and typeset pages with running heads, justified text and folios.

Light:

- Four lights in four presets (shelf, shelf at night, reader, reader at night) that blend field by field.
- Three themes, Morning, Noon and Night, chosen by the hour of the day or fixed with `?theme=light|colour|dark`.
- A spot light that follows the pointer and a key light that shifts with it.
- A wall behind the books that receives a soft shadow, filtered with 16 samples on a rotated disk, fading as a book comes forward.

Motion:

- A shelf driven by native scrolling: each book holds at the centre for 150 px, then follows with a critically damped motion.
- Poses for leaving and arriving, a tilt toward the pointer, and an intro.
- A reader that opens in two stages, leans toward the pointer and turns leaves with a small physical rule. A leaf in the air lets the print on its other side show through.
- Reduced motion is honoured in the scene: with it on, every animation jumps to its end.

Effects:

- A magnifier as a second pass over the frame, with magnification, barrel bend and a rim.
- Two looks for every book surface, hologram and radio, with fades.

System:

- A registry of every tunable value with id, range and help text, readable and writable from the console.
- Extension points for scene objects, surface effects, shelf layouts, light presets and page sources, with three example extensions.
- A content folder: one record per book, optional text beside it, and a tool that fetches public-domain texts from Project Gutenberg.
- An agent skill, `casebound`, with references for content, extending, tuning and verifying, and manifests for the Claude Code plugin marketplace.
- A demo site with six public-domain books, deep links, a detail column and keyboard control.

Measurement:

- `research/SPEC.md`: about 110 numbered values measured from the reference, each with a note on how it was verified.
- `research/PARITY.md`: comparisons of this build against the reference, frame by frame.
- Tools: a screenshot script, a frame recorder that drives the engine's clock, a runner for frame-stepped capture with reanimate, a channel comparison and a scene pose reader.

### Known gaps

- Pages cannot be dragged by hand yet, and a page corner does not curl under the pointer.
- Books that are not featured are loaded but have no row of spines.
- A book cannot be spun by dragging.
- The closing sequence and the two-stage opening have not been compared with the reference again after their last change.
