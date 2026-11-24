# Parity log

Reference and our build are captured with the same tool (reanimate), the same settings (Edge, 1440x900, virtual clock, 60 frames per second, light theme pinned) and the same interaction script (`tools/reanimate/capture-series.mjs`). Values are compared with `tools/reanimate/compare-channel.mjs`. This file records what was compared and what came out. Newest entry first.

## Summary

| Interaction | What was compared | Result | State |
| --- | --- | --- | --- |
| Lights at rest, shelf and reader | every light uniform: colours, directions, cone, shadow bias | equal to six digits | matches |
| Pointer spot light | position and direction while the pointer moves | mean difference 0.3 % of the range | matches |
| Key and sun light | direction while the pointer moves | mean difference under 0.0001 | matches |
| Page turn forward | turn progress per frame, 50 to 2400 ms | mean difference 0.0002 of a turn, worst 0.0008 | matches |
| Page turn backward | turn progress per frame, 50 to 2400 ms | mean 0.0069, ours starts one frame early | close, one-frame offset open |
| Lens | magnification at the centre | 1.440 against 1.442 | matches |
| Hologram fade | strength per frame after the hover | 0.1000, 0.1914, 0.2695, 0.3438 against 0.1000, 0.1915, 0.2695, 0.3439 | matches |
| Radio fade | strength per frame after the hover | 0.3334, 0.5583, 0.7011, 0.8025 against 0.3333, 0.5582, 0.7010, 0.8025 | matches |
| Pointer tilt on the shelf | world rotation of the book at five times | equal to 0.001 degrees at four of them, 0.026 at the fifth; no roll | matches |
| Shelf and reader height | pivot of the book | -3.0547 and -2.9817 against -3.0553 and -2.9819 | matches |
| Key shadow radius | shelf and reader | 6.000 and 9.739 against 6 and 9.74 | matches |
| Wall shadow | opacity on the shelf and in the reader | 0.193 and 0.0534 against 0.193 and 0.0534 | matches |
| Wall shadow while a book changes | darkness at six moments of a 1.4 s glide | 0.190, 0.180, 0.179, 0.183, 0.188, 0.191 against 0.187, 0.179, 0.179, 0.180, 0.184, 0.193 (it fell to 0.143) | matches to 0.004 |
| Detail view | sideways move of the book over time | same curve and end value (-9.1229 against -9.1239), one frame late in the capture; corrected afterwards | close |
| Shelf, a wheel notch | 10, 50, 90, 99 % of the book's move | 29, 93, 173, 265 ms against 29, 93, 173, 265 (it was 1, 39, 112, 203) | matches |
| Shelf, the dwell | how far a book has moved after 75 px of scroll | within 0.5 px of the reference's 11.8 px (it was 0) | matches |
| Shelf, turn after a jump of the scroll bar | 10, 50, 90, 99 % of the arriving book's turn | 37, 81, 178, 328 ms against 54, 98, 195, 344 (it was 43, 104, 253, 466) | close: one frame early |
| Shelf, damping, poses and intro | height curve after a jump; rest, arrive and leave poses; intro | the damper is the reference's, one frame earlier; poses equal; intro within 0.01 units and 0.1 degrees | matches |
| Shelf, scroll per book | pixels of scrolling from one book to the next | 872 against 872, 943 from the first book on the reference (it was 730) | matches but for the first book |
| Page pulled by hand | angle of the held leaf, turn or fall back, tap | equal frame for frame | matches |
| Page landing | sheet down after a tap | 978 ms against 951 ms (it was 2781) | matches |
| Leaf let go by hand | half way to its stack after a full pull | 189 ms against 204 ms (it was 341) | matches, ours one frame ahead |
| Corner under a resting pointer | 10, 50, 90 % of the lift | 27, 185, 609 ms against 44, 185, 609 (it was 95, 284, 707) | matches from 200 ms on |
| Closed book turned by hand | turn under the hand, coast, levelling | within 0.003 rad and one frame | matches |
| Closed book, trailing cover | lift at 3 rad/s | 15.1 to 15.6 degrees against 14.5 to 15.0 (it was 4.5 to 4.7) | matches |
| Open book | when the book turns | 10, 50, 90 and 99 % at 1222, 1803, 2120 and 2226 ms against 1335, 1835, 2146 and 2252 | close: 113 ms early at the start, 26 to 32 ms from half way on |
| Pages parting | page progress at seven times, 1700 to 2300 ms | 0.159, 0.300, 0.477, 0.665, 0.833, 0.962, 1 against 0.172, 0.292, 0.458, 0.639, 0.808, 0.943, 1 | matches to 0.03 |
| Pages parting | path of the two stacks | both swing out by their final angle times the square of the page progress, as read in the reference's code and seen in its frames | matches by rule; frames of a new capture agree within two to three frames |
| Closing | frames side by side | ours runs about three frames ahead: the reference lets the pages rise for a moment before the cover moves | close |
| Hologram | ink and paper under the effect | ink 174, 155, 170 against 155, 124, 176; both clip to white at the peak of the pulse | close: ours less violet |
| Radio rings | shape and reach | rings cross the whole spread from its upper right corner and lift the surface, five to six along the top edge of a page on both sides | matches by eye; lift not measured |
| Cloth | grain of a buckram spine, percent of brightness | 2.9 to 3.0 against 3.0 | matches |
| Foil | saturation of iridescent silver foil | 0.09 to 0.25 against 0.10 to 0.25 | matches |
| Page block | colour of its tail on the shelf | 102, 96, 85 against 106, 99, 86 | matches |
| Joint | shade of the far wall of the groove | -16 to -17.5 % against -20 % | close |
| First leaf under the opening cover | brightness on screen | 228 and 210 of 255 at the two brightest frames against 228 and 214; it was 255, burnt out, before | matches |
| Pointer over the open book | reading place the case answers to, pointer on three buttons | 0.560, 0.688 and 0.352 from the rule against 0.556, 0.694 and 0.360 captured | matches to 0.008 |
| Resting spread | belly of the pages | about 1.1 units high, a third of the way out; ours built to that | built from one frame, not measured again |
| Paper | brightness and colour of the pages | the reference prints titles on different paper: white (matched earlier, blue about 8 of 255 short) and cream, 188, 181, 160 lit. A book can now name its paper | open: the cream is ours, not sampled |
| Row of spines | 17 differences found against a capture, 14 corrected | cover turn of the arriving book 20.8, 59.5, 79.5 degrees against 21.3, 57.8, 77.9; slide 31, 171, 480, 888 ms against 32, 172, 481, 887; covers span 165 to 760 px against 167 to 758; a far press glides in 0.4 s | close: the three later corrections were built to the measured numbers and not captured again |
| Pictures behind the books | how a picture moves while its book dwells, and where it stands half way between two books | 9.2 px for 60 px of scroll, in a window below the title row; it moved 60 px and ran up under the header | matches |
| Title row | when it moves in a 1.4 s scroll to the next book | 850 to 1333 ms against 850 to 1317; it slid from 117 to 1400 | matches |
| Details opening | column, title row and bar, frame by frame | column 0.44, 0.81, 0.94 at 600, 700, 800 ms against 0.31, 0.79, 0.94; title row cut at 40 % in 0.6 s; bar buttons 54 px down after 0.585 s | matches to about a frame |
| Menu of the bar | rise of the lists | 0.50, 0.29, 0.16, 0.09 of the way left at 33 to 133 ms against 0.57, 0.33, 0.19, 0.10 | matches, ours one frame ahead |
| Section label | where it turns to the row's section | 0.41 of the way into the row, by the scroll bar; it was half way, by the books, 134 ms late in a 1.4 s scroll | matches |

## 2026-11-24 · Tenth pass: the page around the books

Eight passes measured the books. This one measured the ordinary page around them: the pictures, the title row, the labels and the bar, the details, and what comes after the row. Two complaints led to it, that some scrolling with every book closed felt wrong and that the panels of information did not match. Both turned out to be the page, not the books.

How it was studied. Both sides were loaded at 1440 by 900 and as a 390 by 844 touch phone, with the reference's requests to its shop refused before they left the browser. Every element outside the canvas was read with its computed styles in eleven states (each featured book, half way between two, the row, the details at four moments, the reader), and the page was then stepped frame by frame under reanimate's clock through 21 kinds of scrolling, the opening and closing of the details, the menu, and the way from the row to the foot of the page. The books themselves were captured once more with the sixth pass's sampler for the new kinds of scrolling.

What already agreed: the books. A trackpad (60 wheel events of 4 px), a fling, the arrow keys, Page Down, a slow drag of the scroll bar and a scroll that stops half way between two books all move the books within a frame and a few pixels of the reference. Neither side settles onto a book when a scroll stops between two. Overscroll at the top moves nothing on either side.

What did not, and what ours does now:

| | Reference | Ours before | Now |
| --- | --- | --- | --- |
| Pictures | one window from the title row to 24 px above the foot of the screen; a card per book, 8 px taller than the window and 16 px apart, placed by the shelf's eased progress; the art moves at 0.3 of the card's pace and grows by up to 6.3 % | panels in the page that moved with the scroll bar and ran up under the header: 60 px of scroll in the dwell moved the picture 60 px while the book moved 9 | the same rule: 9.2 px |
| The row | stands on the bare page | had a picture of its own | bare page |
| Title row | every book of the library three times over, featured first; still until the current book changes, then a 0.5 s glide; others in italic at 0.8; the current title's middle at 47.5 % of the width | four titles and one for the row, sliding with every pixel and flipping half way; others at 46 % ink; nothing left of the first book | the same rule; in the row it follows the chosen book |
| Details, opening | picture narrows from 100 to 550 ms; the column waits and comes 10 % of the width from the right in 0.6 s; title row cut at 40 % from the right; bar buttons sink 54 px; the way back appears at 0.91 s in the label row | column in at once from 5 %; title row ran over it; buttons stayed; way back in the header | the same order to about a frame |
| Details, closing | the column slides out and fades in 0.3 s, then the picture widens | gone in one frame | the same |
| Details, as a page | one page through every book: the book and its picture stay at the top while the column scrolls past, go up with the page when its part ends, and the next book comes up from below and stays; the title row shows only while a picture stands at the top | one short column beside one book | the same structure, with the content our records hold: title, description, the ways to read it, an excerpt of the text in the book's typeface, a colophon |
| A book opened from the details | has the whole picture; Escape brings the details back | read beside the column, scaled down | the same |
| The menu of the bar | the title at the foot of the window is its handle: a mouse on it, a tap or `Enter` brings up every book by title and the sections of the page with their keys, rising in 0.38 s; from the keyboard the focus lands on the current book, Tab stays inside, Escape gives the focus back | none | the same; a press on a book brings it and opens its details |
| After the row | a dark band and a footer, 2295 px in all; the row goes up with the page (109, 334, 597 px after 230, 460, 690 px of scroll), the title row fades out from 0.2 of a slot past the row, the bar's strip and buttons go | the page ended 174 px past the row | a band of what a visitor can do with the books and a footer with what Casebound is, the command for the skill and links to the source, the skill and the licence; the row lifts by the same curve |
| Section label | names the section whose top has passed 40 px below the top of the window; the row's section begins 0.41 of the way into the row (0.47 on a phone) | followed the books, 134 ms late | the same rule |
| Phone | the bar holds only the title; no lens over the picture; a counter under the row, 42 px below the chosen cover and 18 px wider, "11 / 21" between two arrows | title and two buttons that wrapped onto two lines; a lens; no counter | the same |
| Theme control and titles at load | the control at the right end of the label row; the titles fade in over 1.6 s from 1.2 s | in the header; titles at once | the same |
| Tab in the details | header, then the column | reached the lenses of other pictures and scrolled the shelf behind the open details | one lens, and the details are their own page |

Left on purpose: our typefaces and their sizes and tracking, the page colour, which stays ours in the details where the reference tints it from the book, the header's own links, and the content itself. The band holds what a visitor can do with the books where the reference shows its films, and the details hold no reviews or photographs because our records have none.

Not verified: every reference number is one reading from one load at each size. The zoom of the art in a picture is a fit to the frames (within 0.0024 of scale), not read from code. The details as a page were compared by their behaviour in steps of 450 px and by the arrival of the next book frame by frame; our parts are shorter than the reference's, so a picture stays at the top for less scrolling. Touch scrolls natively on both sides, but the headless browser made no fling from synthetic touches, so momentum was not compared. The reference's band plays films; how its row of cards is stepped was not captured.

## 2026-11-24 · Ninth pass: the pen

Eight passes compared what both sides had. None of them had opened the reference's control bar far enough to find a tool ours did not have at all: a highlighter. It marks the pages of the open book, and it was the largest thing missing.

How it was studied. The reference's scripts were read for the rules, and two sessions of its reader were captured with a scripted pointer: taking a pen, sweeps across and up the page, slow and fast strokes, taps, the gutter, the page edge, page turns, a reload. The rules read in the scripts were then held against the captured series. The roll of the pen through a sweep agrees with the rule to 0.0014 rad over 271 frames, so the rule is what was built.

What the pen is, and what ours does now:

| | Reference | Ours |
| --- | --- | --- |
| Taking a pen | two places in the bar, pink and yellow; a click takes, changes or puts back; `h`; Escape puts it away and leaves the book open | the same rules |
| The object | generated from primitives: chisel nib, cone, barrel, cap with a dome; 0.445 page heights from nib to cap rim | generated from the same table of numbers |
| Where it stands | on the pointer's ray in every frame, no lag; beside the book on the nearest page edge | the same; 0 px across and 18 px above the pointer at rest, as measured there |
| Coming down | lift 0.698, 0.352, 0.156, 0.065, 0.026, 0.010 of the way left, frame by frame | the same to two places |
| Rising | 10, 50 and 90 % after 23, 76 and 176 ms | within those marks |
| Lean | 0.420 rad hovering, 0.540 pressed | 0.420 and 0.540 |
| Roll through 1200 px a second for 250 ms | 0.012, 0.048, 0.107, 0.172, 0.229, 0.266 every 50 ms, largest 0.268 at 67 ms after the stop, 0.021 past rest | within 0.01 of each reading, largest 0.268 |
| Lean moving up at 200 px a second | 0.444 rad | 0.444 |
| Footprint under the nib | 0.354, 0.569, 0.699, 0.778 of its strength in the first four frames | the same to three places |
| A stroke | the raw points of the hand, one round-ended line, 1.17 lines of print high, smoothed; a press without a move leaves nothing | the same; the line is 1.17 lines of our own print high |
| Ink | multiplied onto the paper before lighting; yellow 0.8, pink 0.48 | the same rule and strengths |
| Life of a mark | belongs to one page side, turns with it, kept per book across closing and reloading | the same |
| With a pen out | no page is pulled, no corner curls, no bundle lifts; keys and the bar still turn pages | the same |
| Sound | a scratch of band-passed noise by sideways travel | the same band |

Where ours goes further: marks also show on the page blocks and on a bundle in flight (the reference draws them on single leaves only), `Ctrl` + `Z` takes the last mark away, a chisel nib is a second way to draw, and the hooks the pens are built on are open to other tools.

The second comparison. The same scripted pointer was then run against ours, and the two captures were laid side by side, series against series and pixel against pixel. All motion agreed as built: lift, lean, roll, pitch, hover height, the fade of the footprint, the size of the pen, the frame in which a taken pen appears, the cursor, the wait on a page edge, the split of a stroke at the gutter, taps, keys, the magnifier, reload and closing with marks. Nine things did not, and were changed:

| # | Difference | Reference | Ours before | Now |
| --- | --- | --- | --- | --- |
| 1 | Pink ink too pale: blank paper under it | 196, 140, 155 (from 194, 195, 189) | 199, 164, 159 | 208, 152, 159 against an aim of 207, 148, 164 |
| 2 | Pen body darker and more saturated: mean difference over the barrel | reflects the stock room of three.js | 13.5 of 255, reflecting a nearly black box | 2.3 yellow, 3.9 pink, reflecting the same room |
| 3 | A pen taken again stood where it was put away until the pointer moved | on the pointer, or the nearest page edge | where it was | on the nearest edge |
| 4 | Footprint under the nib paler: blue of yellow against the paper | 0.127 | 0.364 | 0.133 |
| 5 | Shadow faded toward the cap: how much the far end darkens the page | 36 % | 20 % | 33 % |
| 6 | A press that started beside the pages painted once it was pulled onto one | no stroke | a stroke | no stroke |
| 7 | Yellow ink a little orange: paper under it | 182, 166, 78 | orange cast | 184, 168, 77 |
| 8 | The pen was gone after a finger lifted | stays where the finger left | gone | stays |
| 9 | The two squares in the bar a fraction of a pixel off | 10.6 px with a line of 0.85 | 10 px with a line of 1 | 10.6 and 0.85 |

Not verified: how the pen sinks when the paper falls away under it and the air it keeps over the paper were read in the reference's code and not captured. The scratch was compared call by call and not by ear. The reference's pink footprint and print under pink ink were not read. Compact layout, dense screens and a real touch screen were not compared. In the gutter the pen's shadow bends differently, which follows from the curve of our pages. Every reference number is one reading.

## 2026-11-24 · The bundle, second reading, and what was left of the lists

The eighth pass built the bundle from a reading of the reference's code that was half right. A second reading of the pointer code beside it shows two kinds of block, and the eighth pass had given the pointer the wrong one.

| | Reference | Ours after the eighth pass | Now |
| --- | --- | --- | --- |
| A mouse resting on the fore-edge of a page stack | a block lifts 16 degrees and waits; moved along the edge it is counted again; 90 ms off the edge and it sinks back | nothing | the same: 19 to 85 leaves across the edge of a stack of 90, 16.0 degrees, down again 0.7 s after the pointer has left |
| A press on the edge, let go | the lifted block is sent: it covers 7 tenths of the rest per second, 0.9 of the turn per second at least | waited 120 ms, then turned in 0.7 to 1.1 s on a cosine | 0.22, 0.57, 0.80, 0.92 and 1.00 of the turn after 50, 100, 150, 200 and 300 ms |
| A flick with the block in the hand | sends it at 0.7 px per ms after 5 px | nothing | the same rule |
| A jump of more than three leaves by the page itself | a block on the clock: 120 ms, then 0.7 to 1.1 s | the clock, on the pointer | the clock, on `reader.turnLeaves` |
| Leaves at a place on the edge | read off the leaf positions of the block | a ray onto the meshes as they stand | the edge of the stack as it lies, so a lifted block does not move the place away from under the pointer |

What a press takes is the block that stands lifted. The book leans toward the pointer, so the place under a resting pointer drifts by a pixel or two while the block waits; picked again at the press it would be another block than the one shown.

One thing the capture of the seventh pass seemed to say, that nothing lifts before the press is let go, did not hold against the code: the lift waits for the page under the block to be painted, at most 1.2 s, and in that capture the press came sooner.

The rest of the open lists:

| Item | From | Decision |
| --- | --- | --- |
| The cover of a featured book lifts under a resting pointer | seventh pass, 9 | built: the lift belongs to the details view and the row. On the shelf the cover stays shut |
| The first featured book dwells 110 px, not 75, and the second is 943 px away | sixth pass, 8 | not copied. It follows from the reference's page, whose canvas sits 73 px below the middle of the window. Ours is centred and every book dwells alike |
| A scripted jump of the scroll bar shows one frame later | sixth pass, 6 | not copied. With a real wheel the delay was absent on the reference too: it belongs to how its page hands a scripted scroll to the scene, not to anything a reader sees |
| The lift left at the landing of a block goes in one frame on the reference | eighth pass, 2 | kept ours: the lift fades as the block comes down |

Not verified: none of the bundle was laid beside a capture frame by frame; the capture of the seventh pass shows four presses and no resting pointer. The numbers of ours are from the browser check and a probe. Touch takes a block by a press on the edge; it was not tried on a touch screen. The Noon theme was never captured.

## 2026-11-24 · The hand, second round

Two differences of the seventh pass were left open. Both are built now, from the capture of that pass and the rules read beside it.

A sheet in a hand. Ours drew a held leaf with the rule of a flying one: late off its stack, fastest near upright, and bowed back against the air at full strength however slowly it moved. The reference's held sheet is off its stack late too, but from a third of the turn on it stands where the hand has it, and it is nearly straight. Ours now has that rule for a leaf in a hand, blends to the rule of flight over a tenth of a second when it is let go, and bows by the square of its speed. Swing of the sheet in a full pull of 600 px in one second, degrees from rest:

| ms after the press | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 1000 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Reference | 12.3 | 25.0 | 42.5 | 59.1 | 66.4 | 67.6 | 74.7 | 93.6 | 112.2 |
| Ours before | 11.6 | 18.7 | 25.8 | 32.0 | 38.7 | 49.4 | 66.3 | 90.9 | 113.8 |
| Ours now | 15.1 | 29.2 | 43.7 | 52.8 | 56.3 | 61.9 | 72.2 | 88.9 | 103.4 |

The sum of the nine differences fell from 109 to 46 degrees. A page turned by the button is unchanged: 81.4 against 79.9 degrees at 300 ms, 135.2 against 131.9 at 500 ms.

A press held still on a leaf in the air. The reference does not catch the leaf at once. For 200 ms the push toward its stack fades and it loses more speed. If the hand has moved 5 px by then it has the leaf. If not, the leaf is thrown on, the page turns, and the hand holds the next page of the stack. Ours caught the leaf at once, so a press and a pull back undid the turn. Now: a leaf sent forward, pressed at 250 ms, held still for 300 ms and pulled back ends on the next page, as on the reference.

One fault of the bundle turned up on the way: after a page had turned, no block could be taken for seconds, because the angle of a landed leaf creeps on unseen. A block can now be taken once every sheet is down: 1.6 s after a turn in the check.

Not verified: the reference rows are the capture of the seventh pass, read at one window size with a mouse; ours were read with a probe of our own that measures the line from the binding to the free edge, which may differ by a degree or two from the reading of that pass. The brake was checked by its outcome, not frame by frame against the capture (a turn of 0.282 to 0.414 in 200 ms).

## 2026-11-24 · No book skipped after a jump

Not a comparison with the reference: a fault of ours, found by scrolling from the bottom of the page to the top in one go.

The row of spines holds the books of the stack while it stands, and lets go of them over about 0.15 s. The stack followed the scroll bar at once. After a jump from the bottom to the top it had arrived before the row let go: the last book dropped away and the first one appeared at the centre. The books between were never seen. The other way was no better: the row took the books of the stack while they were still in the picture.

| Jump | Frames each book between spends at the centre of the stack, before | Now |
| --- | --- | --- |
| Bottom to top, four featured books | 0, 0, 0 | 4, 4, 5 |
| Top to bottom | 0, 0, 0 | 4, 4, 6 |

What changed. The stack runs at ten books a second at most in both directions, the pace of the measured rise of 4 units a frame. On the way up it waits at its last book until the row has let go. On the way down the row waits until the stack has reached its last book and the one before it has left the picture. A scroll slower than ten books a second, about 8700 px a second at this window size, is not touched: with and without the limits the stack agrees to nine places over 90 frames at 2000 px a second.

Not verified: what the reference does after such a jump was never captured, so this behaviour is ours. A jump of one book reached 11 books a second for a few frames before and is now held at 10; the series of the sixth pass were not measured again.

## 2026-11-24 · Eighth pass: the bundle of leaves

The seventh pass left one feature unbuilt: on the reference a press on the edge of a page stack turns many leaves as one block. It is built now.

The rule, read in the reference's code: a press on the fore-edge face of a page block picks the leaf at that depth. With two or more leaves from there to the top of the stack, they go as one block when the press is let go. The block waits 120 ms, then turns on a cosine ease over 700 ms plus 45 ms for every doubling of its leaves, 1.1 s at most. It lifts 7 degrees off its stack, built up over 150 ms. The capture of the seventh pass agrees with what it shows: nothing follows the hand, and 50 ms after letting go a block rises at its lower corner and turns.

Ours: a third page block between the two stacks. Lying on either stack, each of its layers has the shape that stack has at the same height, so the block leaves and joins a stack without a seam. It shows a printed page on both faces and the stack under it shows the page that comes into view. The case rolls with it as it does with a single leaf.

| Check | Result |
| --- | --- |
| A press on the fore-edge takes no leaf into the hand | passes |
| Presses 5 px apart across the edge of a stack of 90 leaves | 2, 10 and 18 leaves, and up to 85 at the board |
| Twelve leaves by `reader.turnLeaves(12)`: block in the air, printed on both faces, the page count at its goal | passes |
| No single page turns while a block is in the air | passes |
| The block lands and is part of its stack, nothing unprinted | passes |

Differences that remain:

| # | Difference | Reference | Ours |
| --- | --- | --- | --- |
| 1 | Leaves taken at a place on the edge | read off a table of leaf positions along the edge | in proportion to the depth of the press |
| 2 | Lift at the landing | 2 degrees are left when the block lands and go in one frame | fades to nothing over the last fifth of the turn |
| 3 | A block taken by a pointer | lifts 16 degrees under the pointer and turns in a third of a second when let go (read wrongly at first as a block that follows the hand) | built in the second reading: see the entry above |
| 4 | Twist of the lift | seen in the capture as a lower corner that rises first; its amount was not measured | the foot leads the lift by 0.6 of it and the head trails by as much |

Not verified: the turn of ours was not laid beside a capture frame by frame, so the timing rests on the constants read in the code. Mouse only. The number of leaves the reference takes at a given place was seen with four presses and not measured.

## 2026-11-24 · Seventh pass: the hand

Three things a hand does were built from constants read in the reference's code and had never been set beside a capture: a page pulled across the book, the corner that lifts under the pointer, and a closed book turned on the shelf. A second session captured both sides with the same scripted pointer: a full pull, a half pull, a pull brought back, taps, a press on a leaf in the air, the pointer resting low and high on a page, a slow pull by the corner, a quick and a slow turn of the closed book and a turn that leaves it tilted.

What already agreed: the angle of a held leaf frame for frame, the choice between turning the page and letting it fall back, the tap; the fold line and the strength of the curl at rest; the turn of the closed book under the hand (0.003 rad), its coasting and its levelling (one frame).

| # | Difference | Reference | Ours before | Now |
| --- | --- | --- | --- | --- |
| 1 | A turned leaf kept sinking onto its stack | down 951 ms after a tap | 2781 ms | 978 ms |
| 2 | The outer fifth of a page takes a bundle of leaves | a press at 0.85 of the page width turns 7 to 10 leaves as a block, a tap 23 | always one leaf | built in the eighth pass: a press on the fore-edge turns 2 to 85 leaves of a stack of 90 |
| 3 | A leaf let go by hand is thrown on | 10 and 50 % at 61 and 204 ms | 110 and 341 ms | 46 and 189 ms |
| 4 | Trailing cover of a turned book | lifts 14.5 to 15.0 degrees at 3 rad/s | 4.5 to 4.7 degrees | 15.1 to 15.6 degrees |
| 5 | A press held still on a leaf in the air | slows it for 200 ms, then it goes on and the page turns | stops it | built in the second round: the leaf is braked for 200 ms and goes on, the page turns |
| 6 | Corner under a resting pointer | 44, 185, 609 ms | 95, 284, 707 ms | 27, 185, 609 ms |
| 7 | Fold of a leaf let go with the pointer moving on | 1.6 rad within 50 ms | 8.2 rad after 200 ms | 2.0 rad after 200 ms |
| 8 | The sheet rises later in the first half of a held pull | 59 degrees after 500 ms | 36.6 degrees | 52.8 degrees in the second round: a held sheet has its own rule |
| 9 | Front cover of a featured book under a resting pointer | does not lift | lifts 5 degrees | shut on the shelf, 5 degrees in the details view and in the row |

Ours draws one frame ahead of the reference throughout, so a number about 16 ms early is the best match there is.

Two notes were wrong and the capture corrected them. A leaf let go does start from rest, but the reference sets its speed once it stands past upright. And the 28 degrees of cover lift in the notes belong to the first of five cover bones; the board stands 3.36 times as far.

Not verified: every reference number is one reading from one capture, mouse only, one window size. The bundle of leaves was seen with four presses at one place; its zone and its count were not measured. The leaves of the opening were not captured again after the landing fix.

## 2026-11-23 · Sixth pass: the shelf under scrolling

The shelf was built from constants read in the reference's code and had never been set beside a capture. A second session captured both sides with one script: a glide from one book to the next in 1.4 s, a jump in one frame, a glide over two books, 100 px into the dwell and back, the way back up, the intro after load, one real wheel event and a run of them. Per frame it read every book's position and rotation.

What already agreed: the damper (SmoothDamp 0.0945 s x 0.7; after a jump our height curve is the reference's, one frame earlier), the rest, arrive and leave poses, pitch, depth, sideways position and scale, the intro (0.01 units and 0.1 degrees), and the wall shadow at rest (0.193 against 0.192).

| # | Difference | Reference | Ours before | Now |
| --- | --- | --- | --- | --- |
| 1 | A wheel notch | spread over a ramp of 115 ms before the damper: 29, 93, 173, 265 ms; speed changes by at most 2.0 px between frames in a run of notches | 1, 39, 112, 203 ms; 13.6 px | 29, 93, 173, 265 ms; 3.1 px |
| 2 | The dwell | the book creeps through it: 11.8 px after 75 px of scroll | 0 px, then a kink | within 0.5 px, no kink |
| 3 | Scroll from one book to the next | 872 px (943 from the first) | 730 px | 872 px |
| 4 | Turn of the arriving book after a fast scroll | 54, 98, 195, 344 ms | 43, 104, 253, 466 ms | 37, 81, 178, 328 ms |
| 5 | Wall shadow while the book changes | dips by 7 %: 0.179 | dipped by 25 %: 0.143 | 0.179 |
| 6 | A scripted scroll jump | shows one frame later | shows at once | open; not seen with real wheel events |
| 7 | Rise of a book per frame | capped at 4 units: -0.85, 3.15, 7.15, 11.15 after a jump | 4.24, 4.31, 3.65 | capped: -0.84, 3.16, 7.16, 11.16 |
| 8 | The first book | dwells 110 px, not 75 | like the others | open |
| 9 | The push of a leaving book upward | capped: 74.9 units | grew without bound, 1333 | capped |

The reference's pictures are taller than the room between its header and the bar at the foot, 856 px in a window 900 high, and run on under the bar. That is where its longer way from book to book comes from; ours ended above the bar. With the same picture height the settled curve stays within 7 px of the reference's and a glide between two middle books within 24 px. The height during a long glide from the first book is still 30 to 60 px off at the worst frame, because the reference's first slot is longer than its others.

The wall shadow fades by how far the book reaches toward the camera. Ours measured that on its own case and stretched it by 1.26, which was right for a resting book and far too much for one that turns away: its far corner comes forward by 2 units, and stretched that took a quarter of the shadow. The reference measures a box around a larger model, whose far corner is 10.5 units in front of the pivot at rest and comes only 0.7 nearer in the turn. Ours now adds a fixed 7.6 units and a third of its own reach. Darkness after a jump of the scroll bar, at 50, 100, 150, 200, 300, 400, 600 and 800 ms: 0.192, 0.187, 0.182, 0.182, 0.188, 0.192, 0.194, 0.195 against 0.191, 0.181, 0.179, 0.184, 0.188, 0.191, 0.195, 0.195. Settled half way between two books ours is now 0.188 where the reference has 0.164 to 0.173; it was 0.134.

Every reference number here is one reading at 1440x900. The wheel was one notch size and rhythm with the browser's own smooth scrolling off; trackpad and touch were not captured.

## 2026-11-23 · Fifth pass: a new capture, the page lights, the covers

**A new capture of ours** (`ours-6`, light theme pinned, after the changes of the fourth pass). World rotation of the opening book: 10, 50, 90 and 99 % at 1222, 1803, 2120 and 2226 ms against 1335, 1835, 2146 and 2252. Half way and later it is 26 to 32 ms early; the start is 113 ms early. Part of that start is a real difference: during the 650 ms before the cover moves the reference's book goes on following the pointer (4.7 degrees at 200 ms, 7.8 at 600 ms), ours stands still. The capture also showed that ours ended its turn 15 degrees short of the reference's. That was the place the book opened at: ours opened at 42 percent of the book, the reference at the middle leaf, and where a book is open decides how far it turns to face the camera. Ours now opens at the middle.

Frames of the new capture beside the reference's at the same frame number: cover, first leaf, wad, fan and resting spread follow each other within two to three frames, ours ahead.

**Closing.** Frame by frame ours is about three frames ahead. The reference lets the pages rise for a moment before the cover starts to close; ours starts both at once. While it closes, the first leaf met the lamps of the shelf with its brightness ceiling still off and burnt out for two frames. The ceiling now comes back with the cover.

**The page lights.** Set beside a frame, our hologram was a pink wash that made the text unreadable, and our radio rings were stripes of light. The reference's shader does this, and ours now does the same:

- Hologram: the print is read again, sheared sideways in two wave trains (0.003 and 0.006 of the page width, 65 and 11 waves down the page), mixed in by half; red and blue are read 0.0147 of the page to either side along the pointer's direction and mixed in by 0.3; two trains of scanlines of strength 0.055 and 0.0385; grain in 4 px cells that changes 12 times a second; a pulse of light of up to 30 percent; a tint of 0.004, 0.015, 0.087.
- Rings: one carrier of 69.8 radians per unit of distance, 1.53 turns a second, squared, fading to nothing 1.2 away. They start at the upper right corner of the spread, not of each page, which is why a page shows five to six rings along its top edge and not eleven. The surface is lifted where a ring passes (0.92 model units in the reference's settings, 0.7 world units on ours), the light is raised by 35 percent and tinted 0.02, 0.06, 0.09 times two.
- An older approximation of the hologram had stayed in our shader and shifted the print a second time. Removed.

Paper and ink between the lines under the hologram, as drawn on the page (the canvas is shown at 0.9 opacity during the effect on both sides):

| | paper | ink |
| --- | --- | --- |
| reference | 229, 228, 237 | 155, 124, 176 |
| ours before | 246, 246, 245 | 204, 184, 198 |
| ours now | 233, 228, 223 | 174, 155, 170 |

Ours is less violet: the book in our capture is printed on cream paper, and our text is lighter. At the peak of the pulse both clip to white.

**The covers** (measured by a second session against frames of the reference, all numbers ours before, ours now, reference):

| What | before | now | reference |
| --- | --- | --- | --- |
| Grain of a buckram spine facing the camera, percent of brightness | 1.8 | 2.9 to 3.0 | 3.0 |
| The same at a strength of 0.037 and of 0.073 | n/a | 2.0 and 3.8 | 1.9 and 4.2 |
| Blotches 4 px across on plain cloth | 1.3 % | 0.3 % | 0.2 % |
| Grain of a paper cover (it carried the film grain of the pages) | 5.1 % | 2.1 % | 1.9 % |
| Film grain on a flat part of a page, levels of luminance | 0.66 | 1.41 | 1.40 |
| Iridescent silver foil, saturation | 0.39 to 0.47 | 0.09 to 0.25 | 0.10 to 0.25 |
| The same, value | 0.99, clipped | 0.90 to 0.98 | 0.90 to 0.98 |
| Strip of board below the page tail | 240, 225, 200 | 46, 49, 74 | 33, 32, 26 |
| Tail of the page block on the shelf | 152, 149, 141 | 102, 96, 85 | 106, 99, 86 |
| Far wall of the joint groove, cover facing the camera | -5 % | -16 to -17.5 % | -20 % |

The strip below the tail was endpaper and the brightest thing in the picture: on a real case the cloth is turned in over the edges of the boards, and the reference shows that. The speckle its covers show at shelf distance is mostly the grain layer of the page, not the cloth.

Not verified: the numbers for the covers come from a branch without the paper ceiling, the page belly and the rebuilt opening, and from stills only. The lift of the rings was set by eye from one frame. Night and narrow screens were not looked at after these changes.

## 2026-11-23 · Fourth pass: the opening beside its frames, the pointer, the page shape, the row

The third pass compared numbers. This one put frames side by side at the same frame number, and it found what the numbers had not shown.

**A clock offset in every capture.** The frames of a capture start 200 ms before its value channels (the pre-roll) and the click takes about four frames more: frame f shows the moment f / 60 - 0.267 s of the channels' clock. Both sides carry the same offset, so frame against frame is fair. Reading a frame number as a time on the channels' clock is not, and I did that at first.

**How the pages part.** In the reference the cover lies flat at 1.6 s and shows the first leaf on the whole block. From 1.8 s everything before the reading place lifts as one wad with that leaf on top, stands at 2.0 s and lies on the front board at 2.3 s. Single leaves fan between the wad and the back stack, which lifts off its board on the way and settles again. The last leaf is down at 2.5 s. Ours let the left stack grow where it lay and showed the reading spread at once.

The rule is in the reference's page block code and its frames agree: each stack swings out from the closed book by its final angle times the square of the page progress, while the boards move with the progress itself. The back stack is therefore up to a quarter of its angle above its board, and the wad trails the front board. Ours now uses the same rule for both stacks.

Page progress, the reference's derived from the yaw of its book, ours read from the engine:

| ms after the request | reference | ours |
| --- | --- | --- |
| 1700 | 0.172 | 0.159 |
| 1800 | 0.292 | 0.300 |
| 1900 | 0.458 | 0.477 |
| 2000 | 0.639 | 0.665 |
| 2100 | 0.808 | 0.833 |
| 2200 | 0.943 | 0.962 |
| 2300 | 1.000 | 1.000 |

**The first leaf burnt out.** While the cover passes the key light the first leaf takes 1.35 times full white on ours (measured by rendering it at a third of its gain). The reference draws its closed page block through a tone curve and never shows more than 228 of 255. Paper now has a ceiling of 0.91 with a shoulder from 0.70 while the book is shut; it fades out between page progress 0.03 and 0.25.

| moment | reference | ours before | ours now |
| --- | --- | --- | --- |
| brightest frame | 228 | 255 | 228 |
| 100 ms later | 214, 210, 203 | 252, 250, 246 | 210, 206, 197 |
| resting page of the reader | n/a | 226, 225, 221 | 226, 225, 221 |

**The pointer and the open book.** Ours turned the whole book up to 22 degrees toward the pointer. The reference does not turn the book. It shifts the reading place that the case answers to (cover angles and the yaw that keeps the spread facing the camera both use it), so the boards stay where they are and the spine rolls under the pages. Its rule, with x the pointer across the picture from the middle of the spread, n = min(1, abs(x)) and r the reading progress on the pointer's side:

    shift = -side x 0.2 x (1 - n)^5 + side x (1 - (1 - n)^4) x max(0, 0.3 - r)

The yaw of the reference's book gives the reading place it answers to in four captures: 0.304 with no pointer, 0.694 with the pointer on Next, 0.556 on Previous, 0.360 on the lens button. With no pointer the rule gives a shift of -0.2, so the book is open at 0.504. The three buttons stand at x = 418, 275 and 475 px in the frame, and the picture is shifted by 19.65 vw in the detail view, which puts the pointer at -0.026, -0.225 and 0.053 of the half width from the middle of the spread. For those positions the rule gives 0.688, 0.560 and 0.352. The button positions were read off a frame to about 5 px, which is 0.007 in the result. Its cover bones confirm that the boards follow the shifted place: 0.297 and 0.680 rad before the click on Next, 0.679 and 0.299 rad after, always 0.977 rad together. Ours now uses the rule; the old lean is gone.

**The shape of a page.** At rest the reference's pages rise out of the gutter, are highest about a third of the way out and come down to the fore-edge: about 17 px in the frame, 1.1 world units on a page 13.2 wide. Ours lay as flat as the boards. A lying leaf now has that belly, scaled by how high it lies in its stack.

**Paper.** The page tone that was matched earlier belongs to a title on white paper. The title in the opening capture is on cream: 188, 181, 160 where the page is lit and 170, 164, 148 where it is shaded, against 246, 244, 239 and 205, 205, 209 on ours. That is the paper, not the light. A book can now name its paper; three of the demo books are on cream. The cream is our choice and was not sampled from the reference.

**The row of spines.** Captured on both sides with one script (a scripted scroll into the row, steps by key, a press on a spine, a slow pull, an opening). Seventeen differences, most visible first:

| # | Difference | Reference | Ours before | Now |
| --- | --- | --- | --- | --- |
| 1 | The last featured book as a spine | spine by half way, cover at 21, 58, 78 degrees at 1200, 1300, 1400 ms | went straight to its cover | 20.8, 59.5, 79.5 |
| 2 | Its way into the row | falls back from depth -36 to -52.7, then forward to -43.75 | came forward to -28.1 first, with a hump of 3.8 units | within 0.3 units at every 100 ms |
| 3 | The other books while they rise | at the row's depth from the first frame | started at the featured depth and shrank | at the row's depth |
| 4 | Leaving | sinks with the scroll, gone when the scroll ends | lingered 600 to 1000 ms | sinks with the scroll |
| 5 | Delay per place | within 5 px at 723, 775, 807 ms | 704, 905, 1108 ms | within about 40 ms |
| 6 | Air between spines | 29.5 px | 18 px | spine factor 0.96, between the two captured values |
| 7 | Slide after a step | 32, 172, 481, 887 ms, no overshoot | ran 0.5 to 0.7 units past the middle | 31, 171, 480, 888 ms |
| 8 | Height of the row | covers from 167 to 758 px | 270 to 858 px | 165 to 760 px |
| 9 | Pointer tilt in the row | 1.14 degrees | 4.51 degrees | 1.18 degrees |
| 10 | Opening from the row | 18 forward | 14 forward | 18 forward |
| 11 | Turn of the last featured book on a step | 30, 92, 205, 341 ms | 13, 87, 288, 576 ms | its own damper, 0.14 s |

Corrected afterwards, built to the measured numbers and checked by unit tests, not by a second capture: a press on a far spine is a timed glide (0.4 s for three places) with the cover turn travelling through the books in between; the covers turn as they pass the middle while the row is pulled and the release takes the book the hand brought there; each end of the row keeps a spine and 2 units inside the window, and a row that fits the window is centred and does not slide. The neighbours of a book opened from the row now close up behind it, as on the reference. It also takes its first step forward during the wait before its cover moves: depth -43.75, then -39.50 at 650 ms and -25.75 at 1700 ms, the reference's numbers. In the corrected build the turn from featured pose to spine still lags by 200 to 340 ms. Each reference number is one reading at 1440x900.

Not captured again on our side after these changes: every value above that says "ours now" for the opening comes from the engine or from frames of a scripted visit, not from a second reanimate run.

## 2026-11-23 · Third pass: the corrections, measured

All ten series were captured once more on the corrected build (`ours-4`) and the values read from the same channels as before.

Opening (`c-open-book`), world rotation of the book from its shelf pose:

| ms | reference | ours before | ours now |
| --- | --- | --- | --- |
| 1000 | 6.88 | 47.44 | 5.80 |
| 1400 | 15.11 | 85.37 | 26.72 |
| 1800 | 56.15 | 122.82 | 68.29 |
| 2200 | 116.56 | 122.82 | 119.83 |
| 2600 | 122.50 | 122.82 | 122.82 |

Degrees. 10, 50, 90 and 99 % of the turn: reference 1335, 1835, 2146, 2252 ms; before 562, 1216, 1582, 1697 ms; now 1160, 1741, 2107, 2224 ms. The worst difference fell from 80 degrees to 12. What is left: during the cover stage our book body turns with the shelf-to-reader blend, while the reference keeps the body almost still until the pages part. That is a difference between a rig of bones and our two boards, and it is the open item here.

Pointer tilt (`b-hover-home`), world rotation of the book from rest, pitch / yaw / roll in degrees:

| ms | reference | ours before | ours now |
| --- | --- | --- | --- |
| 217 | 0.096 / -2.801 / 0.004 | 0.594 / -2.566 / 0.972 | 0.096 / -2.801 / 0.000 |
| 417 | 0.297 / -2.356 / 0.012 | 0.672 / -2.173 / 0.696 | 0.297 / -2.356 / 0.000 |
| 817 | -0.373 / 0.218 / 0.001 | -0.349 / 0.221 / 0.129 | -0.373 / 0.218 / 0.000 |
| 1417 | 0.736 / -1.212 / 0.016 | 0.803 / -1.132 / 0.032 | 0.720 / -1.186 / 0.000 |
| 2417 | 1.139 / -1.821 / 0.036 | 1.256 / -1.742 / 0.033 | 1.138 / -1.822 / 0.000 |

Effect fades after the hover (`f-hologram-ebook-row`, `f-radio-audiobook-row`):

| ms | hologram, reference | hologram, ours | radio, reference | radio, ours |
| --- | --- | --- | --- | --- |
| 50 | 0.0000 | 0.0000 | 0.0000 | 0.0000 |
| 100 | 0.1000 | 0.1000 | 0.3333 | 0.3334 |
| 117 | 0.1915 | 0.1914 | 0.5582 | 0.5583 |
| 133 | 0.2695 | 0.2695 | 0.7010 | 0.7011 |
| 150 | 0.3439 | 0.3438 | 0.8025 | 0.8025 |
| 300 | 0.7458 | 0.7457 | 0.9949 | 0.9949 |
| 800 | 0.9892 | 0.9892 | 1.0000 | 1.0000 |

The pointer value both effects use eases the same way: 0.3412, 0.4609, 0.5240, 0.5841 at 50, 100, 150 and 300 ms against 0.3438, 0.4647, 0.5285, 0.5895. The small offset is the different place of the row on the two pages.

Detail view (`g-view-details`), sideways position of the book:

| ms | reference | ours |
| --- | --- | --- |
| 100 | -0.4455 | -0.3093 |
| 200 | -1.7820 | -1.4972 |
| 320 | -4.5602 | -4.1001 |
| 450 | -7.5157 | -7.2203 |
| 640 | -9.1227 | -9.1076 |
| 800 | -9.1239 | -9.1229 |

Ours follows the same curve one frame late. The clock of the move now starts on the frame of the press; that change is not captured yet.

Still values: shelf pivot y -3.0547 (reference -3.0553), reader pivot y -2.9817 (-2.9819), key shadow radius 6.000 on the shelf and 9.739 in the reader (6 and 9.74).

Wall shadow: the first correction was not enough. Captured, the wall opacity was 0.243 on the shelf against 0.193 and 0.127 in the reader against 0.053. The reference measures the far corner of a box around a larger model than our case. The reach of our case is now stretched by 1.26 and the fade is complete while the reader is open. Read from the running page after that change: 0.192 on the shelf, 0.0534 in the reader.

Lens: after a press on its button neither side moves the lens (no channel changes), so both stay in the middle. Following the pointer, our centre differs from the reference by up to 0.017 of the screen width along the path; the two captures do not start from the same place, so this is not conclusive.

Not measured again: the toolbar timing, the closing sequence, the lens rim, the paper colour.

Found on the way, and changed:

- The Noon theme carries the same lift of key and sun as Morning (3.971 and 2.893, read from the running reference). Ours had 3.61 and 2.63 there.
- Next to a frame of the reference our covers were flat. Cloth now keeps a soft mottle at any distance, titles and ornaments are pressed into it, the joints have their groove, and book surfaces take sixteen shadow samples instead of five.

## 2026-11-23 · Second pass: every series compared, twelve differences

All ten series were captured again on our build from a clean clone and compared with the reference, uniform by uniform and frame by frame. The lights match exactly. Twelve differences were found, ranked by how visible they are. All twelve were changed in the code the same day. None of the changes has been captured again yet, so the last column says what was done, not what was measured afterwards.

| # | Difference | By how much | Change |
| --- | --- | --- | --- |
| 1 | Wall shadow too dark | Effective wall opacity 0.497 against 0.193 on the shelf, 0.249 against 0.053 in the reader | The fade follows the point of the book that is farthest from the wall, eased at 10 per second. Before, it followed the pivot of the book |
| 2 | Wall blur patch never ran | The wall used the stock 5 samples, and every shadow on books and pages was 21 percent too soft | The patch replaced a call inside its own function instead of the one in `main()`. Fixed, and the key light keeps its preset radius |
| 3 | Opening too early | 10, 50 and 90 percent of the turn at 562, 1216 and 1582 ms against 1335, 1835 and 2146 ms | A pause of 0.65 s before the cover moves, no second easing on position and turn, pages part from the moment the cover is half way |
| 4 | Book too low on the shelf | Pivot at y -4.4925 against -3.0553 | The spec value had been read after the book had started to move again. Four captures agree on -3.0553 |
| 5 | Detail view too fast | Book shift 50 percent done at 117 ms against 320 ms; picture narrowed in 100 ms against 150 to 567 ms | A timed ease over 0.64 s. The picture's width change did not animate at all, because it started from `auto` |
| 6 | Reader controls too soon | 33 to 167 ms after the click against 2267 to 2400 ms | They appear when the pages have parted |
| 7 | Escape closed too much | Reference leaves the book and stays in the detail view | One step back per press |
| 8 | Open book 16.5 px low, 3.5 px right | Pivot (0.11, -3.506) against (0, -2.982) | Reading position corrected |
| 9 | Paper darker and warmer | Left margin (181, 176, 170) against (191, 190, 192), right (221, 214, 197) against (232, 227, 222) | More gain on paper, cooler page stock, lighter page edges. Expected after the change: within 3 in red and green, about 8 short in blue |
| 10 | Effect fades | Radio 20 per second from 0 ms against a third per frame after 100 ms; hologram 6 per second against a tenth per frame; our effect pointer jumped | Rates 24.33 and 6.32 per second, the same 100 ms wait for both, pointer eased at 12.8 per second |
| 11 | Lens | Ours opened at the pointer, over the toolbar; outer diameter 565 px against 571 px, bright band inside the ring instead of in its outer part | Opens in the middle of the picture and follows from the next pointer move; rim rebuilt from the measured fades |
| 12 | Pointer tilt | Up to 0.97 degrees of roll and 0.50 degrees of pitch error at 217 to 267 ms | The tilt turns about the axes of the room, not of the leaning book |

Found on the way:

- The wall shadow in the Night theme had a hard edge across the picture. It came from the pointer spot light, which casts a shadow at night. The wall now takes only the key light's shadow, as the reference does.
- Open near its first or last page, a book showed its endpaper where a page should be. The page stacks were placed as if their board lay flat, while the two-stage opening folds one board right back. Fixed in the stack geometry, with a unit test for folded-back headings.
- `e-magnifier-on` as the runner scripts it is not valid on our page: its selector matches the lens button of the first picture first. It was captured again with the toolbar button as the target. The runner needs a distinct target on our side.

Not compared, and why: the cover bones (ours has no bones, world rotation was compared), the hologram light boost (ours has no separate value for it), page edges (the sampled regions may not be the same surface on the two models), cover highlights (the artwork differs).

## 2026-11-23 · A flaw in the first reference captures

Four series used `canvas` as the pointer target. On the reference the first `canvas` in the page is a strip 1 pixel wide and 8192 high, not the 3D canvas, so the pointer path was not the intended one. Affected: `b-hover-home`, `e-magnifier-move`, `f-hologram-ebook-row`, `f-radio-audiobook-row`. The final frame of the hologram series shows a normal book, which is how this was found.

Fix: the runner now targets `canvas[data-engine]` (three.js marks its canvas with that attribute) and finds the two effect rows by their accessible name. Closing uses the Escape key. The four series and `c-close-book` were captured again on both sides.

Not affected: `c-open-book`, `d-turn-next`, `d-turn-previous`, `e-magnifier-on`, `g-view-details` (button clicks by accessible name).

## 2026-11-23 · Open book (`c-open-book`)

Compared: yaw of the group that turns the cover to the camera (reference `Group#12.rotation.y`, ours `Group#14.rotation.y`, sign flipped), in radians.

| ms | reference | ours (before) |
| --- | --- | --- |
| 0 | -1.571 | -1.571 |
| 400 | -1.468 | -1.310 |
| 800 | -1.483 | -0.516 |
| 1000 | -1.420 | 0.013 |
| 1200 | -1.158 | 0.013 |
| 1400 | -0.746 | 0.013 |
| 1600 | -0.191 | 0.013 |
| 1800 | -0.023 | 0.013 |

Mean absolute difference 0.50 rad. Reading: the reference holds its yaw for about a second while the front cover swings open, then turns between 1.0 and 1.7 s. Ours turned during the first second.

What the data showed about the mechanism: until the pages part, every leaf lies on the back board and only the front cover opens, all the way round, so the reader sees the inside of the cover and the first page. Then the pages part to the reading place and the book turns to keep the spread facing the camera.

Change made: `Book.setOpen` takes a page progress; the reader runs the cover over 0.98 s and starts the page stage at 0.82 s for 0.9 s with the asymmetric S-curve. The second pass (above) measured this version: still 0.6 to 0.8 s early, because the reference waits 0.65 s before the cover moves.

Also from this series: no depth or scale channel of the book root changes when a featured book opens. Our reader moved the book 14 units forward and scaled it by 1.1, values that belong to opening from a spine row. Defaults are now 0 and 1. The open spread is about 940 px wide in our build and about 885 px in the reference at 1440x900.

## 2026-11-23 · Magnifier on (`e-magnifier-on`)

The reference has no lens uniform that animates after the click, and frame 15 (50 ms after the click) shows the lens complete. Ours faded in over about 350 ms. The fade rate default is now 120 per second, which completes within three frames.

## 2026-11-23 · Page turn backward (`d-turn-previous`)

| ms | reference | ours | difference |
| --- | --- | --- | --- |
| 50 | 0.9338 | 0.9119 | -0.0219 |
| 200 | 0.7547 | 0.7362 | -0.0185 |
| 500 | 0.4416 | 0.4241 | -0.0175 |
| 800 | 0.1790 | 0.1701 | -0.0089 |
| 1100 | 0.1102 | 0.1083 | -0.0019 |
| 1700 | 0.0710 | 0.0702 | -0.0008 |
| 2400 | 0.0494 | 0.0490 | -0.0004 |

Mean absolute difference 0.0065 of a turn, worst -0.022 at 50 ms. The difference is constant while the leaf cruises and vanishes at the landing, which is what a start one frame early looks like (one frame of cruise is about 0.018). Open: find why the reference starts a backward turn one frame later than a forward one.

## 2026-11-23 · Page turn forward (`d-turn-next`), after the landing fix

| ms | reference | ours | difference |
| --- | --- | --- | --- |
| 50 | 0.0881 | 0.0881 | +0.0000 |
| 350 | 0.4219 | 0.4223 | +0.0004 |
| 650 | 0.7212 | 0.7219 | +0.0008 |
| 950 | 0.8722 | 0.8725 | +0.0003 |
| 1400 | 0.9147 | 0.9149 | +0.0001 |
| 2000 | 0.9404 | 0.9405 | +0.0001 |
| 2400 | 0.9510 | 0.9510 | +0.0001 |

Mean absolute difference 0.0002 of a turn over 48 samples, worst +0.0008 at 650 ms.

History: the first comparison, with a landing pull of 0.006 in our physics, matched to 0.001 for 600 ms and then ran ahead by up to 0.062, because ours came down in 2 s while the reference creeps. The pull default was set to 0 and the measured curve became a unit test fixture (`src/engine/reader/leaf-physics.test.ts`).

## Still to compare

Every series has to be captured once more on our side to confirm the twelve changes. Never compared so far: `a-scroll` (shelf scroll with damping; the reference capture is at 30 frames per second), touch and narrow screens, the Noon and Night themes.

Pixel comparison (frame against frame) is only meaningful for geometry, light and motion, not for artwork: our covers, pages and backgrounds are our own on purpose.
