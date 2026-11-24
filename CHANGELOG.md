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
- Cloth with a tooth that does not fade with distance, titles and ornaments pressed into it, and a groove where each board meets the spine.
- Film grain on paper, light that bounces between facing pages near the gutter, shade in the fold, and sixteen shadow samples on every book surface.
- Page edges with one stripe per leaf, endpapers in the book's colour, and typeset pages with running heads, justified text and folios.
- Text flowed line by line in the book's typeface: a paragraph runs on over the page break and every page is full.
- Page stacks that stay on their board however far it is folded back, so a book can lie open at its first or last page.
- Pages with a belly: a lying page rises out of the gutter, is highest a third of the way out and comes down to the fore-edge. The higher it lies in its stack the more it bulges (`book.arch`).
- A paper colour per book (`paper` in `book.json`), for pages and page edges.
- A ceiling on the brightness of paper while a book is shut, so the first leaf under an opening cover keeps its pattern under the lamps of the shelf.
- Cloth turned in over the edges of the boards, a joint groove with two walls that follows the hinge, stamped type with a narrow wall, weave and paper tooth as relief at the measured size, and iridescent foil as a pastel film over the metal. A book's cover material can be tried live in the registry (`book.<slug>`, `book.relief`, `book.joint`, `book.foil`, `book.edges`).

Light:

- Four lights in four presets (shelf, shelf at night, reader, reader at night) that blend field by field.
- Three themes, Morning, Noon and Night, chosen by the hour of the day or fixed with `?theme=light|colour|dark`.
- A spot light that follows the pointer and a key light that shifts with it.
- A wall behind the books that receives a soft shadow, filtered with 16 samples on a rotated disk. It fades by the point of the book that is farthest from the wall.
- At night the picture behind the books falls back into dusk and the pointer's spot of light carries the scene.

Motion:

- A shelf driven by native scrolling: each book lingers at the centre for about 150 px, creeping all the while, then follows with a critically damped motion. A wheel notch is spread over a short ramp so the books do not lunge, and the turn of a book hurries after a fast scroll.
- No book is skipped. After a quick scroll or a jump of the scroll bar from one end of the page to the other, the stack runs at ten books a second at most, so every book on the way passes the centre. The row of spines waits for the stack on the way down, and the stack waits for the row on the way up (`shelf.riseCap`, `shelf.fallCap`).
- Poses for leaving and arriving, a tilt toward the pointer about the axes of the room, and an intro.
- A row of spines after the last featured book: every loaded book stands side by side, the chosen one turns its cover forward, and its neighbours make room. A row that fits the window stands centred; a longer one slides to the chosen book, by a timed glide when it is more than one place away, and keeps its ends inside the window. Covers turn as they pass the middle while the row is pulled. Keys, presses and a pull on the row choose, and the chosen book opens from the row.
- A closed book that turns in the hand: a spring between the pointer and the book, coasting after release, a trailing cover that lifts while it turns, and pitch that levels when the book was left upside down.
- A reader that opens in two stages after the measured pause and turns leaves with a small physical rule. A leaf in the air lets the print on its other side show through.
- An opening as a real book does it: the cover shows the first leaf on the whole block, then everything before the reading place turns over in one wad. Both stacks trail their boards by the measured rule, so the back stack lifts off its board and settles again.
- The weight of the open book follows the pointer: the reading place the case answers to shifts by up to a fifth of the book, the spine rolls under the pages and the boards keep their place.
- Page lights as measured: the hologram shears the print sideways and splits its colours, the radio rings cross the whole spread and ripple the pages.
- A corner curl: the page under a resting pointer lifts its corner, a page in the hand rolls over where it is held, a leaf in the air carries a curl that relaxes as it lands.
- An opening riffle: the top leaves of both stacks settle one after another as a book opens.
- A turned leaf is down on its stack in a second and a leaf let go by hand is thrown on, both as measured against a capture.
- A bundle of leaves: a press on the fore-edge of a page stack turns every leaf above that place as one block, with a printed page on both faces. `reader.turnLeaves(count)` does it from code, the `page-turn` event carries the number of leaves, and `reader.bundle` holds its timing.
- Pages turned by hand: a held leaf follows the pointer with the measured mapping, a pull that ends on the turning side turns the page, a pull brought back lets it fall, a tap turns one page, and a leaf in the air can be caught.
- Reduced motion is honoured in the scene: with it on, every animation jumps to its end.

Effects:

- A magnifier as a second pass over the frame, with magnification, barrel bend and the measured rim. It opens in the middle of the picture and follows the pointer from its next move.
- Two looks for every book surface, hologram and radio, with the measured waits and fades.

System:

- A registry of every tunable value with id, range and help text, readable and writable from the console.
- Extension points for scene objects, surface effects, shelf layouts, light presets and page sources, with three example extensions.
- A content folder: one record per book, optional text beside it, and a tool that fetches public-domain texts from Project Gutenberg.
- An agent skill, `casebound`, with references for content, extending, tuning and verifying, and manifests for the Claude Code plugin marketplace.
- A demo site with six public-domain books, deep links, a detail column and keyboard control. Escape goes one step back at a time.

Measurement:

- `research/SPEC.md`: about 110 numbered values measured from the reference, each with a note on how it was verified.
- `research/PARITY.md`: comparisons of this build against the reference, frame by frame.
- `research/PARITY.md` holds two passes. The second compared all ten interactions and led to twelve corrections, from the darkness of the wall shadow to the timing of the opening.
- Tools: a screenshot script, a frame recorder that drives the engine's clock, a GIF encoder for its frames, two functional checks that run the reader and the shelf in a real browser, a runner for frame-stepped capture with reanimate, a channel comparison and a scene pose reader.

### Known gaps

- The row of spines was built from the measured constants without a capture of its own to compare with.
- The opening is still up to 175 ms early at its start against the reference, and the closing sequence, the toolbar timing and the lens rim were not measured again after their correction.
- Page paper is still about 8 of 255 short in blue against the reference.
- Touch works but was not measured.
