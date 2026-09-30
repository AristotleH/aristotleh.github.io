# Personal website

A single static page, `index.html`, served by GitHub Pages at www.aristotleh.com.

The page shows a voxel globe of the places I've studied and worked, with three views: 3D (three.js, loaded from cdnjs), ASCII, and plain HTML. All content, the stop order, and the globe settings live in the `site-data` JSON block near the top of the page's script and are checked against the schema defined next to it.

To preview locally, serve the folder with any static server, for example `python3 -m http.server`, and open http://localhost:8000.
