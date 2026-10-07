# Personal website

A static site served by GitHub Pages at www.aristotleh.com. It shows a globe of the places I've studied and worked, in three views: 3D (three.js, loaded from cdnjs), ASCII, and plain HTML.

## Layout

- `index.html`: the page's markup.
- `scripts/render-static.mjs`: writes the plain document into `index.html` from `data/site.json`, so the profile and experience remain readable without JavaScript or if enhancement fails.
- `css/site.css`: styles, with light and dark color tokens at the top.
- `data/site.json`: all content (profile, stops, projects, page layout) and the globe settings. It's checked against the schema in `js/schema.js` when the page loads. Problems are logged to the console; when previewing on localhost they're also listed on the page, and visitors see them only if the interactive views can't start.
- `data/layers/`: the raster layers the globe is built from (land masks and elevation) as base64 text, referenced from `site.json`.
- `js/`: ES modules.
  - `main.js`: entry point; builds the page and switches views.
  - `schema.js`: the JSON Schema for `site.json`, a small validator, and cross-reference checks.
  - `site.js`: loads and checks the data, and derives what every view shares.
  - `mode.js`: the current view.
  - `page.js`: cards, scroll tracking, and the stop bar.
  - `globe.js`, `gestures.js`: the 3D globe (three.js) and its drag/zoom gestures.
  - `tiles.js`, `hexgrid.js`, `terrain.js`: the globe's tiles, grid and land/elevation lookups, as plain math. `tiles-worker.js` runs them off the main thread and `tiles-client.js` starts it; without module workers they run on the page.
  - `ascii-text.js`, `ascii-fonts.js`, `ascii-globe.js`: the ASCII view.
  - `plain.js`, `plain-content.mjs`: the HTML view. `plain-content.mjs` also holds the formatting helpers every view shares, so it has no browser dependencies and the static generator can use it.

## Preview locally

The page loads its data with `fetch` and its scripts as modules, so it needs to be served over HTTP rather than opened as a file:

```
python3 -m http.server
```

Then open http://localhost:8000.

After changing `data/site.json` or the document renderer, regenerate the checked-in HTML:

```
node scripts/render-static.mjs
```

Run `node scripts/render-static.mjs --check` before publishing to check that the static content is current. Without JavaScript, the HTML document appears immediately. With JavaScript, every visit starts in 3D unless the URL explicitly requests `#html` or `#ascii`. An early script selects the view before the first paint and shows a loading state while it initializes, with a link to read the HTML immediately. Failed initialization reveals the document automatically. Slow loading alone does not switch views.

## Resume link

`profile.resume` in `data/site.json` adds a link to the resume PDF after the profile links, in every view. It's off while `show` is `false`; set it to `true`, then run `node scripts/render-static.mjs` to update the static document.
