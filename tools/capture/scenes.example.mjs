// Scenes of your own for record.mjs:
//   node tools/capture/record.mjs http://127.0.0.1:5183 out/rec/browse browse --scene-file tools/capture/scenes.example.mjs
//
// A scene is a page to open, a number of frames, and actions at frame numbers. `sec(1.5)` is the frame at
// 1.5 seconds, `glide(from, 0, frames, points)` moves the pointer through points, `scroll(from, frames, a, b)`
// scrolls from shelf slot a to slot b, `key(at, 'Space')` presses a key, `js(at, code)` runs code in the page.
// An action can also be written out: { at: frame, run: (page) => ... } with a Playwright page.
export default ({ sec, glide, scroll, key, READER }) => ({
  // Look at two books on the shelf, open the second and turn a page.
  browse: {
    path: '/?midday',
    frames: sec(9),
    actions: [
      ...glide(sec(0.2), 0, sec(1.2), [[500, 520], [880, 400]]),
      ...scroll(sec(1.6), sec(1.3), 0, 1),
      key(sec(3.4), 'Space'),
      key(sec(6.4), 'ArrowRight'),
      ...glide(sec(7), 0, sec(1.4), [[880, 400], [620, 560]]),
    ],
  },
  // Start inside a book: the deep link opens the reader at once, `settle` waits for it to lie still.
  lamp: {
    path: '/?theme=dark' + READER,
    frames: sec(4),
    settle: 3400,
    actions: glide(sec(0.2), 0, sec(3.4), [[320, 340], [620, 520], [420, 600]]),
  },
});
