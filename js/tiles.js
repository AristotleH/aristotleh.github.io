// The globe's tiles, as plain arrays: no three.js, so this runs in a worker (tiles-worker.js) or, as a fallback, on
// the page. Each tile is its own cell of the sphere: a square of a cube pushed out onto the sphere, or the hexagon
// (twelve pentagons) around a point of a subdivided icosahedron. A tile is its cell raised straight out from the
// Earth's centre, so neighbouring tiles share corners and walls exactly: there are no seams. `gap` pulls each
// cell's corners toward its centre by that share, leaving an even margin around every tile.
import { hexGrid } from "./hexgrid.js";
import { makeTerrain } from "./terrain.js";

const D = Math.PI / 180;
const FACES = [
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
];
const hash = i => { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x); };
// Small vector helpers on [x, y, z] arrays, with three.js's arithmetic (normalize scales by 1 / length).
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = a => { const s = 1 / (Math.sqrt(dot(a, a)) || 1); return [a[0] * s, a[1] * s, a[2] * s]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const angle = (a, b) => { const d = Math.sqrt(dot(a, a) * dot(b, b)); return d ? Math.acos(Math.max(-1, Math.min(1, dot(a, b) / d))) : Math.PI / 2; };
const latOf = v => Math.asin(Math.max(-1, Math.min(1, v[1]))) / D, lonOf = v => Math.atan2(-v[2], v[0]) / D;
const cubeToSphere = (f, a, b) => {
  const u = Math.tan(a * Math.PI / 4), v = Math.tan(b * Math.PI / 4);
  return norm([f[0][0] + f[1][0] * u + f[2][0] * v, f[0][1] + f[1][1] * u + f[2][1] * v, f[0][2] + f[1][2] * u + f[2][2] * v]);
};

// The settings every step needs. `input` carries the grid settings, the terrain (see terrain.js), the detail
// settings and the detail stops' directions.
function setup(input) {
  const HEX = input.shape === "hex", N = input.tilesPerFaceEdge, HN = input.hexSubdivisions;
  // Globe tile width in radians: a cube face spans 90 degrees, an icosahedron edge about 63.4.
  const TOP_ANG = HEX ? Math.atan(2) / HN : (Math.PI / 2) / N;
  // Globe tiles within REACH of a detail stop get subdivided in the close-up. REACH is where subdivided tiles have
  // grown back to globe-tile size, so sizes never jump.
  const RATIO = input.sizeToDistance, REACH = TOP_ANG / RATIO * 1.25;
  return { ...input, HEX, N, HN, TOP_ANG, RATIO, COS_REACH: Math.cos(REACH) };
}

// Globe tiles: where each sits, what it is (ocean, land, ice), its elevation and whether detail replaces it, and the
// geometry for each block of tiles. Tiles are drawn in blocks, the tiles whose centres fall in one patch of a cube
// face split 6 x 6, so blocks beyond the horizon or outside the view can be skipped.
export function buildGlobe(input, grid = null) {
  const S = setup(input), TR = makeTerrain(input.terrain);
  const { HEX, N, TOP_ANG, COS_REACH, detailStops, ice, gap } = S;
  const HEXG = HEX ? grid || hexGrid(S.HN) : null;
  const COUNT = HEX ? HEXG.count : 6 * N * N;
  const tileKind = new Uint8Array(COUNT), tileTone = new Float32Array(COUNT), tileElev = new Float32Array(COUNT);
  const tileBay = new Uint8Array(COUNT), tileDir = new Float32Array(COUNT * 3), tileAng = new Float32Array(COUNT);
  const OFFS = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
  // Land where most of five samples (the centre counted twice, four around it) are land.
  function classify(g, dir, ang) {
    const lat = latOf(dir), lon = lonOf(dir);
    let xa = [-dir[2], 0, dir[0]];
    if (dot(xa, xa) < 1e-9) xa = [1, 0, 0];
    xa = norm(xa);
    const ya = cross(dir, xa), e = ang * 0.3;
    let votes = TR.isLand(lat, lon) * 2;
    for (const o of OFFS) {
      const p = norm([dir[0] + xa[0] * o[0] * e + ya[0] * o[1] * e, dir[1] + xa[1] * o[0] * e + ya[1] * o[1] * e, dir[2] + xa[2] * o[0] * e + ya[2] * o[1] * e]);
      votes += TR.isLand(latOf(p), lonOf(p));
    }
    const land = votes >= 3, isIce = land && (lat > ice.north || lat < ice.south);
    tileKind[g] = isIce ? 2 : land ? 1 : 0;
    tileTone[g] = hash(g + 1);
    tileElev[g] = land ? TR.elevAt(lat, lon, ang / 2 / D) : 0;
    tileAng[g] = ang;
    tileDir[g * 3] = dir[0]; tileDir[g * 3 + 1] = dir[1]; tileDir[g * 3 + 2] = dir[2];
    let near = 0;   // within REACH of a detail stop: compare dot products against cos(REACH), no acos per tile
    for (const p of detailStops) if (dot(dir, p) > COS_REACH) { near = 1; break; }
    tileBay[g] = near;
  }
  let cornerStart, corner, cornerNbr = null;
  if (HEX) {
    ({ cornerStart, corner, cornerNbr } = HEXG);
    for (let g = 0; g < COUNT; g++) classify(g, [HEXG.dir[g * 3], HEXG.dir[g * 3 + 1], HEXG.dir[g * 3 + 2]], HEXG.spacing[g]);
  } else {
    cornerStart = new Int32Array(COUNT + 1); corner = new Float32Array(COUNT * 12);
    let g = 0;
    FACES.forEach(f => {
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++, g++) {
        const a0 = i / N * 2 - 1, b0 = j / N * 2 - 1, h = 2 / N;
        classify(g, cubeToSphere(f, a0 + h / 2, b0 + h / 2), TOP_ANG);
        cornerStart[g] = g * 4;
        [[a0, b0], [a0 + h, b0], [a0 + h, b0 + h], [a0, b0 + h]].forEach(([a, b], k) => corner.set(cubeToSphere(f, a, b), (g * 4 + k) * 3));
      }
    });
    cornerStart[COUNT] = COUNT * 4;
  }

  const K = 6, lists = Array.from({ length: 6 * K * K }, () => []);
  for (let g = 0; g < COUNT; g++) {
    const x = tileDir[g * 3], y = tileDir[g * 3 + 1], z = tileDir[g * 3 + 2];
    let fi = 0, best = -2;
    for (let k = 0; k < 6; k++) { const d = FACES[k][0][0] * x + FACES[k][0][1] * y + FACES[k][0][2] * z; if (d > best) { best = d; fi = k; } }
    const f = FACES[fi];
    const a = Math.atan((f[1][0] * x + f[1][1] * y + f[1][2] * z) / best) * 4 / Math.PI;
    const b = Math.atan((f[2][0] * x + f[2][1] * y + f[2][2] * z) / best) * 4 / Math.PI;
    const ci = Math.min(K - 1, Math.max(0, Math.floor((a + 1) / 2 * K))), cj = Math.min(K - 1, Math.max(0, Math.floor((b + 1) / 2 * K)));
    lists[(fi * K + ci) * K + cj].push(g);
  }
  const land = Uint8Array.from(tileKind, k => k > 0 ? 1 : 0);
  // A land tile's wall along an edge is only seen where the tile beyond is lower: ocean, lower land, or a tile that
  // detail replaces (it drops away in the close-up). Where neighbours aren't known (squares), every edge gets one.
  const wallAt = cornerNbr ? (k, c) => {
    const nb = cornerNbr[c];
    return !land[nb] || tileBay[k] || tileBay[nb] || tileElev[k] > tileElev[nb];
  } : null;
  const T = { dir: tileDir, cornerStart, corner, elev: tileElev, land, bay: tileBay, delay: new Float32Array(COUNT), wallAt };
  const blocks = [];
  for (const list of lists) {
    if (!list.length) continue;
    const idx = Int32Array.from(list), c = [0, 0, 0];
    for (const g of idx) { c[0] += tileDir[g * 3]; c[1] += tileDir[g * 3 + 1]; c[2] += tileDir[g * 3 + 2]; }
    const center = norm(c);
    let minDot = 1, widest = 0, hasLand = false, peak = 0;
    const bayAt = [];
    idx.forEach((g, n) => {
      minDot = Math.min(minDot, center[0] * tileDir[g * 3] + center[1] * tileDir[g * 3 + 1] + center[2] * tileDir[g * 3 + 2]);
      widest = Math.max(widest, tileAng[g]);
      if (tileKind[g] > 0) { hasLand = true; peak = Math.max(peak, tileElev[g]); }
      if (tileBay[g]) bayAt.push(n);
    });
    blocks.push({ idx, center, radius: Math.acos(Math.max(-1, Math.min(1, minDot))) + widest, land: hasLand, peak,
      bayAt: Int32Array.from(bayAt), geo: tileGeometry(idx, T, gap) });
  }
  return { count: COUNT, tileDir, tileAng, tileKind, tileTone, tileElev, tileBay, cornerStart, corner, blocks };
}

// One mesh's geometry from a list of tiles: each tile's top, and its walls where they can be seen. Vertices sit on
// the unit sphere with a flag for top or base; the vertex shader raises tops to the tile's height. Ocean is the
// lowest ground and all of one height, so with no gap an ocean tile's walls are always hidden and skipped (drawing
// them anyway makes their top edges flicker along the seams). With a gap, every tile gets walls.
const MAXC = 16;
function tileGeometry(ids, S, gap) {
  const walls = k => gap > 0 || S.land[k];
  const wallAt = (k, c) => (!S.noWall || !S.noWall[c]) && (gap > 0 || !S.wallAt || S.wallAt(k, c));
  let nv = 0, ni = 0;
  for (const k of ids) {
    const c0 = S.cornerStart[k], m = S.cornerStart[k + 1] - c0;
    nv += m; ni += (m - 2) * 3;
    if (walls(k)) for (let j = 0; j < m; j++) if (wallAt(k, c0 + j)) { nv += 4; ni += 6; }
  }
  const pos = new Float32Array(nv * 3), nor = new Int8Array(nv * 3), info = new Float32Array(nv * 4);
  const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni), vStart = new Int32Array(ids.length + 1);
  const ring = new Float64Array(MAXC * 3);
  let v = 0, i = 0, el = 0, flags = 0, dl = 0, nx = 0, ny = 0, nz = 0;
  const face = (x, y, z) => { const s = 1 / (Math.sqrt(x * x + y * y + z * z) || 1); nx = Math.round(x * s * 127); ny = Math.round(y * s * 127); nz = Math.round(z * s * 127); };
  const put = (j, top) => {
    const o = v * 3, o4 = v * 4;
    pos[o] = ring[j * 3]; pos[o + 1] = ring[j * 3 + 1]; pos[o + 2] = ring[j * 3 + 2];
    nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz;
    info[o4] = el; info[o4 + 1] = flags; info[o4 + 2] = dl; info[o4 + 3] = top;
    v++;
  };
  ids.forEach((k, n) => {
    vStart[n] = v;
    const c0 = S.cornerStart[k], m = Math.min(MAXC, S.cornerStart[k + 1] - c0);
    const dx = S.dir[k * 3], dy = S.dir[k * 3 + 1], dz = S.dir[k * 3 + 2];
    const f = S.shrunk && S.shrunk[k] ? 1 : 1 - gap;   // hex detail pieces arrive with the gap already taken
    for (let j = 0; j < m; j++) {
      const x = (S.corner[(c0 + j) * 3] - dx) * f + dx, y = (S.corner[(c0 + j) * 3 + 1] - dy) * f + dy, z = (S.corner[(c0 + j) * 3 + 2] - dz) * f + dz;
      const s = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
      ring[j * 3] = x * s; ring[j * 3 + 1] = y * s; ring[j * 3 + 2] = z * s;
    }
    el = S.elev[k]; flags = S.land[k] + 2 * S.bay[k]; dl = S.delay[k];
    const t0 = v;
    face(dx, dy, dz);
    for (let j = 0; j < m; j++) put(j, 1);
    for (let j = 1; j < m - 1; j++) { index[i++] = t0; index[i++] = t0 + j; index[i++] = t0 + j + 1; }
    if (walls(k)) for (let j = 0; j < m; j++) {
      if (!wallAt(k, c0 + j)) continue;
      const a = j * 3, b = ((j + 1) % m) * 3;
      // outward normal: edge x up
      const ex = ring[b] - ring[a], ey = ring[b + 1] - ring[a + 1], ez = ring[b + 2] - ring[a + 2];
      const ux = ring[a] + ring[b], uy = ring[a + 1] + ring[b + 1], uz = ring[a + 2] + ring[b + 2];
      face(ey * uz - ez * uy, ez * ux - ex * uz, ex * uy - ey * ux);
      const w0 = v;
      put(j, 0); put((j + 1) % m, 0); put((j + 1) % m, 1); put(j, 1);
      index[i++] = w0; index[i++] = w0 + 1; index[i++] = w0 + 2; index[i++] = w0; index[i++] = w0 + 2; index[i++] = w0 + 3;
    }
  });
  vStart[ids.length] = v;
  return { pos, nor, info, index, vStart, nv: v };
}

// Level of detail. Every globe tile near a detail stop is split, again and again, until tiles are small near the
// stops and grow with distance from them. Squares split into quarters along the cube grid. Hexagons don't nest, so
// hex detail comes from regular hex grids in the plane touching the sphere at each region's centre (a gnomonic
// projection, where great circles are straight lines). Level k has spacing TOP_ANG / 2^k and all levels share one
// origin. A split globe tile is covered by level-1 hexagons clipped to its outline; those still too big are covered
// by level-2 hexagons clipped to theirs, and so on. Pieces of one hexagon in different parents get the same height
// and colour, and the gap is taken from the whole hexagon before clipping, so they read as one tile. Either way the
// pieces fill their parent exactly, so tiles of different sizes meet without cracks.
export function buildDetail(input, G) {
  const S = setup(input), TR = makeTerrain(input.terrain);
  const { HEX, N, TOP_ANG, RATIO, detailStops, anchors, gap } = S;
  // Finest tile: a little over the finest region's cell size. Elsewhere tile size <= RATIO x distance.
  const MIN_TILE = Math.min(...input.terrain.regions.map(g => g.step * D * 1.1), Infinity);
  const nearestDetailStop = v => { let d = Infinity; for (const p of detailStops) d = Math.min(d, angle(v, p)); return d; };
  const L = { dir: [], cornerStart: [0], corner: [], elev: [], land: [], kind: [], tone: [], parent: [], shrunk: [], cell: [] };
  function emit(c, pts, ang, parent, tone = hash(L.tone.length + 7919), shrunk = 0, cell = -1 - L.tone.length) {
    const lat = latOf(c), lon = lonOf(c);
    const land = TR.landFrac(lat, lon, ang / 2 / D) >= 0.5;
    L.dir.push(c[0], c[1], c[2]);
    for (const p of pts) L.corner.push(p[0], p[1], p[2]);
    L.cornerStart.push(L.corner.length / 3);
    L.land.push(land ? 1 : 0); L.kind.push(land ? 1 : 0);
    L.tone.push(tone); L.parent.push(parent); L.shrunk.push(shrunk); L.cell.push(cell);
    L.elev.push(land ? TR.elevAt(lat, lon, ang / 2 / D) : 0);
  }
  const wantSplit = (c, ang, childAng) => {
    const d = Math.max(0, nearestDetailStop(c) - ang * 0.7);
    return childAng >= MIN_TILE && ang > d * RATIO;
  };
  function splitSquare(fi, a0, b0, span, parent) {
    const f = FACES[fi], c = cubeToSphere(f, a0 + span / 2, b0 + span / 2), ang = span * Math.PI / 4;
    if (wantSplit(c, ang, ang / 2)) {
      const h = span / 2;
      splitSquare(fi, a0, b0, h, parent); splitSquare(fi, a0 + h, b0, h, parent);
      splitSquare(fi, a0, b0 + h, h, parent); splitSquare(fi, a0 + h, b0 + h, h, parent);
      return;
    }
    emit(c, [[a0, b0], [a0 + span, b0], [a0 + span, b0 + span], [a0, b0 + span]].map(([a, b]) => cubeToSphere(f, a, b)), ang, parent);
  }
  const planes = anchors.map(A => { const e1 = norm([-A[2], 0, A[0]]); return { A, e1, e2: cross(A, e1) }; });
  const toPlane = (P, v) => { const k = 1 / dot(v, P.A); return [dot(v, P.e1) * k, dot(v, P.e2) * k]; };
  const toSphere = (P, q) => norm([P.A[0] + P.e1[0] * q[0] + P.e2[0] * q[1], P.A[1] + P.e1[1] * q[0] + P.e2[1] * q[1], P.A[2] + P.e1[2] * q[0] + P.e2[2] * q[1]]);
  // Keep the part of convex polygon `poly` inside convex, counter-clockwise polygon `by`. Clipping leaves points
  // that are equal or nearly so; they're merged, and near-zero edges are skipped, since their direction is noise.
  const EPS = 1e-10;
  function clipTo(poly, by) {
    let out = poly;
    for (let e = 0; e < by.length && out.length >= 3; e++) {
      const p0 = by[e], p1 = by[(e + 1) % by.length], len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      if (len < EPS) continue;
      const ux = (p1[0] - p0[0]) / len, uy = (p1[1] - p0[1]) / len;
      const side = q => ux * (q[1] - p0[1]) - uy * (q[0] - p0[0]);
      const src = out; out = [];
      for (let j = 0; j < src.length; j++) {
        const p = src[j], q = src[(j + 1) % src.length], fp = side(p), fq = side(q);
        if (fp >= -EPS) out.push(p);
        if ((fp > EPS && fq < -EPS) || (fp < -EPS && fq > EPS)) { const t = fp / (fp - fq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
      }
      out = out.filter((q, j) => { const r = out[(j + 1) % out.length]; return out.length < 2 || Math.hypot(q[0] - r[0], q[1] - r[1]) > EPS; });
    }
    return out;
  }
  const area = poly => { let a = 0; for (let j = 0; j < poly.length; j++) { const p = poly[j], q = poly[(j + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  const HEX6 = Array.from({ length: 6 }, (_, m) => [Math.cos(Math.PI / 6 + m * Math.PI / 3), Math.sin(Math.PI / 6 + m * Math.PI / 3)]);
  const hexAt = (cx, cy, r) => HEX6.map(u => [cx + r * u[0], cy + r * u[1]]);
  // Where a hexagon lies against a convex, counter-clockwise region: 0 outside, 1 inside, 2 across its edge.
  function against(cx, cy, r, region) {
    let inside = true;
    for (let e = 0; e < region.length; e++) {
      const p0 = region[e], p1 = region[(e + 1) % region.length], len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      if (len < EPS) continue;
      const ux = (p1[0] - p0[0]) / len, uy = (p1[1] - p0[1]) / len, d = ux * (cy - p0[1]) - uy * (cx - p0[0]);
      if (d < -r) return 0;   // centre further out than the hexagon's reach: all of it is outside this edge
      let lo = Infinity, hi = -Infinity;
      for (const u of HEX6) { const w = d + r * (ux * u[1] - uy * u[0]); lo = Math.min(lo, w); hi = Math.max(hi, w); }
      if (hi < -EPS) return 0;
      if (lo < -EPS) inside = false;
    }
    return inside ? 1 : 2;
  }
  function refine(P, region, k, parent) {
    const sp = TOP_ANG / 2 ** k, r = sp / Math.sqrt(3), rowH = sp * Math.sqrt(3) / 2, tiny = sp * sp * 1e-5;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const q of region) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
    for (let j = Math.floor((y0 - r) / rowH); j <= Math.ceil((y1 + r) / rowH); j++)
      for (let i = Math.floor((x0 - r) / sp - j / 2); i <= Math.ceil((x1 + r) / sp - j / 2); i++) {
        const cx = sp * (i + j / 2), cy = rowH * j, where = against(cx, cy, r, region);
        if (!where) continue;
        const piece = where === 1 ? hexAt(cx, cy, r) : clipTo(hexAt(cx, cy, r), region);
        if (piece.length < 3 || area(piece) < tiny) continue;
        const c = toSphere(P, [cx, cy]);
        if (wantSplit(c, sp, sp / 2)) { refine(P, piece, k + 1, parent); continue; }
        const out = gap > 0 ? (where === 1 ? hexAt(cx, cy, r * (1 - gap)) : clipTo(hexAt(cx, cy, r * (1 - gap)), region)) : piece;
        if (out.length < 3 || area(out) < tiny) continue;
        emit(c, out.map(q => toSphere(P, q)), sp, parent, hash(k * 1009 + i * 7919 + j * 104729), 1, (k * 1e5 + i + 5e4) * 1e5 + j + 5e4);
      }
  }
  for (let idx = 0; idx < G.count; idx++) {
    if (!G.tileBay[idx]) continue;
    if (HEX) {
      const c = [G.tileDir[idx * 3], G.tileDir[idx * 3 + 1], G.tileDir[idx * 3 + 2]], pts = [];
      for (let j = G.cornerStart[idx]; j < G.cornerStart[idx + 1]; j++) pts.push([G.corner[j * 3], G.corner[j * 3 + 1], G.corner[j * 3 + 2]]);
      const P = planes.reduce((b, a) => dot(a.A, c) > dot(b.A, c) ? a : b);
      if (wantSplit(c, G.tileAng[idx], G.tileAng[idx] / 2)) refine(P, pts.map(v => toPlane(P, v)), 1, idx);
      else emit(c, pts, G.tileAng[idx], idx);
    } else {
      const fi = Math.floor(idx / (N * N)), rem = idx % (N * N), i = Math.floor(rem / N), j = rem % N;
      splitSquare(fi, i / N * 2 - 1, j / N * 2 - 1, 2 / N, idx);
    }
  }
  const count = L.tone.length;
  // A hexagon cut between two parents is one tile to the eye: the edge along the cut gets no walls.
  const noWall = new Uint8Array(L.corner.length / 3), edges = new Map();
  for (let k = 0; k < count; k++) {
    if (L.cell[k] < 0) continue;
    const c0 = L.cornerStart[k], m = L.cornerStart[k + 1] - c0;
    for (let j = 0; j < m; j++) {
      const a = (c0 + j) * 3, b = (c0 + (j + 1) % m) * 3;
      const key = L.cell[k] + ":" + [0, 1, 2].map(t => Math.round((L.corner[a + t] + L.corner[b + t]) * 5e6)).join(",");
      const other = edges.get(key);
      if (other !== undefined) { noWall[other] = 1; noWall[c0 + j] = 1; } else edges.set(key, c0 + j);
    }
  }
  const T = { dir: Float32Array.from(L.dir), cornerStart: Int32Array.from(L.cornerStart), corner: Float32Array.from(L.corner),
    elev: L.elev, land: L.land, bay: new Uint8Array(count), delay: new Float32Array(count), shrunk: L.shrunk, noWall };
  const ids = Array.from({ length: count }, (_, k) => k);
  const c = [0, 0, 0];
  for (let k = 0; k < count; k++) { c[0] += T.dir[k * 3]; c[1] += T.dir[k * 3 + 1]; c[2] += T.dir[k * 3 + 2]; }
  const center = norm(c);
  let radius = 0;
  for (let k = 0; k < count; k++) radius = Math.max(radius, angle(center, [T.dir[k * 3], T.dir[k * 3 + 1], T.dir[k * 3 + 2]]));
  return { count, parent: Int32Array.from(L.parent), kind: Uint8Array.from(L.kind), tone: Float32Array.from(L.tone),
    elev: Float32Array.from(L.elev), center, radius, geo: tileGeometry(ids, T, gap) };
}
