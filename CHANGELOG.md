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
- A second binding, the pamphlet (`"binding": "pamphlet"`): a paper cover 0.03 thick in place of the boards, no squares, a fold for a spine and two wire staples. It is the same shape with other numbers, so it opens, lies and turns like any book.
- A zine for any book. `"zine": {}` in a book's record cuts a stretch of its own text into a stapled pamphlet in a paper cover, typeset by the same painter and printed once: the pages after the text stay bare. `title`, `line`, `from`, `paragraphs`, `pages`, `paper` and `ink` are optional. In the demo, The Chemical History of a Candle and Walden have one.

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
- A sheet in a hand stands where the hand has it and bows only as far as it moves fast; a press held still on a leaf in the air brakes it and lets it go on. Both as measured against a capture.
- Stops for the keyboard: the Tab key reaches every featured book and brings it to the centre, Enter opens its details, and the row is one stop that takes the arrows, Home and End. `?section=` in the address opens the page at a section, and the key `i` shows the window as its negative.
- A page of stills for browsers without WebGL 2, and for any browser with `?nowebgl` in the address (kept for the tab; `?webgl` goes back). Each book is a box of six faces under CSS 3D transforms, cut from the cover the painter paints, with the foil laid on. A still rides the scroll, turns under a sideways pull, faces the front again after it was out of sight, and opens the details; the row, the title row, the menu, the themes and links to a book work as on the page with the books. No reader, lens or pen there.
- `atlasOf(dims)` in `src/engine/book/dims.ts` lays out the strip a cover is painted on without building a book.
- Sound: every page turn is heard, with a brush when a page is taken, a flop when a held leaf passes upright, a riffle and a knock for a block of leaves, and a thud when a lifted cover falls shut. Made from noise in the browser, nothing is loaded. New engine events `page-grab`, `page-upright`, `page-shuffle`, `page-land` and `cover-shut` say what happens, `casebound.sound` plays it, and the tunable `sound.paper` sets the levels. Each voice is fitted by measurement to the recording the reference plays in its place: its length, when it is loudest, how fast it falls and its spectral centre. A turn now swells to its peak and falls fast with a quiet tail, where it was loudest at once and too bright; the riffle of a block is low and a second long. Nobody has listened to either side.
- A book opens where it was last read, kept per book in the browser. The page numbers in the reader's bar are a button that copies a link to the spread. `j` and `k` jump forty leaves, `<` and `>` turn one, `x` closes the book. All as on the reference.
- Highlighter pens for the open book: two pens in the reader's bar, a pen generated in code that stands on the pointer with gloss, shadow and a footprint under its nib, lines dyed into the paper that stay on their page through page turns and are saved per book, a felt scratch that follows the hand, `casebound.marker` with `pick`, `undo`, `clear` and `marks`, and the tunables `marker` and `marker.pen`.
- Hooks for tools on the pages: `reader.pageAt`, `reader.pageNear`, `reader.overlay` and `reader.handsOff`. The pens are built on them and nothing else.
- A bundle of leaves: under a pointer resting on the fore-edge of a page stack every leaf above that place lifts as one block, with a printed page on both faces. A click or a flick turns it over, a pointer that leaves lets it sink back. `reader.turnLeaves(count)` turns a block from code, the `page-turn` event carries the number of leaves, and `reader.bundle` holds the rules.
- Ten leaves at a time: `[ « ]` and `[ » ]` in the reader's bar, `Shift` with an arrow, `Page Up` and `Page Down`. The edge of a page stack is a narrow place to find, and a finger has no pointer to rest on it.
- The cover of the centred book lifts under a resting pointer in the details view and in the row, and stays shut on the shelf itself, as measured (`peek` in the shelf options).
- Pages turned by hand: a held leaf follows the pointer with the measured mapping, a pull that ends on the turning side turns the page, a pull brought back lets it fall, a tap turns one page, and a leaf in the air can be caught.
- Reduced motion is honoured in the scene: with it on, every animation jumps to its end.
- Reading by touch, as measured on a phone. On a narrow screen one page side fills 0.96 of the width, the left one first. A finger pans to the other side and the pan comes to rest on the side it was carried toward; a sideways pull at the end of the pan turns the page; a tap turns a page as a click does. Two fingers zoom from 0.5 to twice the zoom that fits a page, about the place between them. Past their limits the zoom gives way by 0.35 and the pan by 0.28, and both spring back when the fingers are lifted. On a wide touch screen a finger pulls pages as a mouse does and pans the book when it rests on a page for 0.3 s. The numbers are in the registry as `reader.touch`; `reader.view`, `reader.frame()` and `reader.hand` let a tool zoom the book, find its pages on the screen and lead a hand.
- The zine in the scene: it flies in from the right the measured way (45 units, the square of what is left, 0.12 a frame), lies closed over the picture while its book stands aside to the left, opens with its cover on the first turn and comes to the reading place, and goes out the way it came. Honours reduced motion. Its feel is in the registry as `zine`.

The page:

- The pictures behind the books stand in one window below the title row and move with the books, not with the scroll bar, so a picture rests while its book rests and never runs up under the header. The art in a picture moves at 0.3 of its pace and grows a little as it leaves the middle. The row of spines stands on the bare page.
- A title row with every book of the library, the featured ones first. It holds still while the books move and glides to the new title in half a second when the current book changes. The current title stands upright and the others lean in italic. A press on a title brings its book.
- The details open in the measured order: the picture narrows, the column comes in from the right, the title row is cut where the picture ends, the buttons of the bar sink out of the window, and the way back appears in the label row. Closing, the column fades out first.
- The details as one long page through every book of the library. Each book has its title, its description, the ways to read it, an excerpt of its text in the book's typeface and a colophon written from its record. The book and its picture stay at the top of the window while the column scrolls past, then go up with the page, and the next book comes up from below.
- A book opened from the details has the whole picture. Escape leaves the book and the details come back.
- A menu in the bar. A mouse on the title at the foot of the window, a tap on it, or `Enter` brings up every book of the library and the sections of the page with their keys (`f`, `a`, `u`), the sections of the details of an open book, and links to the source, the skill and the licence.
- The page goes on past the row: a band that shows what a visitor can do with the books, and a footer with what Casebound is, the command that installs the skill, and links to the source, the skill and the licence. The row goes up with the page on the way there.
- Each card of the band plays a short silent film of what it describes, recorded from this page with `record.mjs`: six films about 480 px wide, each with a WebM and an MP4 beside it, 90 to 260 KB. As on the reference, the band steps one card at a time (the left and right keys while it is at the top of the window, a sideways wheel gesture, a press on a neighbour, a drag), the card in front plays while the band is all but wholly in view, a card under the mouse plays too, and a press pauses or plays. Nothing is loaded before the band is near, only a card asked to play gets its film, and with reduced motion nothing loads or plays. The painted picture stays under each film as its still.
- On a phone a counter under the row with arrows that step it, a bar that holds only the title of the current book, and no lens over the picture.
- The theme control at the right end of the label row, a section label that changes where the next section of the page begins, and titles that fade in after the page has loaded.
- The zine is read in the details: a pill under the rows takes it out and puts it away, the column stays, and the reader's bar, keys, lens and pens work on it. The bar shows one number, the sides turned. Its address is `#/book/<slug>/zine` and `#/book/<slug>/zine/page/<n>`; marks are kept under the zine's own name.
- A zine is numbered by its sides from the front of its cover: its first page carries the folio 3, and the number in the bar, the number in the address and the folio on the left page of the spread are the same. An odd number in the address opens the spread before it.
- A zine's cover turns as a leaf of the zine's paper over a booklet that already lies open, and the booklet comes to the reading place on a curve of its own: 90 percent of the way 317 ms after the key, against 917 ms before. Its leaves turn with the zine's own paper too, half way in 0.3 s.
- An open zine lies as a shallow V, each half 6.5 degrees short of flat, and turns about its spine as it is read, the side with fewer leaves higher, 13 degrees from its first spread to its last, and up to 3 degrees toward the pointer.
- After the last leaf of a zine the way on brings its back cover over and it lies closed on its face, numbered with every side; the way back opens it again.
- On a narrow screen a zine has the whole picture: closed, its cover fills the width of the window; open, one page does, the left one first, and a swipe across the page goes to the other side without turning it. It leans back less there.
- One Escape under a zine puts it away and, 0.63 s later, closes the details.
- Both demo zines are printed to their last page: 22 paragraphs of the candle lecture and 26 of Walden, and a page is reckoned at 2,500 characters, as the painter sets them, where it was 1,650. Before, the text ended after four sides and the last two and a half spreads were bare.
- The pill that takes a zine out stays readable under the pointer and the keyboard: it fills with the ink and its words take the colour of the page. Before, both were the ink.
- On a phone, a book or zine opened from details scrolled down has its picture behind it, as when it is opened by its address.
- A zine on a phone is read by touch like a book: the swipe of its own that only changed sides is gone, and a pull at the end of the pan now turns its page.
- A spine too narrow to read, such as the fold of a pamphlet, carries no title, author or mark.
- A zine shut on its back no longer shows the print of its last page through the back cover: the cover presses down the leaves still settling under it.

Effects:

- A magnifier as a second pass over the frame, with magnification, barrel bend and the measured rim. It opens in the middle of the picture and follows the pointer from its next move.
- Two looks for every book surface, hologram and radio, with the measured waits and fades.

System:

- A registry of every tunable value with id, range and help text, readable and writable from the console.
- A lost drawing context is caught: the canvas says so (`data-gl="lost"`, the event `context`), and when the browser gives the context back the frame is drawn at once with every texture, where the page stayed empty until the next heartbeat, up to a second.
- Extension points for scene objects, surface effects, shelf layouts, light presets and page sources, with three example extensions.
- A content folder: one record per book, optional text beside it, and a tool that fetches public-domain texts from Project Gutenberg.
- An agent skill, `casebound`, with references for content, extending, tuning and verifying, and manifests for the Claude Code plugin marketplace.
- A demo site with six public-domain books, deep links, a long page of details and keyboard control. Escape goes one step back at a time; under a zine one press takes two.

Measurement:

- `research/SPEC.md`: about 130 numbered values measured from the reference, each with a note on how it was verified.
- `research/PARITY.md`: comparisons of this build against the reference, frame by frame.
- `research/PARITY.md` holds fifteen passes and an inventory from the reference's side. The second compared all ten interactions and led to twelve corrections, from the darkness of the wall shadow to the timing of the opening.
- A pass on the page around the books: its layout and timing measured at 1440 by 900 and on a 390 px phone, with the shelf's browser check extended by a step for each correction.
- Tools: a screenshot script, a frame recorder that drives the engine's clock, a GIF encoder for its frames, four functional checks that run the reader, the shelf, the page of stills and the zine in a real browser, a runner for frame-stepped capture with reanimate, a channel comparison and a scene pose reader.
- A pass on the zine: the reference's measured in three loads, ours laid beside it with the same driver, and `tools/capture/check-zine.mjs`, a third functional check that runs the zine in a real browser.
- A pass on touch: the reference's reading by touch measured on a phone with one and two fingers, ours built to it, and steps in `check-reader.mjs` for it and for a lost drawing context. `check-stills.mjs` starts Edge without WebGL and checks that the page finds that out by itself.
- A pass on the band and the sounds: the reference's rules for when a film plays and how the band steps read in its scripts, its page sounds measured offline beside ours (length, peak, fall, spectral centre), and steps in `check-shelf.mjs` and `check-zine.mjs` for the band and for the zine's back cover. `record.mjs` records a page without the engine on the page's own clock and has scenes for the zine and the page of stills, the sources of two new GIFs in the README.

### Known gaps

- The row of spines was built from the measured constants without a capture of its own to compare with.
- The zine lies on the book's two page stacks with six live leaves; the reference's has every leaf live. Its paper is fitted to the turn of the reference's leaf, not built from the reference's own paper model. Its lean about the spine is fitted to what the reference's leaves show, not built from its turning group and the ground its leaves lie on.
- The opening is still up to 175 ms early at its start against the reference, and the closing sequence, the toolbar timing and the lens rim were not measured again after their correction.
- Page paper is still about 8 of 255 short in blue against the reference.
- Reading by touch was measured and tried in a browser's touch emulation, not on a phone. Zoom 1 on a phone is the whole spread in the width, a little smaller than the reference's, so the least zoom shows the book smaller than there.
- The band of films follows the reference's rules as read in its code; its timing was not captured on the reference. The MP4 films were played in Edge on their own, not through the page in a browser without WebM, the only place it picks them.
