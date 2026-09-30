// Hex tiles: an icosahedron with each edge split n times, pushed out onto the sphere (10n^2 + 2 points). Points are
// keyed by their exact integer weights on the icosahedron's corners, so a point on an edge shared by two faces is
// made once. Each point's tile is its cell of the sphere: the centres of the small triangles around it, in order
// (six, or five at the icosahedron's corners). Neighbouring cells share their corners exactly.
export function hexGrid(n) {
  const t = (1 + Math.sqrt(5)) / 2;
  const V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  const F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const ids = new Map(), pts = [];
  const B = 12 * (n + 1);
  const make = (a, wa, b, wb, c, wc) => {
    const x = V[a][0] * wa + V[b][0] * wb + V[c][0] * wc, y = V[a][1] * wa + V[b][1] * wb + V[c][1] * wc;
    const z = V[a][2] * wa + V[b][2] * wb + V[c][2] * wc, l = Math.hypot(x, y, z);
    pts.push(x / l, y / l, z / l);
    return pts.length / 3 - 1;
  };
  // Weights wa + wb + wc = n on corners a, b, c. A point inside a face belongs to that face alone; one on an edge
  // or corner is shared, so it's looked up by its non-zero (corner, weight) pairs in corner order, packed into a key.
  const point = (a, wa, b, wb, c, wc) => {
    if (wa && wb && wc) return make(a, wa, b, wb, c, wc);
    const e = [[a, wa], [b, wb], [c, wc]].filter(p => p[1] > 0).sort((p, q) => p[0] - q[0]);
    let key = 0;
    for (const [q, k] of e) key = key * B + q * (n + 1) + k + 1;
    let id = ids.get(key);
    if (id === undefined) { id = make(a, wa, b, wb, c, wc); ids.set(key, id); }
    return id;
  };
  const tris = [];
  for (const [a, b, c] of F) {
    const g = [];
    for (let i = 0; i <= n; i++) { g.push([]); for (let j = 0; j <= n - i; j++) g[i].push(point(a, n - i - j, b, i, c, j)); }
    for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) {
      tris.push(g[i][j], g[i + 1][j], g[i][j + 1]);
      if (i + j < n - 1) tris.push(g[i + 1][j], g[i + 1][j + 1], g[i][j + 1]);
    }
  }
  const count = pts.length / 3, spacing = new Float32Array(count), edgeN = new Uint8Array(count);
  // Triangle centres, the triangles around each point, and each point's mean distance to its neighbours (every
  // edge is in two triangles, so averaging over a point's triangles' edges counts each neighbour equally).
  const T = tris.length / 3, tc = new Float32Array(T * 3), around = Array.from({ length: count }, () => []);
  // Straight-line distance: at a degree or so apart it matches the arc to 1 part in 10^4, without an acos.
  const dist = (a, b) => {
    const x = pts[a * 3] - pts[b * 3], y = pts[a * 3 + 1] - pts[b * 3 + 1], z = pts[a * 3 + 2] - pts[b * 3 + 2];
    return Math.sqrt(x * x + y * y + z * z);
  };
  for (let t = 0; t < T; t++) {
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < 3; k++) {
      const v = tris[t * 3 + k], u = tris[t * 3 + (k + 1) % 3], w = tris[t * 3 + (k + 2) % 3];
      cx += pts[v * 3]; cy += pts[v * 3 + 1]; cz += pts[v * 3 + 2]; around[v].push(t);
      spacing[v] += dist(v, u) + dist(v, w); edgeN[v] += 2;
    }
    const l = Math.hypot(cx, cy, cz);
    tc[t * 3] = cx / l; tc[t * 3 + 1] = cy / l; tc[t * 3 + 2] = cz / l;
  }
  const cornerStart = new Int32Array(count + 1), corner = new Float32Array(T * 3 * 3);
  let nc = 0;
  for (let i = 0; i < count; i++) {
    const px = pts[i * 3], py = pts[i * 3 + 1], pz = pts[i * 3 + 2], first = around[i][0];
    spacing[i] /= edgeN[i];
    // Corners counter-clockwise seen from outside: sort by angle in a tangent basis (e1, e2 = p x e1).
    let ex = tc[first * 3] - px, ey = tc[first * 3 + 1] - py, ez = tc[first * 3 + 2] - pz;
    const d = ex * px + ey * py + ez * pz;
    ex -= d * px; ey -= d * py; ez -= d * pz;
    const fx = py * ez - pz * ey, fy = pz * ex - px * ez, fz = px * ey - py * ex;
    const ring = around[i].map(t => [t, Math.atan2(tc[t * 3] * fx + tc[t * 3 + 1] * fy + tc[t * 3 + 2] * fz,
      tc[t * 3] * ex + tc[t * 3 + 1] * ey + tc[t * 3 + 2] * ez)]).sort((p, q) => p[1] - q[1]);
    cornerStart[i] = nc;
    for (const [t] of ring) { corner[nc * 3] = tc[t * 3]; corner[nc * 3 + 1] = tc[t * 3 + 1]; corner[nc * 3 + 2] = tc[t * 3 + 2]; nc++; }
  }
  cornerStart[count] = nc;
  return { count, dir: Float32Array.from(pts), spacing, cornerStart, corner: corner.subarray(0, nc * 3) };
}
