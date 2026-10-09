// Hex tiles: an icosahedron with each edge split n times, pushed out onto the sphere (10n^2 + 2 points). Points are
// keyed by their exact integer weights on the icosahedron's corners, so a point on an edge shared by two faces is
// made once. Each point's tile is its cell of the sphere: the centres of the small triangles around it, in order
// (six, or five at the icosahedron's corners). Neighbouring cells share their corners exactly. cornerNbr gives, for
// each corner, the tile across the edge from that corner to the next.
// The icosahedron: corners V, and faces F counter-clockwise seen from outside. The 3D globe's ocean shader works out
// hexagons from the same faces (globe.js), so they must stay the same here.
const t = (1 + Math.sqrt(5)) / 2;
export const ICOSA_V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
  [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
export const ICOSA_F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];

export function hexGrid(n) {
  const V = ICOSA_V, F = ICOSA_F;   // every small triangle below keeps the faces' winding
  const count = 10 * n * n + 2, T = 20 * n * n;
  const pts = new Float64Array(count * 3), tris = new Int32Array(T * 3);
  let np = 0, nt = 0;
  const make = (a, wa, b, wb, c, wc) => {
    const x = V[a][0] * wa + V[b][0] * wb + V[c][0] * wc, y = V[a][1] * wa + V[b][1] * wb + V[c][1] * wc;
    const z = V[a][2] * wa + V[b][2] * wb + V[c][2] * wc, l = Math.sqrt(x * x + y * y + z * z);
    pts[np * 3] = x / l; pts[np * 3 + 1] = y / l; pts[np * 3 + 2] = z / l;
    return np++;
  };
  // Weights wa + wb + wc = n on corners a, b, c. A point inside a face belongs to that face alone; one on an edge
  // or corner is shared, so it's looked up by its non-zero (corner, weight) pairs in corner order, packed into a key.
  const ids = new Map(), B = 12 * (n + 1);
  const point = (a, wa, b, wb, c, wc) => {
    if (wa && wb && wc) return make(a, wa, b, wb, c, wc);
    let p = [];
    if (wa) p.push(a * (n + 1) + wa + 1);
    if (wb) p.push(b * (n + 1) + wb + 1);
    if (wc) p.push(c * (n + 1) + wc + 1);
    p.sort((x, y) => x - y);   // packed codes sort by corner first, as the key needs
    const key = p.reduce((k, q) => k * B + q, 0);
    let id = ids.get(key);
    if (id === undefined) { id = make(a, wa, b, wb, c, wc); ids.set(key, id); }
    return id;
  };
  const row = new Int32Array((n + 1) * (n + 2) / 2), at = (i, j) => i * (n + 1) - i * (i - 1) / 2 + j;
  for (const [a, b, c] of F) {
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) row[at(i, j)] = point(a, n - i - j, b, i, c, j);
    for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) {
      tris[nt++] = row[at(i, j)]; tris[nt++] = row[at(i + 1, j)]; tris[nt++] = row[at(i, j + 1)];
      if (i + j < n - 1) { tris[nt++] = row[at(i + 1, j)]; tris[nt++] = row[at(i + 1, j + 1)]; tris[nt++] = row[at(i, j + 1)]; }
    }
  }
  // Triangle centres; each point's outgoing edges (triangle (v, a, b) gives v an edge to a); and each point's mean
  // distance to its neighbours, over those edges.
  const tc = new Float32Array(T * 3), outW = new Int32Array(count * 6), outT = new Int32Array(count * 6);
  const outN = new Uint8Array(count), spacing = new Float32Array(count);
  for (let k = 0; k < T; k++) {
    let cx = 0, cy = 0, cz = 0;
    for (let e = 0; e < 3; e++) {
      const v = tris[k * 3 + e], w = tris[k * 3 + (e + 1) % 3];
      cx += pts[v * 3]; cy += pts[v * 3 + 1]; cz += pts[v * 3 + 2];
      const x = pts[v * 3] - pts[w * 3], y = pts[v * 3 + 1] - pts[w * 3 + 1], z = pts[v * 3 + 2] - pts[w * 3 + 2];
      spacing[v] += Math.sqrt(x * x + y * y + z * z);   // at a degree apart, the chord matches the arc to 1 in 10^4
      outW[v * 6 + outN[v]] = w; outT[v * 6 + outN[v]] = k; outN[v]++;
    }
    const l = Math.sqrt(cx * cx + cy * cy + cz * cz);
    tc[k * 3] = cx / l; tc[k * 3 + 1] = cy / l; tc[k * 3 + 2] = cz / l;
  }
  // Corners in order: from a triangle (v, a, b) around v, the next one counter-clockwise is the one with edge v -> b.
  const cornerStart = new Int32Array(count + 1), corner = new Float32Array(count * 6 * 3), cornerNbr = new Int32Array(count * 6);
  let nc = 0;
  for (let v = 0; v < count; v++) {
    const m = outN[v];
    spacing[v] /= m;
    cornerStart[v] = nc;
    let k = outT[v * 6];
    for (let s = 0; s < m; s++) {
      corner[nc * 3] = tc[k * 3]; corner[nc * 3 + 1] = tc[k * 3 + 1]; corner[nc * 3 + 2] = tc[k * 3 + 2]; nc++;
      // b: the corner of triangle k that comes just before v
      const o = tris[k * 3] === v ? 0 : tris[k * 3 + 1] === v ? 1 : 2, b = tris[k * 3 + (o + 2) % 3];
      cornerNbr[nc - 1] = b;   // this triangle and the next share the edge v-b
      for (let q = 0; q < m; q++) if (outW[v * 6 + q] === b) { k = outT[v * 6 + q]; break; }
    }
  }
  cornerStart[count] = nc;
  return { count, dir: Float32Array.from(pts), spacing, cornerStart, corner: corner.subarray(0, nc * 3), cornerNbr: cornerNbr.subarray(0, nc) };
}
