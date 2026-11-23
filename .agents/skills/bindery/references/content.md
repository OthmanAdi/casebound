# Content: books as data

Everything a visitor sees about a book comes from two files in its folder.

```
content/
  library.json                 which books, in which order, which extensions
  books/<slug>/book.json       the record
  books/<slug>/text.json       optional: { "paragraphs": [ ... ] }
```

The folder name must equal the record's `slug`. The loader (`src/site/library.ts`) stops with a clear error if it does not, or if `library.json` names a book that has no folder.

## library.json

| Field | Meaning |
| --- | --- |
| `name` | Site name, shown as the wordmark |
| `tagline` | One line about the library |
| `featured` | Slugs shown one per panel, top to bottom |
| `shelf` | Further slugs that are loaded but not featured |
| `extensions` | Names of files in `extensions/` to load at start |

## book.json

| Field | Type | Meaning |
| --- | --- | --- |
| `slug` | string | Lower-case, hyphenated. Used in the address `#/book/<slug>` |
| `title`, `author` | string | Printed on cover, spine and running heads |
| `subtitle` | string, optional | Set under the title in italic |
| `year` | number, optional | Shown beside the title in the marquee |
| `pages` | number, optional | Page count. Sets the number of leaves and, unless `thickness` is given, how thick the book is. Default 240 |
| `thickness` | number, optional | Closed thickness in world units. Sensible range 1.6 to 3.0 |
| `background` | colour, optional | Colour of the panel picture. Also tints the light in the Noon theme |
| `blurb` | string, optional | A few sentences for the detail column |
| `source` | object, optional | Where the text comes from: `name`, `id`, `url`, `note` |
| `cover` | object | See below |
| `material` | object, optional | Overrides for the surface model, see below |
| `text` | string array, optional | Body text, one string per paragraph. Usually kept in `text.json` instead |
| `headings` | object, optional | Chapter headings by the paragraph index they stand before, for example `{ "0": "Chapter one" }` |

### cover

| Field | Values | Meaning |
| --- | --- | --- |
| `cloth` | colour | Colour of the case |
| `ink` | colour | Colour of printed type and ornament |
| `accent` | colour, optional | Second colour for the pattern |
| `pattern` | `plain`, `marble`, `rules`, `grid`, `rays`, `strata`, `dots` | Ornament on the front board |
| `foil` | colour or `none` | Foil for the title. Leave out or `none` for printed ink |
| `foilRainbow` | 0 to 1 | 0 is plain metal, 1 is fully iridescent |
| `grain` | `buckram`, `paper`, `cardboard` | Binding material. Sets the weave and how the surface takes light |
| `seed` | number, optional | Seed of the generated pattern. Default: a hash of the title |

### material

| Field | Typical range | Meaning |
| --- | --- | --- |
| `shininess` | 3 to 21, default 9.9 | Tightness of the highlight |
| `reflectiveness` | 0.17 to 1, default 0.5 | Strength of the highlight |
| `bumpGrain` | 0.01 to 0.1, default 0.055 | Depth of the weave |
| `bumpEmboss` | 0.05 to 0.25, default 0.119 | Depth of the stamped title |
| `foilSpecular`, `foilDetail` | 0 to 2.2, 0.4 to 6.3 | How bright the foil is and how fast its colour shifts |
| `cloth` | object | `gloss`, `sheen`, `sheenRough`, `weave`, `fibre`, `wrap`. Defaults come from `grain` |

## Text

`text.json` holds plain paragraphs. The reader packs them onto pages by length (`src/engine/reader/pages.ts`), so the same text always gives the same pages. A short text repeats, so every page of a thick book has print on it.

To fetch a public-domain text from Project Gutenberg: set `source.name` to `Project Gutenberg` and `source.id` to the ebook number, then run

```sh
node tools/content/gutenberg.mjs <slug>
```

The tool reads from the mirror meant for scripts, checks that the file's header names the book, removes the Project Gutenberg header and licence, and keeps up to 140 prose paragraphs.

## A new cover pattern

Patterns are drawn in `drawPattern` in `src/engine/book/painter.ts`. Add a name to the `CoverPattern` type and a `case` that draws into the given rectangle with the given colours and seeded random function. The same drawing is used for the colour map; text is drawn on top by the painter and also into the emboss and foil maps.
