// js/site.js: loading the real data, page order, section ids and pin grouping.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installBrowserEnv, readJson } from "./env.mjs";

installBrowserEnv();
const S = await import("../../js/site.js");
const raw = await readJson("data/site.json");

test("stops are in the configured order, and the page is the intro then each section", () => {
  assert.equal(S.SITE.order, "newest-first");
  const starts = S.STOPS.map(s => s.start);
  assert.deepEqual(starts, [...starts].sort().reverse());
  assert.equal(S.ALL[0], S.INTRO);
  assert.equal(S.ALL.length, 1 + (S.PROJECTS.length ? 1 : 0) + S.STOPS.length);
  assert.equal(S.PROJECTS_STEP, raw.projects.length ? S.PROJECTS_STEP : null);
});

test("section ids are prefixed for stops, so they can't clash with the page's own ids", () => {
  assert.equal(S.sectionId(S.INTRO), "intro");
  for (const s of S.STOPS) assert.equal(S.sectionId(s), `stop-${s.id}`);
});

test("the eyebrow and month helpers match the shared ones", () => {
  const roblox = S.STOPS.find(s => s.id === "roblox");
  assert.match(S.eyebrowOf(roblox), /^Jul 2023 – present, /);
  assert.equal(S.fmtMonth("2015-08"), "Aug 2015");
});

test("elevation decodes to one byte per cell", async () => {
  const T = await S.TERRAIN;
  const E = S.SITE.globe.layers.elevation;
  assert.equal(T.globe.length, E.columns * E.rows);
});

// Pin grouping: pins merge when their angle apart, at the scale of the middle of the view, is under the limit.
const ids = groups => groups.map(g => g.map(i => S.STOPS[i].id).sort().join("+")).sort();
const none = S.STOPS.map(() => null);

test("zoomed far out, all pins but the current stop group; zoomed far in, none do", () => {
  const { limit, keep } = S.GROUP_PX;
  const far = S.groupStops(1, limit, keep, "roblox", none);
  assert.ok(far.some(g => g.length === S.STOPS.length - 1));
  assert.ok(far.some(g => g.length === 1 && S.STOPS[g[0]].id === "roblox"));
  assert.equal(S.groupStops(1e7, limit, keep, null, none).length, S.STOPS.length);
});

test("the current stop never joins a group, however close", () => {
  for (const s of S.STOPS) {
    const groups = S.groupStops(1, S.GROUP_PX.limit, S.GROUP_PX.keep, s.id, none);
    assert.ok(groups.some(g => g.length === 1 && S.STOPS[g[0]].id === s.id));
  }
});

test("grouped pins stay together until the larger keep distance (no flicker at the edge)", () => {
  const { limit, keep } = S.GROUP_PX;
  assert.ok(keep > limit);
  const a = S.STOPS.findIndex(s => s.id === "roblox"), b = S.STOPS.findIndex(s => s.id === "meta");
  const pa = S.STOPS[a], pb = S.STOPS[b], D = Math.PI / 180;
  const dir = s => [Math.cos(s.lat * D) * Math.cos(s.lon * D), Math.sin(s.lat * D), -Math.cos(s.lat * D) * Math.sin(s.lon * D)];
  const ang = Math.acos(dir(pa).reduce((t, v, i) => t + v * dir(pb)[i], 0));
  const between = (limit + keep) / 2 / ang;   // the pair sits between the two distances at this scale
  const together = g => g.some(x => x.includes(a) && x.includes(b));
  assert.ok(!together(S.groupStops(between, limit, keep, null, none)));
  const was = none.slice(); was[a] = was[b] = "roblox+meta";
  assert.ok(together(S.groupStops(between, limit, keep, null, was)));
});

test("groups depend only on the scale, so turning the globe can't change them", () => {
  // groupStops takes no camera direction at all; the same scale always gives the same groups.
  const once = ids(S.groupStops(400, S.GROUP_PX.limit, S.GROUP_PX.keep, null, none));
  for (let k = 0; k < 3; k++) assert.deepEqual(ids(S.groupStops(400, S.GROUP_PX.limit, S.GROUP_PX.keep, null, none)), once);
});

test("a bad stop in the data is dropped, and the rest still load", async () => {
  // A fresh module graph in a child process: site.js reads the data once, at import.
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const script = `
    import { installBrowserEnv, readJson } from ${JSON.stringify(new URL("./env.mjs", import.meta.url).href)};
    const site = await readJson("data/site.json");
    site.stops[0].kind = "nope";
    installBrowserEnv({ siteJson: site });
    const S = await import(${JSON.stringify(new URL("../../js/site.js", import.meta.url).href)});
    console.log(JSON.stringify({ stops: S.STOPS.length, problems: S.PROBLEMS }));`;
  const { stdout } = await promisify(execFile)("node", ["--input-type=module", "-e", script]);
  const out = JSON.parse(stdout.trim().split("\n").pop());
  assert.equal(out.stops, raw.stops.length - 1);
  assert.match(out.problems.join(), /unknown kind "nope"/);
});
