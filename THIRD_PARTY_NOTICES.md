# Third-party notices

## Shipped in a production build

| Component | Package | Version | Licence | Copyright |
| --- | --- | --- | --- | --- |
| three.js | `three` | 0.187.0 | MIT | Copyright 2010-2026 three.js authors |
| Newsreader (variable, roman and italic, optical size axis) | `@fontsource-variable/newsreader` | 5.3.0 | SIL Open Font License 1.1 | Copyright 2020 The Newsreader Project Authors |
| IBM Plex Mono (400, 500) | `@fontsource/ibm-plex-mono` | 5.3.0 | SIL Open Font License 1.1 | Copyright 2017 IBM Corp. |
| Module preload helpers in the generated JavaScript | `vite` | 8.3.7 | MIT | Copyright 2019-present VoidZero Inc. and Vite contributors |

The licence texts ship inside each package under `node_modules/`. Copy them into the published build before a public release.

## Used for development, not shipped

| Component | Version | Licence |
| --- | --- | --- |
| TypeScript | 7.0.2 | Apache-2.0 |
| Vite | 8.3.7 | MIT |
| Vitest | 5.1.0 | MIT |
| happy-dom | 21.0.4 | MIT |
| `@types/three` | 0.187.0 | MIT |
| Playwright (in `tools/capture`) | 1.63.0 | Apache-2.0 |

## Published methods implemented in this project's own code

| Method | Source | Where |
| --- | --- | --- |
| Sheen distribution for cloth | Alejandro Conty Estevez and Christopher Kulla, "Production Friendly Microfacet Sheen BRDF", 2017 | `src/engine/book/surface.ts` |
| Sheen visibility term | David Neubelt and Matt Pettineo, "Crafting a Next-Gen Material Pipeline for The Order: 1886", 2013 | `src/engine/book/surface.ts` |
| Bump mapping from screen-space derivatives | Morten S. Mikkelsen, "Bump Mapping Unparametrized Surfaces on the GPU", 2010 | `src/engine/book/surface.ts` |
| Critically damped smoothing | The "smooth damp" form common to game engines, after Thomas Lowe, "Critically Damped Ease-In/Ease-Out Smoothing", Game Programming Gems 4 | `src/engine/core/math.ts` |
| Sample placement for soft shadows | Vogel disk with interleaved gradient noise rotation, using three.js's own helper functions | `src/engine/stage/wall.ts` |

## Demo texts

Public-domain works fetched from Project Gutenberg. See `PROVENANCE.md`.
