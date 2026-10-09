// js/tiles.js (with js/tiles-client.js): the globe's tiles, blocks and close-up detail, built from the real data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installBrowserEnv } from "./env.mjs";

installBrowserEnv();
const { startTiles, rebuildTiles, terrainInput } = await import("../../js/tiles-client.js");
const { SITE, STOPS, REGIONS } = await import("../../js/site.js");
const { buildGlobe } = await import("../../js/tiles.js");

// Node has no Worker, so this runs tiles-client's on-page fallback: the same build the worker would do.
const G = await startTiles().globe;
const DT = await startTiles().detail;

function checkGeometry(geo) {
  assert.equal(geo.pos.length, geo.nv * 3);
  assert.equal(geo.info.length, geo.nv * 4);
  for (const i of geo.index) assert.ok(i < geo.nv);
  for (let k = 1; k < geo.vStart.length; k++) assert.ok(geo.vStart[k] >= geo.vStart[k - 1]);
  for (let v = 0; v < geo.nv; v += 7) assert.ok(Math.abs(Math.hypot(geo.pos[v * 3], geo.pos[v * 3 + 1], geo.pos[v * 3 + 2]) - 1) < 1e-5);
}

test("one tile per hex cell, each in exactly one of 96 blocks", () => {
  const n = SITE.globe.grid.hexSubdivisions;
  assert.equal(G.count, 10 * n * n + 2);
  assert.equal(G.blocks.length, 96);
  const seen = new Uint8Array(G.count);
  for (const b of G.blocks) for (const g of b.idx) seen[g]++;
  assert.ok(seen.every(c => c === 1));
});

test("block geometry is well formed, and each block's bounds hold its tiles", () => {
  for (const b of G.blocks) {
    checkGeometry(b.geo);
    for (const g of b.idx) {
      const d = [G.tileDir[g * 3], G.tileDir[g * 3 + 1], G.tileDir[g * 3 + 2]];
      const ang = Math.acos(Math.min(1, d[0] * b.center[0] + d[1] * b.center[1] + d[2] * b.center[2]));
      assert.ok(ang <= b.radius + 1e-6);
    }
  }
});

test("tile kinds match the land mask, and ocean tiles have no walls when there's no gap", () => {
  assert.equal(SITE.globe.grid.tileGap, 0);
  let land = 0;
  for (const b of G.blocks) b.idx.forEach((g, n) => {
    const verts = b.geo.vStart[n + 1] - b.geo.vStart[n];
    if (G.tileKind[g] === 0) { assert.ok(verts === 5 || verts === 6, "ocean tile with walls"); assert.equal(G.tileElev[g], 0); }
    else land++;
  });
  const share = land / G.count;
  assert.ok(share > 0.25 && share < 0.4, `land share ${share}`);   // Earth is about 29% land
});

test("only tiles near a detail stop are marked for replacement, and every detail piece belongs to one", () => {
  const inDetail = STOPS.filter(s => REGIONS.some(g => s.lat > g.lat0 && s.lat < g.lat1 && s.lon > g.lon0 && s.lon < g.lon1));
  assert.ok(inDetail.length > 0);
  const marked = G.tileBay.reduce((a, b) => a + b, 0);
  assert.ok(marked > 0 && marked < 200, `${marked} tiles marked`);
  assert.ok(DT.count > marked);
  for (const p of DT.parent) assert.equal(G.tileBay[p], 1);
  checkGeometry(DT.geo);
});

test("the square grid builds too, and a gap gives ocean tiles walls", async () => {
  const terrain = await terrainInput();
  const input = { ...SITE.globe.grid, shape: "square", tilesPerFaceEdge: 16, gap: 0.1, sizeToDistance: 0.18,
    ice: SITE.globe.terrain.iceLatitude, detailStops: [], anchors: [], terrain };
  const sq = buildGlobe(input);
  assert.equal(sq.count, 6 * 16 * 16);
  const seen = new Uint8Array(sq.count);
  for (const b of sq.blocks) { checkGeometry(b.geo); for (const g of b.idx) seen[g]++; }
  assert.ok(seen.every(c => c === 1));
  const ocean = sq.blocks.flatMap(b => [...b.idx].map((g, n) => [g, b.geo.vStart[n + 1] - b.geo.vStart[n]])).find(([g]) => sq.tileKind[g] === 0);
  assert.ok(ocean[1] > 4, "with a gap, ocean tiles get walls");
});

test("rebuildTiles starts a fresh build with fresh arrays (for a lost WebGL context)", async () => {
  const again = await rebuildTiles().globe;
  assert.equal(again.blocks.length, G.blocks.length);
  assert.notEqual(again.blocks[0].geo.pos, G.blocks[0].geo.pos);
  assert.deepEqual([...again.blocks[0].geo.pos.slice(0, 30)], [...G.blocks[0].geo.pos.slice(0, 30)]);
});
