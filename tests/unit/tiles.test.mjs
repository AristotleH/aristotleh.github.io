// js/tiles.js (with js/tiles-client.js): the globe's tiles, blocks and close-up detail, built from the real data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installBrowserEnv } from "./env.mjs";

installBrowserEnv();
const { OCEAN_SURFACE, startTiles, rebuildTiles, terrainInput } = await import("../../js/tiles-client.js");
const { ICOSA_F, ICOSA_V, hexGrid } = await import("../../js/hexgrid.js");
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

test("one tile per hex cell; with the ocean drawn as a surface, each land tile is in exactly one block and ocean tiles in none", () => {
  const n = SITE.globe.grid.hexSubdivisions;
  assert.equal(G.count, 10 * n * n + 2);
  assert.ok(OCEAN_SURFACE);
  assert.ok(G.blocks.length > 60 && G.blocks.length <= 96, `${G.blocks.length} blocks`);   // blocks with no land are left out
  const seen = new Uint8Array(G.count);
  for (const b of G.blocks) for (const g of b.idx) seen[g]++;
  for (let g = 0; g < G.count; g++) assert.equal(seen[g], G.tileKind[g] > 0 ? 1 : 0);
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

test("tile kinds match the land mask, and without an ocean surface, ocean tiles are tops with no walls when there's no gap", async () => {
  assert.equal(SITE.globe.grid.tileGap, 0);
  const share = G.tileKind.reduce((a, k) => a + (k > 0 ? 1 : 0), 0) / G.count;
  assert.ok(share > 0.25 && share < 0.4, `land share ${share}`);   // Earth is about 29% land
  const terrain = await terrainInput();
  const all = buildGlobe({ ...SITE.globe.grid, gap: 0, sizeToDistance: 0.18, ice: SITE.globe.terrain.iceLatitude,
    detailStops: [], anchors: [], terrain, oceanSurface: false });
  let ocean = 0;
  for (const b of all.blocks) b.idx.forEach((g, n) => {
    if (all.tileKind[g] !== 0) return;
    ocean++;
    const verts = b.geo.vStart[n + 1] - b.geo.vStart[n];
    assert.ok(verts === 5 || verts === 6, "ocean tile with walls");
    assert.equal(all.tileElev[g], 0);
  });
  assert.equal(ocean, all.tileKind.filter(k => k === 0).length);
});

// The ocean's fragment shader (globe.js) finds a pixel's tile from its barycentric weights on its icosahedron face:
// the nearest point of the face's triangular lattice. This is the same arithmetic in JavaScript, checked against
// the hex grid: the tile it picks must be the one whose outline (as the land tiles are drawn) holds the point.
test("the ocean shader's way of finding a tile picks the tile the point is in", () => {
  const n = SITE.globe.grid.hexSubdivisions, grid = hexGrid(n);
  const inv3 = m => {   // inverse of a 3x3 matrix given as rows
    const [[a, b, c], [d, e, f], [g, h, i]] = m, A = e * i - f * h, B = f * g - d * i, C = d * h - e * g, det = a * A + b * B + c * C;
    return [[A / det, (c * h - b * i) / det, (b * f - c * e) / det], [B / det, (a * i - c * g) / det, (c * d - a * f) / det], [C / det, (b * g - a * h) / det, (a * e - b * d) / det]];
  };
  const norm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const corner = j => [grid.corner[j * 3], grid.corner[j * 3 + 1], grid.corner[j * 3 + 2]];
  // How far inside tile g's outline point s is: the least, over its edges, of s's height above the edge's great
  // circle (corners run counter-clockwise seen from outside). Negative outside.
  const inside = (g, s) => {
    let least = Infinity;
    for (let j = grid.cornerStart[g]; j < grid.cornerStart[g + 1]; j++) {
      const nxt = j + 1 < grid.cornerStart[g + 1] ? j + 1 : grid.cornerStart[g];
      const e = norm(cross(corner(j), corner(nxt)));
      least = Math.min(least, e[0] * s[0] + e[1] * s[1] + e[2] * s[2]);
    }
    return least;
  };
  let seed = 1, checked = 0;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 2000; k++) {
    const [a, b, c] = ICOSA_F[k % 20], A = ICOSA_V[a], B = ICOSA_V[b], C = ICOSA_V[c];
    // A random point on this face, pushed out onto the sphere.
    let u = rnd(), v = rnd(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const s = norm([0, 1, 2].map(t => A[t] * (1 - u - v) + B[t] * u + C[t] * v));
    // As in the shader: m = inverse(corners) * s, weights w = m * n / sum(m), and the lattice point with the largest
    // barycentric weight in the small triangle holding w.
    const M = inv3([[A[0], B[0], C[0]], [A[1], B[1], C[1]], [A[2], B[2], C[2]]]);
    const m = M.map(r => r[0] * s[0] + r[1] * s[1] + r[2] * s[2]), sum = m[0] + m[1] + m[2];
    const w = m.map(x => x * n / sum);
    const iu = Math.floor(w[1]), iv = Math.floor(w[2]), fu = w[1] - iu, fv = w[2] - iv;
    let q;
    if (fu + fv < 1) { const f0 = 1 - fu - fv; q = f0 >= fu && f0 >= fv ? [iu, iv] : fu >= fv ? [iu + 1, iv] : [iu, iv + 1]; }
    else { const f0 = fu + fv - 1, f1 = 1 - fu, f2 = 1 - fv; q = f0 >= f1 && f0 >= f2 ? [iu + 1, iv + 1] : f1 >= f2 ? [iu, iv + 1] : [iu + 1, iv]; }
    const P = norm([0, 1, 2].map(t => (n - q[0] - q[1]) * A[t] + q[0] * B[t] + q[1] * C[t]));
    // The tile whose centre is P, and the tile whose outline holds s (among the few nearest centres).
    const near = Array.from({ length: grid.count }, (_, i) => i)
      .map(i => [i, grid.dir[i * 3] * s[0] + grid.dir[i * 3 + 1] * s[1] + grid.dir[i * 3 + 2] * s[2]]).sort((x, y) => y[1] - x[1]).slice(0, 8);
    const holder = near.map(([i]) => [i, inside(i, s)]).sort((x, y) => y[1] - x[1]);
    // Within 1e-4 rad of an edge (half a percent of a tile), rounding in the grid's 32-bit corners decides; skip those.
    if (holder[0][1] < 1e-4) continue;
    const g = holder[0][0];
    const along = P[0] * grid.dir[g * 3] + P[1] * grid.dir[g * 3 + 1] + P[2] * grid.dir[g * 3 + 2];
    // The grid's directions are 32-bit floats; neighbouring tiles are 0.019 rad apart.
    assert.ok(Math.acos(Math.min(1, along)) < 1e-3, `point ${k}: the shader's tile is ${Math.acos(Math.min(1, along))} rad from the tile holding it`);
    checked++;
  }
  assert.ok(checked > 1950, `${checked} points checked`);
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
