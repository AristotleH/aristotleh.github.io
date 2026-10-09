// js/hexgrid.js: the hexagonal grid on a subdivided icosahedron.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hexGrid } from "../../js/hexgrid.js";

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const at = (arr, i) => [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]];

for (const n of [4, 9, 64]) {
  test(`n=${n}: 10n²+2 cells, twelve pentagons, the rest hexagons`, () => {
    const g = hexGrid(n);
    assert.equal(g.count, 10 * n * n + 2);
    const sides = Array.from({ length: g.count }, (_, k) => g.cornerStart[k + 1] - g.cornerStart[k]);
    assert.equal(sides.filter(m => m === 5).length, 12);
    assert.equal(sides.filter(m => m === 6).length, g.count - 12);
  });
}

test("centres and corners are on the unit sphere, and corners go counter-clockwise seen from outside", () => {
  const g = hexGrid(9);
  for (let k = 0; k < g.count; k++) {
    const c = at(g.dir, k);
    assert.ok(Math.abs(Math.hypot(...c) - 1) < 1e-6);
    const c0 = g.cornerStart[k], m = g.cornerStart[k + 1] - c0;
    for (let j = 0; j < m; j++) {
      const a = at(g.corner, c0 + j), b = at(g.corner, c0 + (j + 1) % m);
      assert.ok(Math.abs(Math.hypot(...a) - 1) < 1e-5);
      // (a - c) x (b - c) points outward, along c.
      assert.ok(dot(cross(a.map((v, i) => v - c[i]), b.map((v, i) => v - c[i])), c) > 0, `cell ${k} corner ${j} winds the wrong way`);
    }
  }
});

test("neighbours are mutual and share the edge's two corners exactly, so tiles have no seams", () => {
  const g = hexGrid(9);
  const key = p => p.map(v => v.toFixed(6)).join(",");
  for (let k = 0; k < g.count; k++) {
    const c0 = g.cornerStart[k], m = g.cornerStart[k + 1] - c0;
    for (let j = 0; j < m; j++) {
      const nb = g.cornerNbr[c0 + j];
      assert.notEqual(nb, k);
      const n0 = g.cornerStart[nb], nm = g.cornerStart[nb + 1] - n0;
      const theirs = new Set(Array.from({ length: nm }, (_, q) => key(at(g.corner, n0 + q))));
      assert.ok(theirs.has(key(at(g.corner, c0 + j))) && theirs.has(key(at(g.corner, c0 + (j + 1) % m))), `cells ${k} and ${nb} don't share an edge`);
      assert.ok(Array.from({ length: nm }, (_, q) => g.cornerNbr[n0 + q]).includes(k), `cell ${nb} doesn't list ${k}`);
    }
  }
});

test("spacing is about the angle between neighbouring centres", () => {
  const g = hexGrid(16);
  const expected = Math.atan(2) / 16;   // icosahedron edge angle over n
  for (let k = 0; k < g.count; k += 97) assert.ok(Math.abs(g.spacing[k] / expected - 1) < 0.25);
});
