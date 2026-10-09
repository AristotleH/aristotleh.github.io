# AGENTS.md: data/

`site.json` holds all of the site's content and the globe's settings; `layers/` holds the rasters the globe is built from. See the root `AGENTS.md` for running and checking, and `js/schema.js` for the full schema, with a comment on each field.

## Editing site.json

- The text is the owner's own words. Change it only when asked, and exactly as asked; don't rephrase other entries while you're there.
- After any change, run `node scripts/render-static.mjs` from the repository root. It rewrites the HTML document in `index.html`; CI fails if that's out of date.
- Then load the page on `localhost` and check that no problems box appears (and the console has no "Site data problems").
- A problem in a stop, project or detail region drops just that item; a problem anywhere else, or no valid stops left, stops the 3D and ASCII views and the page shows the HTML document. Keep edits valid against the schema.

### Fields that are easy to get wrong

- `id`s are lowercase letters, digits and hyphens, and unique. A stop's section on the page is `stop-<id>`.
- Dates are `YYYY-MM`; `end` can also be `present`. `order: "newest-first"` sorts stops by `start` (photos by `photo.taken`).
- `kind` must name an entry in `kinds`, and `view` an entry in `views`. Entry cards (work, school) need `start` and `body`; `role` and `tags` are optional, and a `role` of `null` skips the role line. Photo cards need `photo.caption` and either `photo.src` or `"placeholder": true`.
- `place` is shown after the dates on the eyebrow line ("Jul 2023 – present, San Mateo, California").
- `links` must be `https://`. `profile.resume.path` is a site path (`/assets/docs/resume/…`), listed only while `show` is `true`.
- `projects` paths are `/projects/<id>/`; the projects section is left out while the list is empty.
- `layout` lists the sections after the intro: `projects` and `experience`, at most once each. `experience` is required; if it's missing, it's added at the end and a problem is listed.
- `globe.camera.overviewZoom.in` and `.out` are factors of the overview's starting altitude. `globe.detail.loadBelowAltitudeKm` also sets the zoom floor away from detail regions.
- Colours are not in `site.json`: they're CSS tokens (`--g-*`, `--a-*`) in `css/site.css`, since they differ by theme.

## Layers

Each layer covers its bounds (the whole Earth for `globe.layers`) in equal latitude and longitude cells, north row first, stored as base64 text in a `.txt` file (binary `.bin` files were rejected by the host used for previews). `src` is the path from `data/`.

- **Land** (`rle-varint-base64`): for each row, alternating water and land run lengths, as unsigned LEB128 varints. Each row starts with a water run, which can be 0.
- **Elevation** (`uint8-deflate-base64`): one byte per cell, zlib-compressed (the browser inflates it with `DecompressionStream("deflate")`), times `metersPerUnit`; 0 is sea level or below.
- Global layers need twice as many columns as rows.
- Current layers: global land 720 × 360 (Natural Earth 1:50m), global elevation 1024 × 512 (NASA Visible Earth topography via the three-globe package), and finer land (320 × 320) and elevation (40 × 40) for the Bay Area detail region. Each layer's `source` field records where it came from.
- `globe-elevation.txt` is the largest download after three.js (about 117 KB gzipped). Halving its resolution was tried and rejected: it moved some mountain tiles by up to 580 m. A delta-filtered encoding saved only about 20 KB.
- The scripts that produced the layers aren't in the repository. If you regenerate one, keep the encoding and dimensions consistent with its entry in `site.json`, and record the source.
