# Personal website

A static site served by GitHub Pages at www.aristotleh.com. It shows a globe of the places I've studied and worked, in three views: 3D (three.js, loaded from cdnjs), ASCII, and plain HTML.

## Layout

- `index.html`: the page's markup.
- `css/site.css`: styles, with light and dark color tokens at the top.
- `data/site.json`: all content (profile, stops, projects, page layout) and the globe settings. It's checked against the schema in `js/schema.js` when the page loads; problems are listed on the page.
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
  - `plain.js`: the HTML view.

## Preview locally

The page loads its data with `fetch` and its scripts as modules, so it needs to be served over HTTP rather than opened as a file:

```
python3 -m http.server
```

Then open http://localhost:8000.
