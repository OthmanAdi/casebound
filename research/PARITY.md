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
| Wall shadow | darkness and blur | ours 2.6 to 4.7 times too dark, its blur patch never ran | corrected, to measure again |
| Open book | when the book turns | ours 0.6 to 0.8 s early | corrected, to measure again |
| Shelf | height of the resting book | ours 45 px low | corrected, to measure again |
| Shelf | pointer tilt | up to 0.97 degrees of roll that the reference does not have | corrected, to measure again |
| Detail view | book shift and picture width over time | ours far too fast | corrected, to measure again |
| Reader controls, Escape | when the controls appear, what Escape closes | ours at the click; ours closed everything | corrected |
| Hologram and radio | fade rate and start | radio 20 per second with no wait, reference 24.3 after 100 ms | corrected, to measure again |
| Lens | where it opens, rim | ours jumped to the pointer; rim band on the wrong side | corrected, to measure again |
| Paper | brightness and colour of the pages | ours 6 to 11 percent darker and warmer | brightness corrected, a blue difference of about 8 of 255 remains |

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
