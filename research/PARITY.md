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
| Wall shadow | opacity on the shelf and in the reader | 0.192 and 0.0534 against 0.193 and 0.0534 | matches |
| Detail view | sideways move of the book over time | same curve and end value (-9.1229 against -9.1239), one frame late in the capture; corrected afterwards | close |
| Open book | when the book turns | 10, 50, 90 and 99 % at 1160, 1741, 2107 and 2224 ms against 1335, 1835, 2146 and 2252 | close: up to 175 ms early at the start, 28 ms at the end |
| Pages parting | page progress at seven times, 1700 to 2300 ms | 0.159, 0.300, 0.477, 0.665, 0.833, 0.962, 1 against 0.172, 0.292, 0.458, 0.639, 0.808, 0.943, 1 | matches to 0.03 |
| Pages parting | path of the two stacks | both swing out by their final angle times the square of the page progress, as read in the reference's code and seen in its frames | matches by rule; no capture of ours since |
| First leaf under the opening cover | brightness on screen | 228 and 210 of 255 at the two brightest frames against 228 and 214; it was 255, burnt out, before | matches |
| Pointer over the open book | reading place the case answers to, pointer on three buttons | 0.560, 0.688 and 0.352 from the rule against 0.556, 0.694 and 0.360 captured | matches to 0.008 |
| Resting spread | belly of the pages | about 1.1 units high, a third of the way out; ours built to that | built from one frame, not measured again |
| Paper | brightness and colour of the pages | the reference prints titles on different paper: white (matched earlier, blue about 8 of 255 short) and cream, 188, 181, 160 lit. A book can now name its paper | open: the cream is ours, not sampled |
| Row of spines | 17 differences found against a capture, the nine largest corrected | cover turn of the arriving book 20.8, 59.5, 79.5 degrees against 21.3, 57.8, 77.9; slide 31, 171, 480, 888 ms against 32, 172, 481, 887; covers span 165 to 760 px against 167 to 758 | close: three differences open |

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

Open: a press on a far spine (the reference glides in about 400 ms, ours overshoots by 16 %), choosing while the row is pulled by hand (the reference follows the hand, ours waits for the release), the clamp at the ends of the row, and that the neighbours of a book opened from the row close up. In the corrected build the turn from featured pose to spine still lags by 200 to 340 ms. Each reference number is one reading at 1440x900.

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
