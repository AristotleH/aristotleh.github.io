# AGENTS.md

Guidance for coding agents working on this repository. `README.md` describes the site for people; this file covers what you need to change it safely. More specific guidance lives in `js/AGENTS.md` (the code) and `data/AGENTS.md` (the content and layers).

## What this is

Aristotle Henderson's personal website, served by GitHub Pages at www.aristotleh.com (`CNAME`). It's one static page, `index.html`, showing a globe of the places he has studied and worked, with a card for each, in three views: 3D (three.js), ASCII, and a plain HTML document. All content comes from `data/site.json`.

There is no build step, no bundler, no package manager and no framework. The page is hand-written HTML, CSS and native ES modules. `.nojekyll` makes GitHub Pages serve the files as they are. Keep it that way: don't add a `package.json`, a bundler or npm dependencies to the site unless the owner asks. The one exception is `tests/`, which has its own `package.json` for the test tools; nothing the site serves may import from it.

The only third-party code is three.js r128, loaded from cdnjs (see "three.js" below).

## Running and checking

- Serve the repository root over HTTP; the page uses `fetch` and module scripts, so `file://` doesn't work: `python3 -m http.server`, then http://localhost:8000.
- After any change to `data/site.json`, `js/plain-content.mjs` or `scripts/render-static.mjs`, run `node scripts/render-static.mjs`. It rewrites the HTML document between `<!-- static-content:start -->` and `<!-- static-content:end -->` in `index.html`. Never edit between those markers by hand.
- CI (`.github/workflows/static-content.yml`) runs `node scripts/render-static.mjs --check` on every push and pull request and fails if that block is stale. Run it yourself before committing.
- `node --check js/<file>.js` catches syntax errors quickly.
- On `localhost`, problems in `site.json` are listed in a box on the page as well as in the console.

## Testing

The tests live in `tests/`, with their own `package.json` (`@playwright/test`, and `three@0.128.0` so the integration tests don't fetch three.js from cdnjs). From `tests/`:

- `npm ci` once, and `npx playwright install chromium` if Playwright's Chromium isn't installed (in Claude Code's cloud containers it already is, at `/opt/pw-browsers`; `@playwright/test` is pinned to the version that matches it).
- `npm run test:unit`: Node's built-in test runner on `tests/unit/*.test.mjs`. These import the modules in `js/` directly with a few browser globals stubbed (`unit/env.mjs`), and cover the data schema and validation, the HTML document and `render-static.mjs`, ordering and pin grouping, the hexagonal grid, terrain lookups, the tile build, the ASCII text and banner, the zoom gestures, and the three.js integrity hash.
- `npm run test:integration`: Playwright on `tests/integration/*.spec.mjs`, driving the real page in headless Chromium, served by `tests/server.mjs` on port 4173. They cover startup and every fallback, navigation with the stop bar, drag, pinch and wheel on both globes, the ASCII globe's characters moving with it, safe areas, the canvas's proportions after another view, a lost WebGL context, and problems in `site.json`.
- `npm run test:perf`: the performance scenarios in `tests/perf/perf.spec.mjs`, one at a time (`playwright.perf.config.mjs`). Each view at phone size (393x852 at DPR 3, CPU slowed 4x with CDP) and desktop size, while idle, dragging, zooming and flying through every stop, plus the time to the first frame. `perf/probe.js` is injected before the page's scripts and records, per frame, the script time in animation-frame callbacks and the WebGL draw calls and vertices (indices) submitted. Results go to `tests/perf-results.json`; `npm run perf:summary` prints them against `perf/budgets.mjs`, where each scenario has a `limit` (the run fails past it) and a `target` (the goal, reported only). Draw calls and vertices per frame don't depend on the machine; frame rates and times do, so their limits leave room for a slower CI runner. `PERF_REPORT_ONLY=1` records without checking; `PERF_BASE_URL=http://127.0.0.1:4174/` measures another copy, such as `main` served from a worktree.
- `.github/workflows/tests.yml` runs all three on every push and pull request. It uploads the Playwright report and traces when the integration tests fail, and puts the performance table in the job summary.

Add a test with each behaviour change or bug fix, and check that it fails without the fix. Things to know when writing integration tests:

- `integration/fixtures.mjs` serves three.js from `node_modules` with the `access-control-allow-origin: *` header the integrity check needs (without it the browser blocks the file and the page falls back to HTML), and fails any test that leaves an uncaught error on the page. Clear `pageErrors` in a test that expects one.
- WebGL runs on SwiftShader (`--use-gl=swiftshader --enable-unsafe-swiftshader`). Software rendering is slow, so 3D frame rates show the direction of a change, not what a phone will do. SwiftShader's costs are mostly per triangle and per multisampled pixel; a real GPU handles triangles far more cheaply, and the per-draw-call cost on a phone is mostly the script that issues it. Before trading draw calls for fewer triangles, think about a real phone, not just the perf numbers. Canvas 2D also runs on SwiftShader here, which made drawing the ASCII globe to a canvas measure slower than the DOM. The WebGL canvas can't be read back from the page, so tests look at screenshots (`globeDrawn`, `colours`).
- Use a phone-sized viewport (`PHONE`: 393×852, `hasTouch`, `isMobile`) as well as desktop. Many of the bugs fixed so far were phone-only: touch gestures, landscape layout, browser toolbars changing the height, the notch.
- Reduced motion goes in `contextOptions: { reducedMotion: "reduce" }`; a top-level `reducedMotion` option is silently ignored. With it the camera moves at once and the idle spin stops, so before/after comparisons are deterministic. The ASCII globe still changes once the elevation data arrives; wait for it to settle (`settledRows`).
- Touch gestures: CDP `Input.dispatchTouchEvent`. Chrome captures touch pointers to the element they started on, so a bug in pointer capture only shows when that element is replaced mid-gesture (the ASCII globe redraws its rows while zooming).
- CDP `Emulation.setSafeAreaInsetsOverride` emulates the notch (iPhone landscape: 47 px left and right, 21 px bottom; portrait: 59 px top, 34 px bottom). `Emulation.setCPUThrottlingRate` (4×) approximates a phone's CPU.
- The tests run on 127.0.0.1, so problems in `site.json` are listed on the page.
- To compare with `main`, check it out in a git worktree and serve it on a second port.

## Conventions

- **Writing**: comments, commit messages, PR descriptions and README text are plain and specific. Say what something does and why, with concrete numbers where you measured them. Avoid hype, filler and decorative formatting. Match the comment density of the surrounding code: most functions have a short comment on what they do and why, and non-obvious decisions are explained where they're made.
- **Site text** is the owner's own words. Change wording in `site.json` only when asked, and exactly as asked.
- **Commits**: one logical change per commit, with a subject line in the imperative ("Keep the 3D globe's proportions after another view") and a body explaining the cause and the fix. Before committing, check that you're not on `main`.
- **Measure before and after** for performance or behaviour changes, against `main`, and report the numbers. Look at screenshots for visual changes, in light and dark themes and at phone and desktop sizes.
- **Accessibility and robustness**: the HTML document must stay readable without JavaScript, controls must stay keyboard-usable, and decorative text (ASCII art, box borders) is hidden from screen readers with `aria-hidden`.

## Layout, styling and the three views

- `<html data-mode="3d|ascii|html">` selects the view; CSS shows and hides elements with `[data-mode=…]` selectors. The markup starts with `data-mode="html"`, so without JavaScript the document shows. `js/main.js` sets the mode only once a view has started.
- The inline script in the head of `index.html` (`window.siteStartup`) picks the starting view from the URL hash before the first paint, shows a loading message while the view starts, and handles fallback to the document. Only it and `js/mode.js` decide the starting mode. Every visit starts in 3D unless the hash says otherwise; a remembered choice was removed on purpose.
- `css/site.css` holds all styles. Colour tokens for both themes are at the top, including the globe's (`--g-*`) and the ASCII view's (`--a-*`). Themes follow `prefers-color-scheme` only.
- Breakpoints used in CSS and JS: under 700 px wide is "narrow" (phones), 700–1099 "mid", 1100 and up "wide".
- **Safe areas**: the viewport uses `viewport-fit=cover`. `body` is padded by the side insets (and in the HTML view by all four), so anything in the page's flow clears the notch. Fixed elements (`.modebar`, `.hud`, `.problems`) add `env(safe-area-inset-*)` themselves with `calc(env(...) + 16px)`. Don't add top padding to the body over the globes: on phones it pushes the name card into the stop bar. The globe canvases are background and should reach the screen edges.
- Mobile heights: the globe canvases use `100lvh`; on phones the intro section uses `svh`. `innerHeight` is not the canvas height on phones while the toolbars show.

## three.js

- Pinned to r128 from cdnjs, with a subresource-integrity hash in `index.html` (`siteStartup.threeIntegrity`). If you change the version, update the URL and the hash together and confirm the hash against the file actually served, or every visitor falls back to the HTML view.
- It is preloaded only when the page starts in 3D, and run on demand by `loadThree()` in `js/globe.js`.

## Branches and pull requests

The site was rebuilt on a `new-site` branch and merged in PR #1; later fixes came in as PRs from `claude/...` branches. Work on a branch, open a PR into `main` when asked, and describe in it what was tested and what wasn't (for example, "not tried on a real phone").
