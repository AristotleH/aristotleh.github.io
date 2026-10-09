# AGENTS.md

Guidance for coding agents working on this repository. `README.md` describes the site for people; this file covers what you need to change it safely. More specific guidance lives in `js/AGENTS.md` (the code) and `data/AGENTS.md` (the content and layers).

## What this is

Aristotle Henderson's personal website, served by GitHub Pages at www.aristotleh.com (`CNAME`). It's one static page, `index.html`, showing a globe of the places he has studied and worked, with a card for each, in three views: 3D (three.js), ASCII, and a plain HTML document. All content comes from `data/site.json`.

There is no build step, no bundler, no package manager and no framework. The page is hand-written HTML, CSS and native ES modules. `.nojekyll` makes GitHub Pages serve the files as they are. Keep it that way: don't add a `package.json`, a bundler or npm dependencies unless the owner asks.

The only third-party code is three.js r128, loaded from cdnjs (see "three.js" below).

## Running and checking

- Serve the repository root over HTTP; the page uses `fetch` and module scripts, so `file://` doesn't work: `python3 -m http.server`, then http://localhost:8000.
- After any change to `data/site.json`, `js/plain-content.mjs` or `scripts/render-static.mjs`, run `node scripts/render-static.mjs`. It rewrites the HTML document between `<!-- static-content:start -->` and `<!-- static-content:end -->` in `index.html`. Never edit between those markers by hand.
- CI (`.github/workflows/static-content.yml`) runs `node scripts/render-static.mjs --check` on every push and pull request and fails if that block is stale. Run it yourself before committing.
- `node --check js/<file>.js` catches syntax errors quickly.
- On `localhost`, problems in `site.json` are listed in a box on the page as well as in the console.

## Testing

There is no test suite in the repository. Changes have been verified by driving the page in headless Chromium with `playwright-core`, outside the repo. If you do the same:

- Point Playwright at a system Chromium and launch with `--use-gl=swiftshader --enable-unsafe-swiftshader` for WebGL. Software rendering is slow, so frame timings show the direction of a change, not what a phone will do; per-draw-call costs are exaggerated and GPU costs aren't representative.
- three.js is loaded with `integrity` and `crossorigin="anonymous"`. If you intercept the cdnjs request and serve a local copy (three r128 is the npm package `three@0.128.0`, `build/three.min.js`), add an `access-control-allow-origin: *` header, or the browser blocks it and the page falls back to HTML.
- Use a phone-sized viewport (393×852, `hasTouch`, `isMobile`) as well as desktop. Many of the bugs fixed so far were phone-only: touch gestures, landscape layout, browser toolbars changing the height, the notch.
- CDP `Emulation.setCPUThrottlingRate` (4×) approximates a phone's CPU. `Emulation.setSafeAreaInsetsOverride` emulates the notch (iPhone landscape: 47 px left and right, 21 px bottom; portrait: 59 px top, 34 px bottom).
- Touch gestures: send them with CDP `Input.dispatchTouchEvent`. With `reducedMotion: "reduce"` the camera moves instantly and the idle spin stops, which makes before/after comparisons deterministic.
- To compare with the current version, check out `main` in a git worktree and serve it on a second port.
- Test the fallbacks when you touch startup: no JavaScript, three.js blocked, `data/site.json` blocked, a module blocked, the tile worker blocked, and `#ascii` / `#html` URLs.

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
