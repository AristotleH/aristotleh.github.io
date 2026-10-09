// js/terrain.js: land and elevation lookups, on small made-up rasters and on the real layers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTerrain } from "../../js/terrain.js";
import { installBrowserEnv } from "./env.mjs";

// A 4 x 2 globe (90° cells): land in the north-west cell only. Elevation rises west to east.
function tiny() {
  const mask = new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0]);
  return makeTerrain({
    mask, MW: 4, MH: 2,
    globeElev: { w: 4, h: 2, lat1: 90, lon0: -180, step: 90, wrap: true, km: 1, data: new Uint8Array([0, 1, 2, 3, 0, 1, 2, 3]) },
    regions: [],
  });
}

test("isLand reads the cell a point falls in, wrapping longitude", () => {
  const t = tiny();
  assert.equal(t.isLand(45, -135), 1);
  assert.equal(t.isLand(45, 45), 0);
  assert.equal(t.isLand(-45, -135), 0);
  assert.equal(t.isLand(45, 225), 1);   // same as -135
  assert.equal(t.isLand(95, -135), 1);  // clamped to the top row
});

test("elevPoint interpolates between cell centres, wrapping around the date line", () => {
  const t = tiny();
  assert.equal(t.elevPoint(45, -135), 0);    // a cell centre
  assert.equal(t.elevPoint(45, -90), 0.5);   // halfway to the next centre
  assert.equal(t.elevPoint(45, 180), 1.5);   // between the last cell (3) and the first (0)
  assert.equal(t.maxElev, 3);
});

test("landFrac averages the mask over a box", () => {
  const t = tiny();
  assert.equal(t.landFrac(45, -135, 10), 1);
  assert.equal(t.landFrac(45, 45, 10), 0);
});

test("the real layers: the Bay Area and Himalayas are land, mid-ocean isn't, and detail covers the Bay Area", async () => {
  installBrowserEnv();
  const { terrainInput } = await import("../../js/tiles-client.js");
  const t = makeTerrain(await terrainInput());
  assert.equal(t.isLand(37.55, -122.0), 1);       // Hayward, inside the detail region
  assert.equal(t.isLand(28.0, 86.9), 1);          // Everest
  assert.equal(t.isLand(0, -140), 0);             // central Pacific
  assert.ok(t.elevPoint(28.0, 86.9) > 4);         // km
  assert.equal(t.elevPoint(0, -140), 0);
  assert.ok(t.maxElev > 5 && t.maxElev < 9);
  assert.equal(t.regionAt(37.6, -122.3)?.lat0, 35.3);
  assert.equal(t.regionAt(48.8, 2.3), undefined);
  // San Francisco Bay is water in the fine detail mask, though the coarse globe mask can't tell.
  assert.ok(t.landFrac(37.75, -122.3, 0.05) < 0.5);
});
