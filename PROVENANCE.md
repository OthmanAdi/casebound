# Provenance

What is in this repository, where it came from, and what it is licensed under.

## Original work

Everything under `src/`, `extensions/`, `dev/`, `tools/`, `.agents/` and the documentation was written for this project and is offered under Apache-2.0.

| Kind | Where | Note |
| --- | --- | --- |
| Engine source | `src/engine/**` | Written for this project, with the one exception listed under "Carried over from the author's own work" |
| Site source | `src/site/**`, `index.html` | Written for this project |
| Book geometry | `src/engine/book/volume.ts`, `profile.ts`, `src/engine/reader/leaf.ts` | Generated at run time from dimensions. No model file is loaded or shipped |
| Cover art, cloth and paper grain, page edges, endpapers, pages | `src/engine/book/painter.ts` | Drawn by code from each book's record. No image files |
| Panel pictures | `src/site/backdrop.ts` | Drawn by code from each book's colour. No image files |
| Shaders | `src/engine/book/surface.ts`, `src/engine/stage/wall.ts`, `src/engine/effects/magnifier.ts` | Written for this project as patches on three.js materials and one full-screen pass |
| Book records | `content/books/*/book.json`, `content/library.json` | Written for this project. The blurbs are the author's own words |
| Capture and content tools | `tools/**` | Written for this project |

## Carried over from the author's own work

`src/engine/core/registry.ts`, `registry.test.ts` and `tune.ts` come from the author's project inkleaf (Apache-2.0, same author), with the name prefix changed.

## The reference study

The light, the motion and the structure of this project were studied from one public website, Stripe Press (stripe.press). The study had three parts:

1. The site's shipped client code was read for constants and techniques.
2. The running scene was inspected in a browser: lights, camera, object poses, shader uniform values.
3. Interactions were captured frame by frame under a virtual clock and measured.

What that study contributes here is numbers and structure: light colours, intensities and positions, damping times, poses, timings, the fact that a magnifier is a second pass over the frame, the fact that a leaf's shape is a cross-section curve. These are in `research/SPEC.md`, each with a note on how it was verified, and in the longer reports beside it.

What is not here:

- No source code of that site. Every shader and every function in this repository was written for it. Where a published method is used (a sheen distribution, a visibility term, a bump technique), the paper is named in the source.
- None of its 3D models, cover artwork, page scans, photographs, films, typefaces, texts or brand elements.
- None of the material downloaded for the study. Script bundles, screenshots, frame sequences and scene dumps were kept in a folder that is excluded from version control and is not distributed.

The demo does not present itself as that site or as affiliated with it. Its name, typefaces, colours, cover designs and catalogue are its own.

## Demo texts

The six demo books are works in the public domain. Their texts were fetched from Project Gutenberg's mirror with `tools/content/gutenberg.mjs`, which removes the Project Gutenberg header and licence and keeps up to 140 prose paragraphs per book.

| Book | Author | First published | Project Gutenberg ebook |
| --- | --- | --- | --- |
| Opticks | Isaac Newton | 1704 | 33504 |
| Micrographia | Robert Hooke | 1665 | 15491 |
| The Chemical History of a Candle | Michael Faraday | 1861 | 14474 |
| Flatland | Edwin A. Abbott | 1884 | 201 |
| On the Origin of Species | Charles Darwin | 1859 | 1228 |
| Walden | Henry David Thoreau | 1854 | 205 |

Public domain status is as stated by Project Gutenberg for the United States. Check the rules of your own country before redistributing.

## Bundled third-party material

A production build contains three things from other parties: the three.js library, two typeface families, and small helper code from the build tool. Versions and licences are in `THIRD_PARTY_NOTICES.md`.

## Tools used and not shipped

| Tool | Use | Licence |
| --- | --- | --- |
| reanimate | Frame-by-frame capture under a virtual clock, driven by `tools/reanimate/capture-series.mjs`. Not included; cloned separately | MIT |
| Playwright | Drives the browser for captures and screenshots | Apache-2.0 |
| Vite, TypeScript, Vitest, happy-dom | Build and test | MIT, Apache-2.0, MIT, MIT |
