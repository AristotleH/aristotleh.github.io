# aristotleh.com

My personal website, served by GitHub Pages at [www.aristotleh.com](https://www.aristotleh.com). It's a single static page that shows a globe of the places I've studied and worked, with a card for each place.

There are no build steps and no dependencies to install for the site itself (the tests have their own, in `tests/`). The page is plain HTML, CSS and JavaScript modules. three.js comes from cdnjs.

## The three views

The switch at the top left changes between three views of the same content:

- **3D**: a globe of raised hexagonal tiles drawn with three.js, with a pin for each place. Scrolling the page flies the camera from place to place. On the overview you can drag the globe and zoom with the wheel or a pinch; zooming in over the Bay Area loads finer tiles.
- **ASCII**: the same globe and cards drawn in printable ASCII. The globe is ray-cast into a grid of characters, the name is a FIGlet banner, and the cards are boxes of `+ - |`.
- **HTML**: a plain document with no styling of its own.

Every visit starts in 3D unless the URL ends in `#ascii` or `#html`. A script in the page's head picks the view before the first paint and shows a loading message, with a link to read the HTML document straight away. If the 3D or ASCII view can't start (no WebGL, three.js or the data failing to load, a failed tile build), the page shows the HTML document instead. The HTML document is also written into `index.html`, so it's there without JavaScript.

## Repository layout

| Path | What it is |
| --- | --- |
| `index.html` | The page: markup, the early startup script, and the HTML document generated from the data. |
| `css/site.css` | All styles. Light and dark colour tokens are at the top, including the globe's colours (`--g-*`) and the ASCII view's (`--a-*`). |
| `data/site.json` | All content and the globe's settings (see below). |
| `data/layers/` | The land and elevation rasters the globe is built from, as base64 text. |
| `scripts/render-static.mjs` | Writes the HTML document into `index.html` from `data/site.json`. |
| `.github/workflows/static-content.yml` | CI: checks that the HTML document in `index.html` matches the data. |
| `tests/` | Unit and integration tests, with their own `package.json`. The site itself needs none of it. |
| `.github/workflows/tests.yml` | CI: runs the tests. |
| `assets/` | Favicons, the web manifest and the resume (PDF and its LaTeX source). |
| `CNAME`, `.nojekyll` | The custom domain, and serving the files as they are, without Jekyll. |

The scripts in `js/` are ES modules:

| Module | Role |
| --- | --- |
| `main.js` | Entry point: builds the page, switches views, and falls back to the HTML document. |
| `mode.js` | The current view. |
| `schema.js` | The JSON Schema for `site.json`, a small validator, and cross-reference checks. |
| `site.js` | Loads and checks the data and the layers, and derives what every view shares (stops in order, page sections, pin grouping). |
| `page.js` | The cards, scroll tracking and the stop bar at the bottom. |
| `gestures.js` | Wheel and pinch zoom for both globes. |
| `globe.js` | The 3D globe: camera, pins and labels, close-up detail, adaptive resolution, and recovery from a lost WebGL context. |
| `tiles.js`, `hexgrid.js`, `terrain.js` | The globe's tiles, hexagonal grid, and land and elevation lookups, as plain math with no three.js. |
| `tiles-worker.js`, `tiles-client.js` | Build the tiles in a worker, off the main thread; where module workers aren't supported, the same code runs on the page. |
| `ascii-globe.js`, `ascii-text.js`, `ascii-fonts.js` | The ASCII view: the globe, the boxes and banner, and the FIGlet fonts. |
| `plain.js`, `plain-content.mjs` | The HTML view. `plain-content.mjs` also holds the formatting helpers the other views share, with no browser dependencies, so the static generator can use it too. |

## Running it locally

The page loads its data with `fetch` and its scripts as modules, so it has to be served over HTTP rather than opened as a file. From the repository root:

```
python3 -m http.server
```

Then open http://localhost:8000. Any static file server works.

Problems in `site.json` are always logged to the browser console. On `localhost` they're also listed in a box on the page; visitors only see that box if the interactive views can't start.

## Editing the content

Everything shown on the page comes from `data/site.json`.

- **`profile`**: name, headline, location, the intro paragraph, `links` (each `https://`), and an optional `resume` link (see below).
- **`stops`**: the places. Each has an `id` (lowercase letters, digits and hyphens), a `kind`, a `title`, a `place` (shown after the dates), `lat` and `lon`, and a `view` (how close the camera comes). Work and school stops use an entry card and also need `start` (`YYYY-MM`) and `body`, with optional `end` (`YYYY-MM` or `present`), `role` and `tags`. Photo stops need a `photo` with a `caption`, and a `src` or `"placeholder": true`.
- **`order`**: `newest-first`, `oldest-first` or `as-listed`.
- **`layout`**: the sections after the intro, top to bottom. `projects` is one card listing `projects`; it's left out while the list is empty. `experience` is every stop.
- **`projects`**: pages hosted under `/projects/<id>/`, each with a `title`, `summary` and optional `date`, `tags` and `stop` (which also links it from that stop's card).
- **`overview`**: where the page opens, as a point and a view.
- **`views`**, **`kinds`**, **`markers`**: named camera altitudes, the stop kinds (pin style, card layout, and whether the route line joins them when `globe.routeArcs` is on), and the pin styles with their legend text.
- **`globe`**: how the globe is built and moves: tile shape and size, terrain heights for the whole-globe view and for close-ups, when close-up detail loads, camera settings, and the two global layers.
- **`detailRegions`**: areas with finer land data. Stops inside one get subdivided tiles in close-ups.

`js/schema.js` has the full schema, with a comment on each field. A problem in a stop, project or detail region drops just that item and lists why. A problem anywhere else in the file, or no valid stops left, stops the interactive views, and the page shows the HTML document instead.

After changing `site.json`, regenerate the HTML document in `index.html`:

```
node scripts/render-static.mjs
```

CI runs `node scripts/render-static.mjs --check` on every push and pull request and fails if the document is out of date. You can run the same check before committing.

### Resume link

`profile.resume` adds a link to the resume PDF after the profile links, in every view. It's hidden while `show` is `false`. To turn it on, set `show` to `true` and regenerate the HTML document.

## Globe data

The layers in `data/layers/` cover their area in equal latitude and longitude cells, north row first, and are referenced from `site.json` by `src`:

- **Land** (`rle-varint-base64`): for each row, alternating water and land run lengths as varints. The global mask is 720 × 360, from Natural Earth 1:50m land.
- **Elevation** (`uint8-deflate-base64`): one byte per cell, zlib-compressed, scaled by `metersPerUnit`; 0 is sea level or below. The global layer is 1024 × 512, from NASA Visible Earth topography via the three-globe package.

Global layers need twice as many columns as rows. The Bay Area detail region has its own, finer land and elevation layers. The source of each layer is recorded in its `source` field in `site.json`.

## How the 3D view loads

- The page creates the WebGL context itself, so the cards appear as soon as it's known to work, before three.js has run.
- three.js is preloaded only when the page starts in 3D, and runs while the worker builds the tiles. Its download is checked with subresource integrity.
- The tiles are built in a worker and drawn in blocks; blocks out of sight are skipped, and their buffers are made as they come into view. The arrays are freed once they're on the GPU.
- The globe redraws only when something changes. On devices that can't keep up, it lowers the canvas resolution.
- If the browser takes the WebGL context away (phones can, under memory pressure), the globe pauses, and when the context comes back it rebuilds its tiles in the worker.

## Tests

The tests are in `tests/` and run on every push and pull request (`.github/workflows/tests.yml`). To run them locally you need Node 22:

```
cd tests
npm ci
npx playwright install chromium   # once
npm run test:unit
npm run test:integration
```

The unit tests use Node's built-in test runner on the modules in `js/`: the data schema, the HTML document, ordering and pin grouping, the globe's grid, terrain and tiles, the ASCII text, and the zoom gestures. The integration tests open the page in headless Chromium with Playwright, at phone and desktop sizes, and check startup and the fallbacks to the HTML document, the stop bar, dragging and zooming the globes, safe areas, recovery from a lost WebGL context, and problems in `site.json`. `npm test` runs both.
