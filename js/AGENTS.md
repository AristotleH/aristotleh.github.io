# AGENTS.md: js/

How the scripts fit together, and the invariants they rely on. Most of the "don't break this" notes below come from real bugs; the reason is given so you can tell when a change would bring one back. See the root `AGENTS.md` for running and testing.

## Modules and dependencies

Native ES modules, loaded by `index.html` (with `modulepreload` links; add one if you add a module). No bundler.

- `main.js`: entry point. Builds the page (`initPage`), shows the starting view (`setMode`), and switches views from the buttons at the top left. A view is committed to `<html data-mode>` only after it has started; failures fall back to the HTML document (`window.siteStartup.fallback()` in `index.html`).
- `mode.js`: the current view (`MODE`), from `window.siteStartup.mode`.
- `site.js`: top-level `await` loads `data/site.json` and its layer files, validates them (`schema.js`), and exports what every view shares: `SITE`, `STOPS` (in display order), `ALL` (the intro, then each page section), `INTRO`, `PROJECTS`, `REGIONS`, `TERRAIN` (decoded elevation, a promise), `sectionId`, and pin grouping (`groupStops`, `GROUP_PX`). A fatal data problem throws here, after `showProblems` has switched the page to the HTML document.
- `schema.js`: the JSON Schema for `site.json`, a small validator for the keywords it uses, and `checkSite`, which adds cross-reference checks and decodes the land mask. Problems in one stop, project or detail region drop just that item; anything else is fatal.
- `plain-content.mjs`: pure helpers (escaping, month formatting, ordering, the eyebrow line, profile links) and the HTML document. It must not touch `window` or `document`: `scripts/render-static.mjs` imports it in Node.
- `plain.js`: the HTML view (re-renders `#plain` from validated data).
- `page.js`: the sections and cards, scroll tracking (`active`, the section nearest the middle of the screen), the stop bar (`.hud`), `goTo` / `toTop`, and `heading` / `viewStop()`.
- `gestures.js`: wheel and pinch zoom for both globes (`zoomGestures`).
- `globe.js`: the 3D globe.
- `tiles.js`, `hexgrid.js`, `terrain.js`: tile geometry, the hexagonal grid and land/elevation lookups. Plain math, no three.js, no DOM: they run in a worker.
- `tiles-worker.js`, `tiles-client.js`: run the tile build in a module worker; `startTiles()` returns `{ globe, detail }` promises. Without module workers the same code runs on the page.
- `ascii-globe.js`, `ascii-text.js`, `ascii-fonts.js`: the ASCII view.

## Startup order (3D)

The order is tuned for time to the first card and the first globe frame; keep it:

1. `main.js` calls `startTiles()` immediately when starting in 3D.
2. `globe()` creates the WebGL context on the canvas itself and calls `onReady`, so the cards show as soon as WebGL is known to work, before three.js has run.
3. `terrainInput()` is one shared promise. `startTiles()` registered on it first, so the worker gets its build input before the page builds its own terrain lookups for the pins.
4. `loadThree()` runs three.js (preloaded by `index.html`) while the worker builds; then the renderer is made with the existing context.
5. Shaders are compiled with throwaway meshes while waiting for the tiles.

A failure before `onReady` makes the view fall back; a failure after it (the build throws) switches to the HTML document (`startGlobe` in `main.js`).

## globe.js invariants

- **Render on demand.** A frame returns early if the camera key is unchanged and nothing is animating; it draws only if the draw signature changed. If you add something that changes on screen, set `animating = true` while it moves, or `needsRender = true` once.
- **Update the camera matrices before projecting.** three.js refreshes `matrixWorld` only inside `render()`. The frame calls `camera.updateMatrixWorld()` right after moving the camera, because pins, labels and the redraw check all project with it. Without that, labels trailed their pins by a frame (up to 245 px while fading).
- **Tile arrays are freed after upload** (`onUpload(free)` in `geometryFrom`, about 21 MB otherwise). Nothing may read a tile geometry's arrays after its first draw, except the colour and info arrays, which are recreated where needed (`paintTile`) or kept (`keepInfo` for blocks that detail replaces).
- **Lost WebGL context.** Phones can take the context away. Because the arrays are freed, three.js can't restore tiles by itself: on `webglcontextrestored` the globe drops the old meshes (without `dispose()`: their buffers died with the context), calls `rebuildTiles()` for fresh arrays (given only to blocks still without a mesh), realizes blocks again as they come into view, rebuilds the detail mesh, and re-applies the theme (the clear colour resets). The detail state (`DT`) is cleared on loss and set back only once its mesh is rebuilt, so close-ups use the coarse tiles meanwhile; a detail state without a mesh hides the tiles it replaces and leaves a hole. If the tiles fail to rebuild, `onFail` shows the HTML document and `resume()` returns false from then on. `contextEpoch` abandons a rebuild overtaken by another loss. Test with the `WEBGL_lose_context` extension.
- **Blocks.** Tiles are drawn in up to 96 blocks (`K = 4` per cube face in `tiles.js`), skipped beyond the horizon and realized lazily (`realize`), with the rest built in idle time. Fewer, bigger blocks halved the draw calls; don't split them finer without measuring.
- **Ocean surface.** With hexagons and no gap (`OCEAN_SURFACE` in `tiles-client.js`), ocean tiles get no geometry; the ocean is one sphere (each icosahedron face split 16 times) whose fragment shader finds each pixel's hexagon from its barycentric weights on the face, using the same faces as `hexgrid.js` (`ICOSA_V`, `ICOSA_F`; `unit/tiles.test.mjs` checks the arithmetic against the grid). Ocean tiles were most of the globe's triangles, each a few pixels across: this cut the indices drawn per frame on the overview by 41% (459k to 270k on a desktop) and raised the frame rate under SwiftShader from 6.1 to 8.9 fps. Tiles that close-up detail replaces are cut away by `discard` with the land tiles' timing, in a second material used only while detail shows (a shader that can discard stops the GPU rejecting hidden pixels early). The sphere's flat triangles dip up to 4 km under the true surface, so land walls reach down to radius 0.999, below it. Don't give the ocean a polygon offset: at grazing angles it pushed the ocean behind the core.
- **Core.** The black core sphere hides tiles that have dropped away. Over an ocean surface it's drawn only while detail shows.
- **Antialiasing.** Multisampling is on only below two device pixels per CSS pixel. Above that the canvas is drawn at 2x, where the edges are already fine. Under SwiftShader, multisampling about halved the frame rate; with it off (and the ocean surface), a DPR 3 phone's overview went from 5.2 to 16.2 fps.
- **Sizing.** `resize()` does nothing while the canvas is hidden (another view is up): its size would come from the window, which on phones isn't the canvas's. `resume()` sets `resizeOnWake`, and the first frame back in 3D resizes. `main.js` calls `resume()` before it shows the canvas, so resizing inside `resume()` itself doesn't work.
- **Adaptive resolution** (`pace`): over runs of 20 back-to-back frames, if the typical gap is well over the refresh interval, the pixel ratio drops (down to 1); a drop that doesn't speed things up is undone and adaptation stops (as under iOS Low Power Mode's 30 fps cap). The new ratio is applied just before a draw, never right after one, so a blank canvas never reaches the screen.
- **Camera flights.** `viewStop()` is the stop the camera aims at: `heading` (set by the stop bar arrows and pin taps) or else the active section. Leaving the overview drops its drag and zoom offsets at once, because they're relative to the overview's centre; easing them out made flights detour.
- **Zoom floor.** Away from detail regions the overview can't zoom below the altitude where relief switches to close-up heights. `zoomFloor()` is passed to `zoomGestures`, which stops there; the frame only eases back up when the floor rises (panning away from detail while zoomed in). Clamping in only one place made the view bounce.
- **Labels** are DOM elements in `#labels`, positioned with `transform` from the projected head position. Only the current stop's label (and nearby stops' in detail close-ups) shows.

## Gestures (gestures.js, and drag in both globes)

- Each touch pointer is captured to the globe element (`setPointerCapture`), and `lostpointercapture` counts as a lift. The ASCII globe replaces the text under the fingers every frame; without capture, a finger lifted over the name card was never counted, the pinch never ended, and one-finger drags zoomed instead of panning.
- A pinch that hits a zoom limit re-anchors, so pinching back responds at once.
- On the overview, drags on the globe pan it; only the name card (and the area below it, `#scroll-zone`) scrolls the page. Elsewhere the page scrolls normally.

## Pin grouping

`groupStops` in `site.js` is used by both globes. Pins within `GROUP_PX.limit` px of each other merge, and stay merged until `GROUP_PX.keep`. Distance is the angle between pins times the screen size of one radian at the middle of the view, so turning the globe never changes the groups; only zooming does. The current stop never merges.

## ASCII view

- `ascii-globe.js` ray-casts one ray per character cell. Characters are pinned to the globe, not the screen: each comes from a patch of a surface grid about one character in size, stepped by powers of two so it holds still within a zoom level. Land uses smooth 3D noise on the sphere (features about five patches across), height, and relief lit from a fixed northwest direction; ocean is dots and a few `~`. Camera lighting only dims the far side (classes 13–16, CSS `.a-sh`), never picks characters. Changing this back to screen-keyed noise or camera-lit glyphs makes characters sit still while the colours slide under them.
- A land patch's glyph depends only on the patch, so it's worked out once (`landGlyph`) and kept in `landGlyphs` until the grid step, the theme or the terrain changes. Per-cell work is the ray, the land test and a map lookup. The theme is read once and on change, not per frame: reading a style after the rows were replaced made the browser recompute styles mid-frame.
- Faded glyphs use colours mixed with the page background (`color-mix`), not `opacity`: a translucent span is painted as its own layer.
- Cell classes: 0 none, 1 ocean, 2 land, 3 high, 4 ice, 5 atmosphere, 6 star, 7 route, 8 marker, 9 label, 10 active label, 11 outline, 13–16 shaded 1–4. `put()` won't overwrite 7–11; keep that range exact.
- Rows are separate spans and only rows whose markup changed are replaced; the idle spin redraws at 30 fps.
- `ascii-text.js` draws the cards as boxes and the name as a FIGlet banner. `banner()` picks the first font ("standard", then "small", then "mini") that fits at `MIN_BANNER_SCALE` (78%) or larger; a scaled banner is drawn smaller between full-size borders so the box's columns stay aligned. Box width comes from the content column, less the body's and column's padding.

## page.js

- Stop sections have ids `stop-<id>` (`sectionId`), so a stop id can't clash with the page's own ids; the intro and projects sections keep `intro` and `projects`.
- The arrows do nothing past either end and are disabled there; clamping re-centred the end card and moved the page.
- Switching to the HTML view scrolls to the current stop's article (`showInPlain`), since the pages differ in length.
