# Parity log

Reference and our build are captured with the same tool (reanimate), the same settings (Edge, 1440x900, virtual clock, 60 frames per second, light theme pinned) and the same interaction script (`tools/reanimate/capture-series.mjs`). Values are compared with `tools/reanimate/compare-channel.mjs`. This file records what was compared and what came out. Newest entry first.

## Summary

| Interaction | What was compared | Result | State |
| --- | --- | --- | --- |
| Page turn forward | turn progress per frame, 50 to 2400 ms | mean difference 0.0002 of a turn, worst 0.0008 | matches |
| Page turn backward | turn progress per frame, 50 to 2400 ms | mean 0.0065, worst 0.022 at 50 ms: ours starts one frame early | close, one-frame offset open |
| Open book | yaw of the book while opening | reference turns after the cover has opened, ours turned at once | rebuilt in two stages, to re-measure |
| Open book | depth and scale | reference keeps a featured book at its depth and scale | corrected |
| Magnifier on | time until the lens is fully on | reference: fully on 50 ms after the click, no fade; ours faded over 350 ms | corrected, to re-measure |
| Hover, lens move, hologram, radio | n/a | first reference captures aimed at the wrong element | being re-captured |

## 2026-11-23 · A flaw in the first reference captures

Four series used `canvas` as the pointer target. On the reference the first `canvas` in the page is a strip 1 pixel wide and 8192 high, not the 3D canvas, so the pointer path was not the intended one. Affected: `b-hover-home`, `e-magnifier-move`, `f-hologram-ebook-row`, `f-radio-audiobook-row`. The final frame of the hologram series shows a normal book, which is how this was found.

Fix: the runner now targets `canvas[data-engine]` (three.js marks its canvas with that attribute) and finds the two effect rows by their accessible name. Closing uses the Escape key. The four series and `c-close-book` are being re-captured on both sides into `reanimate-series-2` and `captures/ours-2`.

Not affected: `c-open-book`, `d-turn-next`, `d-turn-previous`, `e-magnifier-on`, `g-view-details` (button clicks by accessible name), and the first-hand hologram screenshots, which used direct pointer moves.

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

Change made: `Book.setOpen` takes a page progress; the reader runs the cover over 0.98 s and starts the page stage at 0.82 s for 0.9 s with the asymmetric S-curve. To be captured and compared again.

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

| Series | Reference | Ours | Compared |
| --- | --- | --- | --- |
| `b-hover-home` (pointer tilt, spot follow) | re-capturing | re-capturing | no |
| `c-open-book` | yes | to re-capture after the two-stage change | first pass, above |
| `c-close-book` | re-capturing | re-capturing | no |
| `d-turn-next` | yes | yes | yes |
| `d-turn-previous` | yes | yes | yes |
| `e-magnifier-on` | yes | re-capturing | first pass, above |
| `e-magnifier-move` | re-capturing | re-capturing | no |
| `f-hologram-ebook-row`, `f-radio-audiobook-row` | re-capturing | re-capturing | no |
| `g-view-details` | yes | yes | no |
| `a-scroll` (shelf scroll with damping) | yes, at 30 fps | no | no |

Pixel comparison (frame against frame) is only meaningful for geometry, light and motion, not for artwork: our covers, pages and backgrounds are our own on purpose.
