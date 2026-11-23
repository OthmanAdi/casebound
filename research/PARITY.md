# Parity log

Reference and our build are captured with the same tool (reanimate), the same settings (Edge, 1440x900, virtual clock, 60 frames per second, light theme pinned) and the same interaction script (`tools/reanimate/capture-series.mjs`). This file records what was compared and what came out. Newest entry first.

## 2026-11-23 · Page turn, button triggered (`d-turn-next`)

Compared: turn progress of the leaf per frame. Reference channel `uPageTurnProgress` on the turning leaf's material, ours `uTurn`.

First run, with our landing pull at 0.006:

| Time after the click | Reference | Ours | Difference |
| --- | --- | --- | --- |
| 50 ms | 0.088 | 0.088 | 0.000 |
| 100 ms | 0.150 | 0.150 | 0.000 |
| 200 ms | 0.264 | 0.264 | 0.000 |
| 400 ms | 0.473 | 0.474 | 0.000 |
| 600 ms | 0.674 | 0.675 | +0.001 |
| 800 ms | 0.829 | 0.839 | +0.010 |
| 1000 ms | 0.880 | 0.908 | +0.028 |
| 1200 ms | 0.901 | 0.941 | +0.040 |
| 1600 ms | 0.925 | 0.981 | +0.055 |
| 2000 ms | 0.940 | 0.999 | +0.059 |

Mean absolute difference over 48 samples from 50 to 2400 ms: 0.032 of a full turn. Worst: +0.062 at 1900 ms.

Reading: launch, acceleration and cruise match to three decimals for the first 600 ms. The whole difference is the landing: ours came down in about 2 s, the reference keeps creeping (0.95 at 2.4 s).

Change made: the landing pull default is now 0, which is the reference's behaviour. The measured curve is a unit test fixture (`src/engine/reader/leaf-physics.test.ts`, tolerance 0.03 at ten sample times), so this parity is checked on every run of the tests. A second capture after the change is still to do.

## Still to compare

| Series | Reference captured | Ours captured | Compared |
| --- | --- | --- | --- |
| `b-hover-home` (pointer tilt, spot follow) | yes | no | no |
| `c-open-book` | yes | no | no |
| `c-close-book` | failed, to re-run | no | no |
| `d-turn-next` | yes | yes | yes, above |
| `d-turn-previous` | yes | no | no |
| `e-magnifier-on`, `e-magnifier-move` | yes | no | no |
| `f-hologram-ebook-row`, `f-radio-audiobook-row` | yes | no | no |
| `g-view-details` | to confirm | no | no |
| `a-scroll` (shelf scroll with damping) | yes, at 30 fps | no | no |

Pixel comparison (frame against frame) is only meaningful for geometry, light and motion, not for artwork: our covers, pages and backgrounds are our own on purpose.
