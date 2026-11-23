# Film: a finished video of a book, and a screen for any recording

This part is optional. Everything else in the skill works without it. For a plain GIF of a recorded scene you do not need it either: `node tools/capture/gif.mjs <frames dir> <out.gif>` is enough, see [verify.md](verify.md).

raea (https://github.com/shinyobjectz/raea) is a render engine that turns a React and TypeScript composition into a video on the local GPU. Here it has two jobs. It turns exact frames recorded from the real page into a finished film with titles. And it screens a recording for flashing, frozen pictures and text that is cut or unreadable. The books are always drawn by the browser. raea is not used to draw them: version 0.1.9 leaves out the shader patches that make the page turn, the foil, the page effects and the soft shadow.

## Set up once

1. Take release 0.1.9 for your system from the project's GitHub releases page, with its `.sha256` file. Check the hash. If `gh` is present, run `gh attestation verify <file> -R shinyobjectz/raea`.
2. Extract it outside the repository. Do not run the project's one-line installer: it changes the PATH and writes into the agent's skills folder.
3. Set `RAEA` to the full path of `bin/raea` (`bin\raea.exe` on Windows) and set `RAEA_OFFLINE=1`.
4. `"$RAEA" --version` prints `0.1.9`. Stay on that version. Before moving to a newer one, read its licence and what it sends over the network again.

raea keeps caches in the user's home folder (`~/.raea`, and `%LOCALAPPDATA%\raea` on Windows). To keep them elsewhere, start it with `HOME`, `USERPROFILE` and `LOCALAPPDATA` pointing at a folder of your choice.

Licence: raea is under FSL-1.1-ALv2. Using it to make films is allowed. Do not copy its code or its guides into this repository.

## Make a film

1. Make the change first, in the normal way: a book in `content/`, a parameter, an extension. Check it in the browser as [verify.md](verify.md) says.
2. Record exact frames from the page. `tools/capture/record.mjs` stops the engine's loop and steps its clock by hand, so every frame is exact on any machine.

   ```sh
   npm run dev
   node tools/capture/record.mjs http://127.0.0.1:5183 out/film/frames lens --fps 30
   ```

   The scenes are in the `SCENES` table of that file: `shelf`, `spin`, `row`, `reader`, `drag`, `lens`, `light`, `pointer`, `night`, `nightlens`. For a new animation add a scene there: a start address, a length in frames, and a list of actions with the frame each one happens at (a key, a pointer path, a scroll, a line of code such as `casebound.effects.hologram(true)`).
3. Turn the frames into one video file.

   ```sh
   ffmpeg -framerate 30 -i out/film/frames/f%04d.png -f rawvideo -pix_fmt rgba - | "$RAEA" media encode --size 1440x900 --fps 30 --quality high -o out/film/media/shot.mp4
   ```

4. Write the film next to it, `out/film/edit.tsx`. Footage goes in `media/` beside the file and is named with `staticFile`.

   ```tsx
   import { AbsoluteFill, Composition, Sequence, Video, interpolate, registerRoot, staticFile, useCurrentFrame } from "raea";

   const FPS = 30;

   function Caption({ text, frames }: { text: string; frames: number }) {
     const f = useCurrentFrame();
     const o = interpolate(f, [0, 8, frames - 8, frames], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
     return (
       <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "flex-end", padding: "150px 96px" }}>
         <div style={{ fontFamily: "Georgia, serif", fontSize: 54, color: "#22231f", background: "rgba(232,231,224,0.92)", padding: "10px 22px", opacity: o }}>{text}</div>
       </AbsoluteFill>
     );
   }

   function Edit() {
     return (
       <AbsoluteFill style={{ background: "#e8e7e0" }}>
         <Video src={staticFile("shot.mp4")} style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover" }} />
         <Sequence from={12} durationInFrames={78} name="caption"><Caption text="Hold a lens over the print" frames={78} /></Sequence>
       </AbsoluteFill>
     );
   }

   registerRoot(() => <Composition id="edit" component={Edit} width={1440} height={900} fps={FPS} durationInFrames={210} />);
   ```

   Keep the word `import` out of comments in this file. In 0.1.9 a comment that contains it breaks the build with `raea is not defined`.
5. Render it and keep the manifest.

   ```sh
   cd out/film
   "$RAEA" render edit.tsx -o film.mp4 --manifest render.json
   ```

   One frame for a quick look: `"$RAEA" render edit.tsx -o look.png --frame 60`.
6. Check it. The film is done only when this ends with `0 errors`.

   ```sh
   "$RAEA" check film.mp4 --manifest render.json -o check.json
   ```

   It tests: nothing frozen for 3 s, no more than 3 flashes a second, no stray black or white frame, no text cut by the frame, no text in the edge zones, every text on screen long enough to read, text contrast 3:1 or better.
7. Look at it. `"$RAEA" media sheet film.mp4 --n 12 --width 360 -o sheet.png` writes twelve frames as one picture, with their times in `sheet.labels.json`. Read the picture.
8. To remake it after a change, repeat from step 2. The same build gives the same frames, so a difference in the film is a difference in the build.

A 7 s film at 1440 by 900 took under 3 minutes for all steps on a laptop with integrated graphics.

## Screen a look that changes brightness

Any surface effect that pulses, strobes or flickers (the hologram, the radio, a new one that uses `uFxTime`) must pass the flashing test before it ships. Record it (step 2, or the reanimate series of [verify.md](verify.md)) and run:

```sh
"$RAEA" check out/film/media/shot.mp4
```

A plain recording gets three tests: frozen, flashing, flash-frame. `ok flashing: no more than 3 flashes a second found` is the line to look for. The tool calls this a screen, not a certification. Reduced motion must still end the effect in its rest state, as before.

## Compare two recordings (optional)

When a motion was changed and you want to know what else moved, compare a recording from before with one from after. This uses video-decompiler, a set of Python tools that ships in raea's skills repository (MIT). It needs Python 3.10 or later, a virtual environment with its `requirements.txt`, and `ffmpeg` and `ffprobe` on the PATH of that process.

```sh
python <skills>/video-decompiler/tools/vd.py doctor
python <skills>/video-decompiler/tools/vd.py measure after.mp4 --against before.mp4 --no-voice
```

It prints a table of up to forty measures with both values and writes, for each file, a motion transcript `SEE.md`: what moves, how far, from when to when, and from when the picture stands still. Treat every row as a question for the frames. Confirm a finding with the frame-by-frame capture before changing a value. Its `vd borrow` command (spring and curve fit) fitted one clip in ten here; do not rely on it.

## What not to do

- Do not judge light, shadow, paper or cover with a raea render of the engine. Judge them in the browser.
- Do not run `raea skills install`, `raea bug`, `raea gen`, `raea ask` or `raea judge` from this skill. The first changes the agent's configuration, the others send data out or need keys.
- Do not commit recordings, films or `node_modules` made on the way. `out/` is ignored already.
- Do not put recordings of other people's sites into the repository.
