# SPEC: measured behaviour of the reference, as a build contract

Reference: https://stripe.press/ as served on 2026-11-22 and 2026-11-23. This file is the short, numbered version of the reports next to it. Engine code cites these ids (for example `S-LIGHT-2`). When a value here and a report disagree, the report with the evidence line wins and this file gets fixed.

Sources: `01-rendering.md` (R), `02-motion.md` (M), `03-runtime.md` (L, live Edge session), `04-harvest-tools.md` (H, reanimate runs), `findings.md` (F, first-hand screenshots).

Verification levels: **code** = read in the shipped bundle. **live** = also read from the running scene in Edge 156. **frames** = also measured frame by frame under a virtual clock. A value marked only **code** is still to be confirmed by the capture series in `tools/reanimate/capture-series.mjs`.

Units: world units as in the reference scene. One book is 13.52 wide, 20.13 tall. Angles in degrees unless marked rad. Time in seconds unless marked ms.

What this file is not: it holds no code, no shader text, no artwork and no copy from the reference. It holds numbers, structure and technique.

---

## 1. Views and routes

| Id | Fact | Level | Source |
|---|---|---|---|
| S-VIEW-1 | Five views: `browse` (featured books, one per scroll slot), `coverflow` (spine row), `details` (`/book/<slug>`), `lookInside` (`/book/<slug>/page/<n>`), `cart` | code | M §2 |
| S-VIEW-2 | Home is native document scroll. One fixed canvas (100vw x 100lvh, `pointer-events: none`, z-index above the DOM panels) draws all books. Hit testing is done with DOM rectangles projected from the meshes, not by raycasting | live | L §E, M §6.1 |
| S-VIEW-3 | A settled view is announced on `<html>`: `data-press-agent-ready="true"`, `data-press-view="<path>"` | live | L |
| S-VIEW-4 | Keys: Left/Right step the row, Space opens the reader, Escape closes in order (cart, production, reader, detail), `m` toggles the magnifier, `b` jumps to the books section, `i` inverts, page keys repeat from 300 ms down to 50 ms over a 3 s hold | live (first four), code | L §B, M §3.3 |
| S-VIEW-5 | Idle auto-advance: after 3 s without input the page steps to the next featured book in 1 s (cosine in-out). First wheel or touch turns it off for good | frames | H §a0, M §3.4 |

## 2. Renderer and camera

| Id | Fact | Level | Source |
|---|---|---|---|
| S-REN-1 | three.js r185, WebGL2, `antialias` on, `alpha` on (canvas is transparent over DOM background photos), `powerPreference: high-performance`, `preserveDrawingBuffer` on (off on the low-power tier) | live | R §2, L §A |
| S-REN-2 | Pixel ratio clamped to 1..2 (1..1.5 low power) | code | R §2 |
| S-REN-3 | Renderer tone mapping ACES Filmic, exposure 1, sRGB output. Book and page shaders bypass both: they write authored colour straight out. Only built-in materials (page-edge block, shadow wall, pen) are tone mapped | live (renderer), code (bypass) | R §0.2, L §A |
| S-REN-4 | Shadows on, PCF, 2048 map per casting light (512 under 900 px). Off on low power | live | R §2, L §A |
| S-REN-5 | Draw on demand: the loop advances only when something is dirty, a view holds a lease (reader, effect, transition), or a 1 s heartbeat fires. Idle shelf drew about 4.6 frames per second | live | R §2, L |
| S-CAM-1 | PerspectiveCamera fov 18, near 1, far 1000, position (0.11, -1.32, 54), looking down -z at the pivot (0.11, -1.32, -36.13). It did not move in any tested interaction | live | R §3, L §A |
| S-CAM-2 | Camera intro: z starts 120 below rest and eases back over 2 s (1.5 s on a deep link), ease-in-out quad. Measured: camera z -62 to 54 | frames | M §10, H §a |
| S-CAM-3 | No fov change with viewport. Under 900 px the books scale to 0.77 instead | code | R §3 |
| S-CAM-4 | Visible area at the browse plane (z = -36): about 28.6 world high; r3f viewport at the origin plane 27.377 x 17.111 at 1440x900 | live | L §A |

## 3. Light rig

Four lights in one rig, rewritten every frame from a preset. Presets blend field by field.

| Id | Light | Browse | Dark | Look inside | Dark look inside | Level |
|---|---|---|---|---|---|---|
| S-LIGHT-1 | Ambient colour / intensity | #ffffff / 0.83 | #ddcbb4 / 0.58 | #7f7d7a / 1.4 | #cfc4b4 / 0.55 | live (browse, look inside) |
| S-LIGHT-2 | Key (directional, casts shadow) colour / intensity / position | #b3aba2 / 3.61 / (-2.4, 3.5, 9.9) | #fdb958 / 1.77 / (-35.8, 26, 41.4) | #f9f6f0 / 1.41 / (9.4, 4.6, 4.3) | #ffe8c8 / 1.03 / (-7.9, 25.4, 11.1) | live (browse) |
| S-LIGHT-3 | Sun (directional, no shadow) colour / intensity / position | #aea7a7 / 2.63 / (22.5, 33.5, 6.8) | #d6fffc / 2.33 / (-4.5, -4.5, 7.5) | #f5f7ff / 1.4 / (-15, -15, 39.7) | #d6fffc / 1.6 / (5.9, -6.9, 6.7) | live (browse) |
| S-LIGHT-4 | Pointer spot colour / intensity / angle rad | #fffadb / 0.5 / 0.36 | #fffadb / 0.79 / 0.36 | as browse | #fffadb / 2.28 / 0.22 | live (browse) |
| S-LIGHT-5 | Key shadow: frustum half / near / far / bias / normalBias / radius | 62.1 / 0.001 / 256.8 / -0.00253 / 0.0165 / 6 | 66.1 / 0.001 / 280 / -0.006 / 0.0387 / 10.44 | 51.9 / 0.001 / 256.8 / -0.00118 / 0.0401 / 9.74 | 66.1 / 0.001 / 280 / -0.00123 / 0.0387 / 10.44 | live (browse) |

| Id | Fact | Level | Source |
|---|---|---|---|
| S-LIGHT-6 | Light theme multiplies key and sun intensity by 1.1. Confirmed live: key 3.971 = 3.61 x 1.1, sun 2.893 = 2.63 x 1.1 | live | R §4.1, L §A |
| S-LIGHT-7 | Spot: penumbra 0.94, decay 0, infinite distance, base position (24, 5.4, 10). It eases 6 % per frame toward (base.x + 36 sin(0.7 pi px), base.y + 36 sin(0.6 pi py), 10), px and py being the pointer in -1..1. Its target eases toward 30 % of that offset on the plane z = -50. Casts shadows only in the dark theme. No pointer coupling on touch | live (follow seen: x 24 to 57.2, y 5.4 to -30.4) | R §4.1, L §B |
| S-LIGHT-8 | Key and sun shift with the pointer by up to 0.7 in x and y (and +4 in z) in the light theme, unsmoothed | live | R §4.1, L §B |
| S-LIGHT-9 | Ambient colour is pulled 25 % toward a pale version of the active book's background colour in the colour theme. Key colour is pulled 20 % toward the half-desaturated book colour | code | R §4.1 |
| S-LIGHT-10 | Blend rates: dark weight 1 per second, look-inside 1.8 per second through a smoothstep, colour tint 3 per second. Shadow map size switches at the halfway point | code | R §4.2 |
| S-LIGHT-11 | Theme by local hour: 8 to 15 light ("Morning"), 5 to 8 and 15 to 20 colour ("Noon"), otherwise dark ("Night"). `?midday` forces light. Three buttons override it | live (buttons, Night at hour 0), code | R §4.2, F |
| S-LIGHT-12 | No environment map, no fog, no scene background on the books. A room environment exists only for the 3D highlighter pen | live | R §5, L §A |

## 4. Shadow wall

| Id | Fact | Level | Source |
|---|---|---|---|
| S-WALL-1 | Books float in front of a wall, there is no floor. Plane 172.74 square at (0, -1.482, -54.5), facing the camera, shadow-only material colour #0a0a12, opacity 0.855 | code | R §8 |
| S-WALL-2 | Soft shadow: 16 taps on a Vogel disk, rotated per pixel by interleaved gradient noise. Radius = light radius x (1 + 0.06 x 1.69 x (1 + 2.25 distT)) | code | R §8 |
| S-WALL-3 | distT = smoothstep of the active book's distance from the wall over 2 to 36. Opacity x (1 - 0.875 distT), and x 0.5 more while the reader opens | code | R §8 |
| S-WALL-4 | Tinted grain on the wall, amplitude 0.03, re-seeded each drawn frame | code | R §8 |
| S-WALL-5 | The key light's shadow camera is recentred on the wall centre every frame | code | R §8 |
| S-WALL-6 | In the reader the wall group moves from z -70.25 to -54.5 | live | L §B |

## 5. The book object

| Id | Fact | Level | Source |
|---|---|---|---|
| S-BOOK-1 | One rigged model for all titles: case (boards and spine) skinned to two 5-bone chains (`frontcover1..5`, `backcover1..5`), a mull strip in the spine, an inner spine quad, two page blocks each with one `Curve` morph. Case 3.374 thick, 23.68 tall, 15.91 wide in model units; group scale 0.85 | live (node names, vertex counts) | R §6, L §A |
| S-BOOK-2 | Only thickness varies per title: 1.92 to 3.553 model units (median 3.40). All titles share one trim, ratio 0.672 | code | R §6.3 |
| S-BOOK-3 | Page count sets leaves = ceil(pages / 2) (120 if unknown). Leaf thickness 0.0234. Page 15.6 x 21.45; closed block 15.05 x 22.95 | code | R §6.3 |
| S-BOOK-4 | Cover surface = four maps per title on one atlas 1920 wide: colour, emboss height, foil mask, optional gloss mask. Spine strip is x 875 to 1044. A small swatch corner (u 0 to 0.14, v 0.81 to 1) holds the foil colours. Shared maps: buckram, paper and cardboard grain, glitter tile, colour overlay | code | R §6.4 |
| S-BOOK-5 | Cover shading is not PBR. Blinn-Phong with shininess divided by 4.25, wrapped diffuse, a fabric sheen lobe (sheen colour = albedo 35 % toward white), weave gaps that darken, fibre streak noise at UV x (1100, 55) and (55, 1100), both faded out as texels per pixel go from 1 to 3 | code | R §7.1 |
| S-BOOK-6 | Per-title material numbers (min / median / max): shininess 3.3 / 9.9 / 21.4, reflectiveness 0.17 / 0.50 / 1.01, grain bump 0.010 / 0.055 / 0.103, emboss bump 0.047 / 0.119 / 0.245, cloth gloss 0.31 / 0.67 / 1.12, sheen 0.19 / 0.31 / 0.82, weave 0.01 / 0.11 / 0.32, fibre 0 / 0.032 / 0.068 | code | R §6.5 |
| S-BOOK-7 | Grain defaults (gloss, sheen, weave, fibre, sheen roughness, wrap): buckram 0.30, 0.60, 0.30, 0.05, 0.55, 0.30. Paper 0.70, 0.15, 0.12, 0.02, 0.80, 0.15. Cardboard 0.60, 0.20, 0.18, 0.03, 0.75, 0.20 | code | R §6.5 |
| S-BOOK-8 | Foil: colour picked from the swatch by sines of the surface normal and view position, so it shifts hue as the book turns. Silver foil turns rainbow where the summed highlight of all lights is strong. Gloss: procedural rainbow masked by the gloss map. Glitter: shared tile repeated 30 times at 0.3 | code | R §7.1 |
| S-BOOK-9 | Closed page edges are generated: alternating leaf tints (0.949, 0.925, 0.867) and x 0.86, a procedural 1024 x 256 edge texture (sheet boundaries every 2.4 to 4.8 texels, about 10 % cool and 5 % warm sheets), edge darkening toward cover, spine and ends, tinted by the light hue | code | R §7.6 |
| S-BOOK-10 | Contact darkening everywhere takes the hue of the directional lights, so shadows are tinted, never grey | code | R §7.5 |
| S-BOOK-11 | Texture policy: at most 3 fetches at once, nearest to the active book first; GPU uploads in 6 ms slices per frame; a cover is applied only after 250 ms without interaction; until then a flat base colour shows | code | R §6.4 |

## 6. Scroll, damping and layout

| Id | Fact | Level | Source |
|---|---|---|---|
| S-SCR-1 | scrollY to slot progress: one slot per featured book (canvas height each), one long slot for the spine row (canvas height x 1.67 desktop) | code | M §3.1 |
| S-SCR-2 | Dwell: each featured book holds for a 150 px plateau, with a slow approach before and a ramp after. No CSS scroll snap anywhere | code | M §3.1 |
| S-SCR-3 | Wheel-notch bridge: a jump of 24 px or more is ramped linearly over clamp(1.15 x notch interval, 60, 160) ms | code | M §3.1 |
| S-SCR-4 | Progress is then smoothed with a SmoothDamp, smooth time 0.066 s desktop, 0.0945 s mobile, dt clamped to 1/240..1/30 | frames (decay ratios fall from 0.61 to 0.21 per 50 ms, which fits a smooth-damp and not a plain lerp; smooth time not fitted yet) | M §4.2, H §a |
| S-SCR-5 | Measured response to a 600 px stepped wheel: the book starts about 117 ms after the first step and is within 1 % about 200 ms after the last | frames | H §a |
| S-SCR-6 | Active index changes only when progress leaves +-0.65 around the current integer; the scene sees it 200 ms late | code | M §3.1 |
| S-SCR-7 | Spine row seat: a wheel that would cross the seat locks native scroll and glides there in 180 to 650 ms (ease-out cubic with velocity, else ease-in-out quad) | code | M §3.2 |
| S-LAY-1 | Featured book: x 0, y = b x 24 + base, z -36, where b = progress - slot. Visible for -1.8 < b < 1.8 | frames (y -3.06 to 17.14 over the measured scroll) | M §5.2, H §a |
| S-LAY-2 | Rest pose: Euler (-28, 32, 12). Leaving upward: yaw 75 then roll 90. Arriving from below: yaw 155 then roll 90. Blend amount = ease-in-out quad of (abs(b) - 0.1) / (0.8 - 0.1), end 1.2 when leaving upward | code | M §5.2 |
| S-LAY-3 | Exit boost above b = 0.6: y += ((b - 0.6) / 0.4)^3 x 24 x 2.25 | code | M §5.2 |
| S-LAY-4 | Spine row: books stand at z about -53.75, pitch = rendered thickness + 0.9375 gap. Selected book yaws 90 with exponent 1.6, comes 8 forward, neighbours go 2 back. Hovered spine comes 3.78 forward | live (z -53.75, hover to -49.97, selected at -43.75 rotated -90) | M §5.4, L §B |
| S-LAY-5 | Row offset follows the selection with SmoothDamp 0.26 s (0.06 s while dragging) | code | M §4.2 |
| S-LAY-6 | Stacked copies: step = 0.85 x thickness + 0.4, reveal 0.4 s with 0.05 s stagger, hover lift 5.04 x gaussian (sigma 0.11 NDC) | code | M §5.3, §6 |

## 7. Pointer on a book

| Id | Fact | Level | Source |
|---|---|---|---|
| S-PTR-1 | Tilt: yaw 0.16 x px, pitch -0.1 x py rad, exponential rate 4 per second. Weight 0.25 in the row | live (about 1.2 degrees seen in the row) | M §6, L §B |
| S-PTR-2 | Spin by drag: 0.0084375 rad per px (mouse), 0.01125 (touch). Spring toward the drag target k 480, c 42 idle; k 900 to 3600 while pressed. Inertia x 0.95 per frame, capped 0.42 rad per frame | code | M §6, §4.2 |
| S-PTR-3 | Pitch levels itself 2 s after release (0.6 s on touch) | code | M §6 |
| S-PTR-4 | Covers lag the spin: flap angle up to 28, back cover x 1.5 with opposite sign, follower omega 40 | code | M §6 |
| S-PTR-5 | Cover peek on hover of the focused book: 5 degrees, 7.5 % per frame | code | M §6 |
| S-PTR-6 | Click = release within 500 ms and 5 px | code | M §6 |

## 8. Detail view

| Id | Fact | Level | Source |
|---|---|---|---|
| S-DET-1 | Open from the row, three tracks: others sink 0 to 600 ms, active book flies 200 to 800 ms (both ease-in-out quad), background reveals 300 to 820 ms (ease-out cubic). Commit at 820 ms | code | M §7.1 |
| S-DET-2 | Canvas shifts by -20 vw over 640 ms. DOM panel slides 5 vw over 810 ms, copy fades 220 ms with 45 ms stagger | code | M §7.2 |
| S-DET-3 | Close: reveal fades 500 ms after 100 ms, commit at 400 ms, then the open timeline backwards at half speed (1640 ms) | code | M §7.3 |
| S-DET-4 | Two-column layout at 1440x900: canvas panel about 845 px wide on the left, DOM detail column on the right | live | F |

## 9. Reader: opening, leaves, page turn

| Id | Fact | Level | Source |
|---|---|---|---|
| S-RD-1 | Open: cover progress 0 to 1 in 980 ms (t squared). Page progress starts when cover is at least 0.5 and textures are ready (or after 1200 ms; 6000 ms on a deep link), runs 900 ms with s^2.4 / (s^2.4 + (1 - s)^1.1). Close: both ease-out cubic | code | M §8.1 |
| S-RD-2 | Book pose in the reader: z +14 (root z -43.75 to -25.75 seen live from the row, scale 1 to 1.1, yaw -90 to 0), y +1.47 | live | M §8.2, L §B |
| S-RD-3 | Cover bones: bone 1 turns about Y, bones 2 to 5 about Z by angle x 0.8^n, chain factor 3.36. Front angle = progress x 28 x (2 - 2n), back = 2n x 28, n = reading progress x page progress. Live end pose: front chain z rotations -0.332, -0.381, -0.308, -0.248, -0.199 (quaternion parts); back 0.173, 0.197, 0.158, 0.126, 0.101 | live | M §8.2, L §B |
| S-RD-4 | Page block follows its cover with stiffness 18, damping 7 | code | M §8.2 |
| S-RD-5 | Reader pitch 22 back, minus pointer y x 10 up or 12 down (rate 6 per second). The open book turns with the pointer: yaw about -0.197 to 0.176 (quaternion y) for pointer x 500 to 950 | live | M §8.2, L §B |
| S-RD-6 | Live leaves: 6 at a time, recycled. Each is two planes, 48 x n segments, 15.6 x 21.45, 0.0234 thick | live (502 vertices, 6 material groups) | M §8.3, L §A |
| S-RD-7 | A leaf's shape is a 33-node cross-section built on the CPU each frame from an angle profile and uploaded as a 33 x 2 float texture; the vertex shader interpolates along it. Only the leaf angle (0 to pi) is integrated | code (uniform `uPageTurnProgress` seen animating live) | M §8.3, L §B |
| S-RD-8 | Leaf physics per normalised frame (60 x min(dt, 0.05)): released single leaf accelerates 0.008 x sin, damped by min(0.98, 0.4 x 0.328 + n^2 x 0.55 + brake); several leaves move 0.18 rad per frame; no target = gravity 0.003 with decay 0.985; rendered angle follows by 1 - 0.15^dt | code | M §8.4 |
| S-RD-9 | Turn seen in frames: the leaf is translucent in the air and the reverse print shows through, peaking mid-turn (bleed up to 0.3). A sheen near the gutter grows as the leaf tilts (colour (0.6, 0.52, 0.69), 0.39 x 0.6). First-hand: settled within about 300 ms of the click; code estimate for a free release 1.1 to 1.4 s. Disagreement to be settled by the `d-turn-next` series | live / open | M §8.7 C, D; F |
| S-RD-10 | Drag: angle = pi x min(1, 0.08 (1 - e^(-dx/12)) + 0.92 dx / (width x 0.73)). Under 5 px is a tap. 5 px net in the turning direction commits. Catch mid-flight brakes over 400 ms | code | M §8.5 |
| S-RD-11 | Corner curl under the pointer: 1.97 rad hover, capped pi on drag, pivot (0.74, 0.5) | live (uniforms `uCurlAmount`, `uCurlAngle`, `uCurlSpan` seen changing) | M §8.5, L §B |
| S-RD-12 | Multi-leaf jump (more than 3 leaves): one block in clamp(700 + 45 log2(n), 700, 1100) ms | code | M §8.5 |
| S-RD-13 | Page shading: Phong shininess 12.5, reflectiveness 0.39, paper bump about 0.05, shadow-weighted film grain 0.116 x 0.75 re-seeded every frame, shadows supersampled (2 passes) and mapped through a three-stop ramp | code | R §7.7, M §8.7 E |
| S-RD-14 | Toolbar: previous, copy link to spread, next, magnifier, pink and yellow highlighter, close. A 3D pen follows the pointer on the page while highlighting (roll and pitch springs k 120) | live (buttons), code (pen) | F, M §6.6 |
| S-RD-15 | Sounds: grab, flop on crossing the half turn, shuffle on the gravity drop, noise rub on hover | code | M §8.5, §6 |

## 10. Magnifier

| Id | Fact | Level | Source |
|---|---|---|---|
| S-MAG-1 | A second full-screen pass on the same canvas: draw the scene, copy the framebuffer to a texture, draw a quad with a lens shader. No DOM lens | live | M §9, L §B |
| S-MAG-2 | Live uniforms: magnification 0.308, radius 0.31 of viewport height, edge falloff 0.022, barrel -0.57, ring radius 0.31, ring thickness 0.006, ring opacity 1. About 1.45x at the centre, 1.52x at the inner rim | live | L §B, M §9 |
| S-MAG-3 | Ring: black with a white inner band, antialiased over 2 % of the radius. At 1440x900 the lens is about 558 px across | live (seen about 550 px) | M §9, F |
| S-MAG-4 | Follow: exponential, rate 22 per second, dt capped 0.05 | code | M §9 |
| S-MAG-5 | Available in the detail view and on featured books; button and `m`; off by Escape. Turning it on changes the view of the book (flatter) and draws every frame | live | F, M §9 |
| S-MAG-6 | Mobile: centre pinned, magnification x 1.3, radius x 0.858, double tap inside turns it off | code | M §9 |

## 11. The page light strobe: hologram and radio

Confirmed first-hand in Edge on 2026-11-23 (F, frames `_look-04-hologram`).

| Id | Fact | Level | Source |
|---|---|---|---|
| S-HOLO-1 | Trigger: hovering the e-book row of the detail panel. The whole book, pages included, takes the effect. Fades in after 50 ms, rate 6 per second | live | M §8.7 A, F |
| S-HOLO-2 | Scanlines: two frequencies, 817 and 817/6 per page height, moving at 10 and 6.1 rad/s, strength 0.055 and 0.0385 | code | M §8.7 A |
| S-HOLO-3 | Wave: lines shear sideways by 0.003 and 0.006 UV. Colour split 0.0147 driven by pointer and time. Grain +-0.04 in 4 px blocks stepped at 12 Hz. Tint (0.004, 0.015, 0.087) | live (shear, split and lilac glow seen) | M §8.7 A, F |
| S-HOLO-4 | Pulse: brightness boost = 0.3 x intensity x (0.5 (0.5 sin 1.7t + 0.3 sin 2.9t + 0.2 sin 0.7t) + 0.5) | code | M §8.7 A |
| S-HOLO-5 | Canvas opacity drops to 0.9 while the effect runs | code | R §2 |
| S-RADIO-1 | Trigger: hovering the audiobook row. Rings travel outward from UV (1, 0): frequency 69.8, 1.53 cycles per second, strength 0.32, vertex displacement 0.92, brightness x (1 + 0.35 wave), speech-like envelope 0.55 sin 3.1t + 0.45 sin(1.7t + 1.4). Fade in 20, out 10 per second | live (rippling page surface and waving edge seen) | M §8.7 B, F |

## 12. DOM shell

| Id | Fact | Level | Source |
|---|---|---|---|
| S-DOM-1 | Each featured book has a rounded panel with a photograph behind it; the book overlaps the panel edge and the neighbour | live | F |
| S-DOM-2 | A marquee of titles in a large serif sits above the panel; the current title is upright and strong, neighbours dimmed | live | F |
| S-DOM-3 | Page colours change with theme and with the active book (pale gradient, dark aubergine, khaki in the reader) | live | F |
| S-DOM-4 | Film grain: a fixed full-viewport paper texture at opacity 0.05 over everything, hidden under 900 px | code | R §9 |
| S-DOM-5 | Three font roles: a mono for labels (11 to 17 px), a display serif for titles (about 52 px at 1440), a sans for buttons (15 px). The reference's typefaces are licensed and are not used here; ours are open-licence stand-ins | live (roles and sizes) | L §E |
| S-DOM-6 | `prefers-reduced-motion` is honoured only by DOM pieces in the reference. Our build honours it in the scene too (deliberate difference) | code | M §11 |

## 13. Quality tiers

| Id | Fact | Level | Source |
|---|---|---|---|
| S-Q-1 | Low power (Android, or `?lowpower`): shadows off, pixel ratio up to 1.5 | code | R §11 |
| S-Q-2 | Under 900 px: book scale 0.77, shadow map 512, spot ignores the pointer, canvas shift 0 | code | R §11, M §11 |
| S-Q-3 | Under 700 px or touch: smaller textures, reader textures without mipmaps | code | R §11 |

## 14. Open items

1. Smooth time of the scroll damping, fitted from the frame data (S-SCR-4).
2. Real duration of a button-triggered page turn (S-RD-9).
3. Close-book timing and every series in `tools/reanimate/capture-series.mjs` that has not run yet.
4. The 112 lazy chunks: artifacts scene (hats, totes, socks, cloth swing), the no-WebGL fallback, the DOM background scene. Named in M §1.2, not read.
5. Featured-section scene: a second scene with a point light was seen live and not dumped.
6. Mobile viewport and touch: nothing measured live.

## 15. Deliberate differences in our build

- Own code, own shaders, own geometry, own cover art, open-licence typefaces. Nothing from the reference ships.
- Reduced motion is honoured in the scene.
- No shop, cart, checkout, analytics or audio player logic. The reader, shelf, lights, magnifier and effects are the product.
