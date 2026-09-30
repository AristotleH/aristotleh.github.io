// The 3D globe (three.js): tiles raised by elevation, pins that group when they crowd, and a camera that flies
// between stops. It starts the first time the 3D view is shown and sleeps while another view is up.
import { ALL, EARTH_KM, INTRO, KINDS, REGIONS, SITE, STOPS, TERRAIN, reduceMotion, shapeOf } from "./site.js";
import { MODE } from "./mode.js";
import { active, goTo, syncScrollZone } from "./page.js";
import { zoomGestures } from "./gestures.js";
import { hexGrid } from "./hexgrid.js";

export async function globe() {
  const G = SITE.globe, T = G.terrain;
  let lastSig = NaN, needsRender = true, lastCamKey = NaN, animating = true, wasOverview = null;   // render-on-demand state
  const canvas = document.getElementById("globe");
  let renderer;
  try {
    if (!window.THREE) throw new Error("three.js missing");
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  } catch (e) {
    document.documentElement.classList.add("no-webgl");
    return;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(G.camera.fovDeg, 1, 0.01, 50);
  // Colors are managed in linear space and written out as sRGB, so shading falls off the way the eye expects.
  renderer.outputEncoding = THREE.sRGBEncoding;
  // Lights travel with the camera. A low key light from the upper left rakes across the terrain so relief reads;
  // a soft cool fill lifts the shadow side; a back light catches the far sides of tiles along the globe's edge.
  const hemi = new THREE.HemisphereLight(0xffffff, 0x1c2833, 0.3);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff4e6, 0.78);
  key.position.set(-1.4, 1.1, 0.55);
  const fill = new THREE.DirectionalLight(0xcfe3ff, 0.16);
  fill.position.set(1.3, -0.5, 0.7);
  const rim = new THREE.DirectionalLight(0xffffff, 0.28);
  rim.position.set(0.4, 0.8, -1.2);
  camera.add(key, fill, rim);
  scene.add(camera);

  // Globe land mask: equirectangular, north row first.
  const MW = G.layers.land.columns, MH = G.layers.land.rows, PER_DEG = MW / 360;
  const mask = SITE.globe.mask;
  const isLand = (lat, lon) => {
    const r = Math.min(MH - 1, Math.max(0, Math.floor((90 - lat) * PER_DEG)));
    const c = ((Math.floor((lon + 180) * PER_DEG) % MW) + MW) % MW;
    return mask[r * MW + c];
  };
  const D = Math.PI / 180;

  // Elevation (km) from the globe layer, or a region's own layer where it has one. Bilinear between cell centres.
  const EL = G.layers.elevation;
  const globeElev = { w: EL.columns, h: EL.rows, lat1: 90, lon0: -180, step: 360 / EL.columns, wrap: true,
    km: EL.metersPerUnit / 1000, data: (await TERRAIN).globe };
  for (const g of REGIONS) if (g.elevationLayer) {
    const L = g.elevationLayer;
    g.elev = { w: L.columns, h: L.rows, lat1: g.lat1, lon0: g.lon0, step: (g.lon1 - g.lon0) / L.columns, wrap: false,
      km: L.metersPerUnit / 1000, data: (await TERRAIN).regions[g.id] };
  }
  function sampleElev(E, lat, lon) {
    const x = (lon - E.lon0) / E.step - 0.5, y = (E.lat1 - lat) / E.step - 0.5;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const at = (c, r) => {
      r = Math.min(E.h - 1, Math.max(0, r));
      c = E.wrap ? ((c % E.w) + E.w) % E.w : Math.min(E.w - 1, Math.max(0, c));
      return E.data[r * E.w + c];
    };
    const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx, bot = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
    return (top * (1 - fy) + bot * fy) * E.km;
  }
  const elevPoint = (lat, lon) => {
    const g = REGIONS.find(g => g.elev && lat > g.lat0 && lat < g.lat1 && lon > g.lon0 && lon < g.lon1);
    return sampleElev(g ? g.elev : globeElev, lat, lon);
  };
  // Mean over a tile: 3 x 3 samples across its footprint.
  function elevAt(lat, lon, halfDeg) {
    let sum = 0;
    const hc = halfDeg / Math.max(0.05, Math.cos(lat * D));
    for (const dy of [-0.66, 0, 0.66]) for (const dx of [-0.66, 0, 0.66]) sum += elevPoint(lat + dy * halfDeg, lon + dx * hc);
    return sum / 9;
  }
  let MAX_ELEV = 0;
  for (const v of globeElev.data) if (v > MAX_ELEV) MAX_ELEV = v;
  MAX_ELEV *= globeElev.km;
  // Tile height, in globe radii. m blends from the whole-globe settings (0) to the close-up settings (1).
  const blend = (pair, m) => pair.globe + (pair.closeUp - pair.globe) * m;
  const heightOf = (land, elevKm, m) => (blend(T.oceanThicknessKm, m) +
    (land ? Math.max(0, blend(T.landBaseKm, m) + elevKm * blend(T.verticalExaggeration, m)) : 0)) / EARTH_KM;
  const vecFromLatLon = (lat, lon, r = 1) => new THREE.Vector3(
    r * Math.cos(lat * D) * Math.cos(lon * D), r * Math.sin(lat * D), -r * Math.cos(lat * D) * Math.sin(lon * D));
  const latLonOf = v => [Math.asin(Math.max(-1, Math.min(1, v.y))) / D, Math.atan2(-v.z, v.x) / D];

  // Tiles. Each tile is its own cell of the sphere: a square of a cube pushed out onto the sphere, or the hexagon
  // (twelve pentagons) around a point of a subdivided icosahedron. A tile is its cell raised straight out from the
  // Earth's centre, so neighbouring tiles share corners and walls exactly: there are no seams. `tileGap` pulls each
  // cell's corners toward its centre by that share, leaving an even margin around every tile.
  const HEX = G.grid.shape === "hex";
  const N = G.grid.tilesPerFaceEdge, HN = G.grid.hexSubdivisions, GAP = G.grid.tileGap;
  const FACES = [
    [[1,0,0],[0,0,-1],[0,1,0]], [[-1,0,0],[0,0,1],[0,1,0]],
    [[0,1,0],[1,0,0],[0,0,-1]], [[0,-1,0],[1,0,0],[0,0,1]],
    [[0,0,1],[1,0,0],[0,1,0]],  [[0,0,-1],[-1,0,0],[0,1,0]],
  ].map(f => f.map(a => new THREE.Vector3(...a)));
  const HEXG = HEX ? hexGrid(HN) : null;
  const COUNT = HEX ? HEXG.count : 6 * N * N;
  const tileKind = new Uint8Array(COUNT);   // 0 ocean, 1 land, 2 ice
  const tileTone = new Float32Array(COUNT), tileElev = new Float32Array(COUNT);
  const tileBay = new Uint8Array(COUNT), tileDelay = new Float32Array(COUNT);
  // Detail regions come from the site data. Globe tiles within REACH of a stop inside one get subdivided in
  // the close-up. REACH is where subdivided tiles have grown back to globe-tile size, so sizes never jump.
  const regionAt = (lat, lon, half = 0) => REGIONS.find(g => lat - half > g.lat0 && lat + half < g.lat1 &&
    lon - half / Math.cos(lat * D) > g.lon0 && lon + half / Math.cos(lat * D) < g.lon1);
  const regionOf = s => regionAt(s.lat, s.lon);
  const detailStops = STOPS.filter(regionOf).map(s => vecFromLatLon(s.lat, s.lon));
  // Globe tile width in radians: a cube face spans 90 degrees, an icosahedron edge about 63.4.
  const TOP_ANG = HEX ? Math.atan(2) / HN : (Math.PI / 2) / N;
  const RATIO = G.detail.sizeToDistance, REACH = TOP_ANG / RATIO * 1.25, COS_REACH = Math.cos(REACH);
  const nearestDetailStop = v => { let d = Infinity; for (const p of detailStops) d = Math.min(d, v.angleTo(p)); return d; };
  const tileDir = new Float32Array(COUNT * 3), tileAng = new Float32Array(COUNT);   // centre, and width in radians
  // Cell corners, counter-clockwise seen from outside: tile g's are cornerStart[g] up to cornerStart[g + 1].
  let cornerStart, corner;

  // Heights are worked out on the GPU. Vertices sit on the unit sphere with a flag for top or base, and the vertex
  // shader pushes top vertices out by the tile's height from per-tile data and a few uniforms, so zooming and
  // loading detail cost no CPU. Hidden tiles drop just inside the core sphere.
  const heightUniforms = {
    uM: { value: 0 }, uP: { value: 0 },
    uOcean: { value: new THREE.Vector2(T.oceanThicknessKm.globe, T.oceanThicknessKm.closeUp) },
    uBase: { value: new THREE.Vector2(T.landBaseKm.globe, T.landBaseKm.closeUp) },
    uExag: { value: new THREE.Vector2(T.verticalExaggeration.globe, T.verticalExaggeration.closeUp) },
  };
  function heightMaterial(isDetail) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, heightUniforms);
      sh.vertexShader = sh.vertexShader.replace("#include <common>", `#include <common>
        attribute vec4 aInfo;   // x: elevation (km), y: land + 2 if detail tiles replace this one, z: wave delay 0..1, w: 1 on top
        uniform float uM, uP;
        uniform vec2 uOcean, uBase, uExag;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        float wave = clamp(uP * 1.6 - aInfo.z * 0.6, 0.0, 1.0);
        float land = mod(aInfo.y, 2.0), replaced = step(1.5, aInfo.y);
        ${isDetail
          ? "float mm = 1.0; float lift = wave * wave * (3.0 - 2.0 * wave); float base = mix(0.99, 1.0, lift);"
          : "float mm = uM; float lift = 1.0 - replaced * step(0.35, wave); float base = mix(0.99, 1.0, lift);"}
        float km = mix(uOcean.x, uOcean.y, mm) + land * max(0.0, mix(uBase.x, uBase.y, mm) + aInfo.x * mix(uExag.x, uExag.y, mm));
        transformed *= base + aInfo.w * km / ${EARTH_KM.toFixed(1)} * lift;`);
    };
    mat.customProgramCacheKey = () => isDetail ? "cells-detail" : "cells-globe";
    return mat;
  }
  const tileMat = heightMaterial(false);
  const xAxis = new THREE.Vector3(), yAxis = new THREE.Vector3();
  const hash = i => { let x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x); };
  const cubeToSphere = (f, a, b, out = new THREE.Vector3()) => {
    const u = Math.tan(a * Math.PI / 4), v = Math.tan(b * Math.PI / 4);
    return out.copy(f[0]).addScaledVector(f[1], u).addScaledVector(f[2], v).normalize();
  };
  // Scratch vectors so the tile build allocates nothing per tile.
  const cs = new THREE.Vector3(), dir = new THREE.Vector3();
  const isLandDir = v => isLand(Math.asin(Math.max(-1, Math.min(1, v.y))) / D, Math.atan2(-v.z, v.x) / D);
  const OFFS = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
  // Land where most of five samples (the centre counted twice, four around it) are land.
  function classify(g, ang) {
    const lat = Math.asin(Math.max(-1, Math.min(1, dir.y))) / D, lon = Math.atan2(-dir.z, dir.x) / D;
    xAxis.set(-dir.z, 0, dir.x); if (xAxis.lengthSq() < 1e-9) xAxis.set(1, 0, 0);
    xAxis.normalize(); yAxis.crossVectors(dir, xAxis);
    const e = ang * 0.3;
    let votes = isLand(lat, lon) * 2;
    for (const o of OFFS) votes += isLandDir(cs.copy(dir).addScaledVector(xAxis, o[0] * e).addScaledVector(yAxis, o[1] * e).normalize());
    const land = votes >= 3, ice = land && (lat > T.iceLatitude.north || lat < T.iceLatitude.south);
    tileKind[g] = ice ? 2 : land ? 1 : 0;
    tileTone[g] = hash(g + 1);
    tileElev[g] = land ? elevAt(lat, lon, ang / 2 / D) : 0;
    tileAng[g] = ang;
    dir.toArray(tileDir, g * 3);
    let near = 0;   // within REACH of a detail stop: compare dot products against cos(REACH), no acos per tile
    for (const p of detailStops) if (dir.dot(p) > COS_REACH) { near = 1; break; }
    tileBay[g] = near;
  }
  if (HEX) {
    ({ cornerStart, corner } = HEXG);
    for (let g = 0; g < COUNT; g++) { dir.fromArray(HEXG.dir, g * 3); classify(g, HEXG.spacing[g]); }
  } else {
    cornerStart = new Int32Array(COUNT + 1); corner = new Float32Array(COUNT * 12);
    let g = 0;
    FACES.forEach(f => {
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++, g++) {
        const a0 = i / N * 2 - 1, b0 = j / N * 2 - 1, h = 2 / N;
        cubeToSphere(f, a0 + h / 2, b0 + h / 2, dir);
        classify(g, TOP_ANG);
        cornerStart[g] = g * 4;
        [[a0, b0], [a0 + h, b0], [a0 + h, b0 + h], [a0, b0 + h]].forEach(([a, b], k) => cubeToSphere(f, a, b, cs).toArray(corner, (g * 4 + k) * 3));
      }
    });
    cornerStart[COUNT] = COUNT * 4;
  }

  // One mesh's geometry from a list of tiles: each tile's top, and its walls where they can be seen. Ocean is
  // the lowest ground and all of one height, so with no gap an ocean tile's walls are always hidden and skipped
  // (drawing them anyway makes their top edges flicker along the seams). Land tiles, and every tile when there's
  // a gap, get walls.
  const MAXC = 16, ring = Array.from({ length: MAXC }, () => new THREE.Vector3());
  const ev = new THREE.Vector3(), wn = new THREE.Vector3();
  function tileGeometry(ids, S) {
    const walls = k => GAP > 0 || S.land[k];
    let nv = 0, ni = 0;
    const wallAt = c => !(S.noWall && S.noWall[c]);
    for (const k of ids) {
      const c0 = S.cornerStart[k], m = S.cornerStart[k + 1] - c0;
      nv += m; ni += (m - 2) * 3;
      if (walls(k)) for (let j = 0; j < m; j++) if (wallAt(c0 + j)) { nv += 4; ni += 6; }
    }
    const pos = new Float32Array(nv * 3), nor = new Int8Array(nv * 3), info = new Float32Array(nv * 4);
    const col = new Uint16Array(nv * 3), index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    const vStart = new Int32Array(ids.length + 1);
    let v = 0, i = 0, el = 0, flags = 0, dl = 0;
    const put = (p, nx, ny, nz, top) => {
      pos[v * 3] = p.x; pos[v * 3 + 1] = p.y; pos[v * 3 + 2] = p.z;
      nor[v * 3] = Math.round(nx * 127); nor[v * 3 + 1] = Math.round(ny * 127); nor[v * 3 + 2] = Math.round(nz * 127);
      info[v * 4] = el; info[v * 4 + 1] = flags; info[v * 4 + 2] = dl; info[v * 4 + 3] = top;
      v++;
    };
    ids.forEach((k, n) => {
      vStart[n] = v;
      const c0 = S.cornerStart[k], m = Math.min(MAXC, S.cornerStart[k + 1] - c0);
      dir.fromArray(S.dir, k * 3);
      const f = S.shrunk && S.shrunk[k] ? 1 : 1 - GAP;   // hex detail pieces arrive with the gap already taken
      for (let j = 0; j < m; j++) ring[j].fromArray(S.corner, (c0 + j) * 3).sub(dir).multiplyScalar(f).add(dir).normalize();
      el = S.elev[k]; flags = S.land[k] + 2 * S.bay[k]; dl = S.delay[k];
      const t0 = v;
      for (let j = 0; j < m; j++) put(ring[j], dir.x, dir.y, dir.z, 1);
      for (let j = 1; j < m - 1; j++) { index[i++] = t0; index[i++] = t0 + j; index[i++] = t0 + j + 1; }
      if (walls(k)) for (let j = 0; j < m; j++) {
        if (!wallAt(c0 + j)) continue;
        const a = ring[j], b = ring[(j + 1) % m];
        ev.subVectors(b, a); wn.addVectors(a, b); wn.crossVectors(ev, wn).normalize();   // outward: edge x up
        const w0 = v;
        put(a, wn.x, wn.y, wn.z, 0); put(b, wn.x, wn.y, wn.z, 0); put(b, wn.x, wn.y, wn.z, 1); put(a, wn.x, wn.y, wn.z, 1);
        index[i++] = w0; index[i++] = w0 + 1; index[i++] = w0 + 2; index[i++] = w0; index[i++] = w0 + 2; index[i++] = w0 + 3;
      }
    });
    vStart[ids.length] = v;
    // Once on the GPU, the arrays are freed. Colours are rebuilt when the theme changes; wave timing is kept only
    // where detail replaces tiles, since only those tiles' timing ever changes.
    const free = function () { this.array = null; };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).onUpload(free));
    geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3, true).onUpload(free));
    const colAttr = new THREE.BufferAttribute(col, 3, true).onUpload(free);
    geo.setAttribute("color", colAttr);
    const infoAttr = new THREE.BufferAttribute(info, 4);
    if (!ids.some(k => S.bay[k] || S.keepInfo)) infoAttr.onUpload(free);
    geo.setAttribute("aInfo", infoAttr);
    geo.setIndex(new THREE.BufferAttribute(index, 1).onUpload(free));
    return { geo, vStart, nv: v, infoAttr, colAttr };
  }
  // Colour, and wave delay, for one tile's vertices. A freed colour array is made again for a repaint.
  function paintTile(M, n, c) {
    const col = M.colAttr.array || (M.colAttr.array = new Uint16Array(M.nv * 3));
    const r = Math.round(c.r * 65535), g = Math.round(c.g * 65535), b = Math.round(c.b * 65535);
    for (let v = M.vStart[n]; v < M.vStart[n + 1]; v++) { col[v * 3] = r; col[v * 3 + 1] = g; col[v * 3 + 2] = b; }
  }
  function delayTile(M, n, d) { const info = M.infoAttr.array; for (let v = M.vStart[n]; v < M.vStart[n + 1]; v++) info[v * 4 + 2] = d; }

  // Tiles are drawn in blocks, the tiles whose centres fall in one patch of a cube face split 6 x 6, so blocks
  // beyond the horizon or outside the view are skipped entirely. Each block knows its tallest tile, so flat ocean
  // blocks are dropped right at the horizon while mountain blocks stay until their peaks have set.
  const K = 6, chunks = [];
  const blockLists = Array.from({ length: 6 * K * K }, () => []);
  for (let g = 0; g < COUNT; g++) {
    const x = tileDir[g * 3], y = tileDir[g * 3 + 1], z = tileDir[g * 3 + 2];
    let fi = 0, best = -2;
    for (let k = 0; k < 6; k++) { const d = FACES[k][0].x * x + FACES[k][0].y * y + FACES[k][0].z * z; if (d > best) { best = d; fi = k; } }
    const f = FACES[fi];
    const a = Math.atan((f[1].x * x + f[1].y * y + f[1].z * z) / best) * 4 / Math.PI;
    const b = Math.atan((f[2].x * x + f[2].y * y + f[2].z * z) / best) * 4 / Math.PI;
    const ci = Math.min(K - 1, Math.max(0, Math.floor((a + 1) / 2 * K))), cj = Math.min(K - 1, Math.max(0, Math.floor((b + 1) / 2 * K)));
    blockLists[(fi * K + ci) * K + cj].push(g);
  }
  const globeTiles = { dir: tileDir, cornerStart: null, corner: null, elev: tileElev, delay: tileDelay,
    land: Uint8Array.from(tileKind, k => k > 0 ? 1 : 0), bay: tileBay };
  globeTiles.cornerStart = cornerStart; globeTiles.corner = corner;
  for (const idx of blockLists) {
    if (!idx.length) continue;
    const M = tileGeometry(idx, globeTiles), mesh = new THREE.Mesh(M.geo, tileMat);
    const center = new THREE.Vector3();
    let minDot = 1, widest = 0, land = false, peak = 0;
    for (const g of idx) { center.x += tileDir[g * 3]; center.y += tileDir[g * 3 + 1]; center.z += tileDir[g * 3 + 2]; }
    center.normalize();
    for (const g of idx) {
      minDot = Math.min(minDot, center.x * tileDir[g * 3] + center.y * tileDir[g * 3 + 1] + center.z * tileDir[g * 3 + 2]);
      widest = Math.max(widest, tileAng[g]);
      if (tileKind[g] > 0) { land = true; peak = Math.max(peak, tileElev[g]); }
    }
    const radius = Math.acos(Math.max(-1, Math.min(1, minDot))) + widest;
    // Bounds for three.js frustum culling: the block's cap of the sphere, plus room for the tallest tiles.
    M.geo.boundingSphere = new THREE.Sphere(center.clone(), 2 * Math.sin(radius / 2) + 0.07);
    mesh.frustumCulled = true;
    scene.add(mesh);
    const bayAt = [];
    idx.forEach((g, n) => { if (tileBay[g]) bayAt.push(n); });
    chunks.push({ mesh, M, idx: Int32Array.from(idx), center, radius, land, peak, bayAt });
  }

  // Level of detail. Every globe tile near a detail stop is split, again and again, until tiles are small near the
  // stops and grow with distance from them. Squares split into quarters along the cube grid. Hexagons split into
  // seven: a centre and a ring of six, sqrt(7) smaller and turned by atan(sqrt(3) / 5), each clipped to the parent,
  // which is how a finer hex grid sits inside a coarser one. Either way the pieces fill their parent exactly, so
  // tiles of different sizes meet without cracks.
  for (const g of REGIONS) {
    g.SW = g.w + 1; g.sat = new Float32Array(g.SW * (g.h + 1));
    for (let r = 0; r < g.h; r++) for (let c = 0; c < g.w; c++)
      g.sat[(r + 1) * g.SW + c + 1] = g.mask[r * g.w + c] + g.sat[r * g.SW + c + 1] + g.sat[(r + 1) * g.SW + c] - g.sat[r * g.SW + c];
  }
  // Share of land in a box around a point: from a region's fine mask when the box is inside it, else the globe mask.
  function coarseFrac(lat, lon, halfDeg) {
    const hc = halfDeg / Math.cos(lat * D);
    const r0 = Math.floor((90 - lat - halfDeg) * 2), r1 = Math.max(r0, Math.floor((90 - lat + halfDeg) * 2 - 1e-9));
    const c0 = Math.floor((lon + 180 - hc) * 2), c1 = Math.max(c0, Math.floor((lon + 180 + hc) * 2 - 1e-9));
    let sum = 0, n = 0;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      sum += mask[Math.min(MH - 1, Math.max(0, r)) * MW + ((c % MW) + MW) % MW]; n++;
    }
    return sum / n;
  }
  function landFrac(lat, lon, halfDeg) {
    const g = regionAt(lat, lon, halfDeg);
    if (!g) return coarseFrac(lat, lon, halfDeg);
    const r = (g.lat1 - lat) / g.step, c = (lon - g.lon0) / g.step;
    const hr = Math.max(0.5, halfDeg / g.step), hc = Math.max(0.5, halfDeg / Math.cos(lat * D) / g.step);
    const r0 = Math.max(0, Math.round(r - hr)), r1 = Math.min(g.h, Math.max(r0 + 1, Math.round(r + hr)));
    const c0 = Math.max(0, Math.round(c - hc)), c1 = Math.min(g.w, Math.max(c0 + 1, Math.round(c + hc)));
    if (r0 >= g.h || c0 >= g.w || r1 <= 0 || c1 <= 0) return 0;
    const sum = g.sat[r1 * g.SW + c1] - g.sat[r0 * g.SW + c1] - g.sat[r1 * g.SW + c0] + g.sat[r0 * g.SW + c0];
    return sum / ((r1 - r0) * (c1 - c0));
  }
  // Finest tile: a little over the finest region's cell size. Elsewhere tile size <= RATIO x distance.
  const MIN_TILE = Math.min(...REGIONS.map(g => g.step * D * 1.1), Infinity);
  // Detail tiles are built on first need: in idle time after the first frame, or on arrival at a detail stop.
  let DT = null;
  function buildDetail() {
    if (DT) return DT;
    const L = { dir: [], cornerStart: [0], corner: [], elev: [], land: [], bay: [], delay: [], kind: [], tone: [], parent: [], shrunk: [], cell: [] };
    function emit(c, pts, ang, parent, tone = hash(L.tone.length + 7919), shrunk = 0, cell = -1 - L.tone.length) {
      const lat = Math.asin(Math.max(-1, Math.min(1, c.y))) / D, lon = Math.atan2(-c.z, c.x) / D;
      const land = landFrac(lat, lon, ang / 2 / D) >= 0.5;
      L.dir.push(c.x, c.y, c.z);
      for (const p of pts) L.corner.push(p.x, p.y, p.z);
      L.cornerStart.push(L.corner.length / 3);
      L.land.push(land ? 1 : 0); L.kind.push(land ? 1 : 0); L.bay.push(0); L.delay.push(tileDelay[parent]);
      L.tone.push(tone); L.parent.push(parent); L.shrunk.push(shrunk); L.cell.push(cell);
      L.elev.push(land ? elevAt(lat, lon, ang / 2 / D) : 0);
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
    // Hexagons don't nest, so hex detail comes from regular hex grids in the plane touching the sphere at each
    // region's centre (a gnomonic projection, where great circles are straight lines). Level k has spacing
    // TOP_ANG / 2^k and all levels share one origin. A split globe tile is covered by level-1 hexagons clipped to
    // its outline; those still too big are covered by level-2 hexagons clipped to theirs, and so on. Pieces of one
    // hexagon in different parents get the same height and colour, and the gap is taken from the whole hexagon
    // before clipping, so they read as one tile. Together the pieces fill each parent exactly.
    const anchors = [];
    for (const g of REGIONS) {
      const ps = STOPS.filter(st => regionOf(st) === g).map(st => vecFromLatLon(st.lat, st.lon));
      if (!ps.length) continue;
      const A = ps.reduce((m, p) => m.add(p), new THREE.Vector3()).normalize();
      const e1 = new THREE.Vector3(-A.z, 0, A.x).normalize(), e2 = new THREE.Vector3().crossVectors(A, e1);
      anchors.push({ A, e1, e2 });
    }
    const toPlane = (P, v) => { const k = 1 / v.dot(P.A); return [v.dot(P.e1) * k, v.dot(P.e2) * k]; };
    const toSphere = (P, q) => P.A.clone().addScaledVector(P.e1, q[0]).addScaledVector(P.e2, q[1]).normalize();
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
        for (const u of HEX6) { const v = d + r * (ux * u[1] - uy * u[0]); lo = Math.min(lo, v); hi = Math.max(hi, v); }
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
          const out = GAP > 0 ? (where === 1 ? hexAt(cx, cy, r * (1 - GAP)) : clipTo(hexAt(cx, cy, r * (1 - GAP)), region)) : piece;
          if (out.length < 3 || area(out) < tiny) continue;
          emit(c, out.map(q => toSphere(P, q)), sp, parent, hash(k * 1009 + i * 7919 + j * 104729), 1, (k * 1e5 + i + 5e4) * 1e5 + j + 5e4);
        }
    }
    for (let idx = 0; idx < COUNT; idx++) {
      if (!tileBay[idx]) continue;
      if (HEX) {
        const c = new THREE.Vector3().fromArray(tileDir, idx * 3), pts = [];
        for (let j = cornerStart[idx]; j < cornerStart[idx + 1]; j++) pts.push(new THREE.Vector3().fromArray(corner, j * 3));
        const P = anchors.reduce((b, a) => a.A.dot(c) > b.A.dot(c) ? a : b);
        if (wantSplit(c, tileAng[idx], tileAng[idx] / 2)) refine(P, pts.map(v => toPlane(P, v)), 1, idx);
        else emit(c, pts, tileAng[idx], idx);
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
    const S = { dir: Float32Array.from(L.dir), cornerStart: Int32Array.from(L.cornerStart), corner: Float32Array.from(L.corner),
      elev: L.elev, land: L.land, bay: L.bay, delay: L.delay, shrunk: L.shrunk, noWall, keepInfo: true };
    const ids = Array.from({ length: count }, (_, k) => k);
    const M = tileGeometry(ids, S);
    const mesh = new THREE.Mesh(M.geo, heightMaterial(true));
    mesh.visible = false;
    mesh.renderOrder = -1;   // nearest to the camera when shown, so draw it first
    const center = new THREE.Vector3(), p = new THREE.Vector3();
    for (let k = 0; k < count; k++) center.add(p.fromArray(S.dir, k * 3));
    center.normalize();
    let radius = 0;
    for (let k = 0; k < count; k++) radius = Math.max(radius, center.angleTo(p.fromArray(S.dir, k * 3)));
    M.geo.boundingSphere = new THREE.Sphere(center, 2 * Math.sin(radius / 2) + 0.07);
    DT = { mesh, M, count, parent: Int32Array.from(L.parent), kind: Uint8Array.from(L.kind),
      tone: Float32Array.from(L.tone), elev: Float32Array.from(L.elev) };
    paintDetail();
    scene.add(mesh);
    needsRender = true;
    return DT;
  }
  // A globe tile and the pieces that replace it share one clock, so the swap never leaves a hole.
  function setDetailFocus(dir) {
    const f = new THREE.Vector3(), cap = 0.06;
    for (let i = 0; i < COUNT; i++) if (tileBay[i]) tileDelay[i] = Math.min(1, f.fromArray(tileDir, i * 3).angleTo(dir) / cap);
    for (const ch of chunks) if (ch.bayAt.length) {
      for (const n of ch.bayAt) delayTile(ch.M, n, tileDelay[ch.idx[n]]);
      ch.M.infoAttr.needsUpdate = true;
    }
    if (DT) {
      for (let i = 0; i < DT.count; i++) delayTile(DT.M, i, tileDelay[DT.parent[i]]);
      DT.M.infoAttr.needsUpdate = true;
    }
  }
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.999, 64, 48), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  core.renderOrder = 1000;
  scene.add(core);
  // Atmosphere: a faint halo just outside the globe's edge. It fades out in close-ups, where the camera sits inside it.
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 40), new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color() }, strength: { value: 1 } },
    vertexShader: `varying vec3 vN;
      void main() { vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 color; uniform float strength; varying vec3 vN;
      void main() { float i = pow(max(0.0, 0.62 + vN.z), 4.0); gl_FragColor = vec4(color, clamp(i * 1.4, 0.0, 0.7) * strength); }`,
    side: THREE.BackSide, transparent: true, depthWrite: false,
  }));
  atmo.scale.setScalar(1.06);
  scene.add(atmo);

  // Markers
  const markerGroup = new THREE.Group(); scene.add(markerGroup);
  const pinMat = new THREE.MeshLambertMaterial({ color: 0x000000 });
  const accentMat = new THREE.MeshLambertMaterial({ color: 0x000000 });
  const inkMat = new THREE.MeshLambertMaterial({ color: 0x000000 });
  const labelsEl = document.getElementById("labels");
  const markers = STOPS.map(s => {
    const dir = vecFromLatLon(s.lat, s.lon);
    const holder = new THREE.Group();
    holder.position.copy(dir);
    holder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    const H = 0.07;
    const pin = new THREE.Mesh(new THREE.BoxGeometry(0.0035, 0.0035, H), pinMat);
    pin.position.z = H / 2;
    const diamond = shapeOf(s) === "diamond";
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.018), diamond ? inkMat : accentMat);
    head.position.z = H;
    if (diamond) head.rotation.set(Math.PI / 4, Math.PI / 4, 0);
    holder.add(pin, head);
    markerGroup.add(holder);
    const label = document.createElement("div");
    label.className = "label";
    label.textContent = s.title;
    labelsEl.appendChild(label);
    const region = regionOf(s);
    return { s, dir, holder, head, label, H, top: new THREE.Vector3(), scale: 1, region,
      land: landFrac(s.lat, s.lon, 0.006) >= 0.5, elev: elevPoint(s.lat, s.lon) };
  });

  // Pins that land within a few pixels of each other on screen merge into one pin whose head shows the count.
  // The current stop never merges. A pool keyed by member ids lets groups fade in and out.
  const clusters = new Map();
  // The count is built like the globe: raised blocks on a 5 × 7 grid, in the accent's ink, standing on an accent plate.
  const digitMat = new THREE.MeshLambertMaterial({ color: 0x000000 });
  const DIGITS = ["01110100011001110101110011000101110", "00100011000010000100001000010001110",
    "01110100010000100010001000100011111", "11111000100010000010000011000101110",
    "00010001100101010010111110001000010", "11111100001111000001000011000101110",
    "00110010001000011110100011000101110", "11111000010001000100010000100001000",
    "01110100011000101110100011000101110", "01110100011000101111000010001001100"];
  const CELL = 0.0042, PLATE = 0.006, RAISE = 0.004;
  function countHead(n) {
    const text = String(n), cols = text.length * 6 - 1;
    const cells = [];
    [...text].forEach((d, k) => {
      const bits = DIGITS[+d];
      for (let r = 0; r < 7; r++) for (let q = 0; q < 5; q++) if (bits[r * 5 + q] === "1") cells.push([k * 6 + q, r]);
    });
    const head = new THREE.Group();
    const plate = new THREE.Mesh(new THREE.BoxGeometry((cols + 2.4) * CELL, 9.4 * CELL, PLATE), accentMat);
    plate.position.z = PLATE / 2;
    const px = new THREE.InstancedMesh(new THREE.BoxGeometry(CELL * 0.94, CELL * 0.94, RAISE), digitMat, cells.length);
    const m = new THREE.Matrix4();
    // Row 0 is the top of the digit, on the plate's north side, which is up on screen.
    cells.forEach(([q, r], i) => px.setMatrixAt(i, m.makeTranslation((q - (cols - 1) / 2) * CELL, (3 - r) * CELL, PLATE + RAISE / 2)));
    head.add(plate, px);
    return { head, plate };
  }
  function clusterFor(key, members) {
    let c = clusters.get(key);
    if (c) return c;
    const holder = new THREE.Group();
    const H = 0.07;
    const pin = new THREE.Mesh(new THREE.BoxGeometry(0.0035, 0.0035, H), pinMat);
    pin.position.z = H / 2;
    const { head, plate } = countHead(members.length);
    head.position.z = H;
    holder.add(pin, head);
    markerGroup.add(holder);
    c = { holder, head: plate, H, vis: 0, dir: new THREE.Vector3(), top: new THREE.Vector3(), base: 1, members };
    clusters.set(key, c);
    return c;
  }
  const east0 = new THREE.Vector3(), north0 = new THREE.Vector3(), frame0 = new THREE.Matrix4();
  // Tapping a pin at the top of the page goes to its stop, or to the first stop in a group.
  const ray = new THREE.Raycaster(), tap = { x: 0, y: 0, t: 0 };
  canvas.addEventListener("pointerdown", e => { tap.x = e.clientX; tap.y = e.clientY; tap.t = performance.now(); });
  canvas.addEventListener("pointerup", e => {
    if (ALL[active] !== INTRO || performance.now() - tap.t > 350 || Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 6) return;
    ray.setFromCamera({ x: e.clientX / W * 2 - 1, y: -(e.clientY / Hh) * 2 + 1 }, camera);
    const targets = [...[...clusters.values()].filter(c => c.vis > 0.5).map(c => ({ obj: c.head, stop: c.members[0].s })),
      ...markers.filter(m => m.vis > 0.5).map(m => ({ obj: m.head, stop: m.s }))];
    const hit = ray.intersectObjects(targets.map(t => t.obj), false)[0];
    if (hit) goTo(ALL.indexOf(targets.find(t => t.obj === hit.object).stop));
  });

  // Trail between school/work stops, in order
  const trailMat = new THREE.LineDashedMaterial({ color: 0x000000, dashSize: 0.012, gapSize: 0.008, transparent: true, opacity: 0.9 });
  const route = STOPS.filter(s => KINDS[s.kind].onRoute);
  for (let i = 0; i + 1 < route.length; i++) {
    const A = vecFromLatLon(route[i].lat, route[i].lon), B = vecFromLatLon(route[i + 1].lat, route[i + 1].lon);
    const ang = A.angleTo(B), pts = [];
    const qq = new THREE.Quaternion().setFromUnitVectors(A, B), id = new THREE.Quaternion(), tmp = new THREE.Quaternion();
    for (let k = 0; k <= 64; k++) {
      const t = k / 64;
      tmp.copy(id).slerp(qq, t);
      pts.push(A.clone().applyQuaternion(tmp).multiplyScalar(1.03 + Math.sin(Math.PI * t) * Math.max(0.01, ang * 0.35)));
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), trailMat);
    line.computeLineDistances();
    scene.add(line);
  }

  // Theme colors
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const lin = n => new THREE.Color(css(n)).convertSRGBToLinear();
  let palette = null;
  function paintDetail() {
    if (!DT || !palette) return;
    const c = new THREE.Color();
    for (let i = 0; i < DT.count; i++) {
      const t = DT.tone[i];
      if (DT.kind[i]) palette.landColor(c, DT.elev[i], t); else c.copy(palette.ocean).lerp(palette.ocean2, t * 0.5);
      paintTile(DT.M, i, c);
    }
    DT.M.colAttr.needsUpdate = true;
  }
  function applyTheme() {
    const ocean = lin("--g-ocean"), ocean2 = lin("--g-ocean2");
    const land = lin("--g-land"), land2 = lin("--g-land2");
    const snow = lin("--g-snow"), c = new THREE.Color();
    // Low land takes --g-land, higher land --g-land2, and only the highest ground (above 5 km) pales toward --g-snow.
    const landColor = (out, km, t) => {
      out.copy(land).lerp(land2, Math.max(0, Math.min(1, km / 2 + (t - 0.5) * 0.2)));
      if (km > 5) out.lerp(snow, Math.min(0.6, (km - 5) / 1.5));
      return out;
    };
    for (const ch of chunks) {
      for (let k = 0; k < ch.idx.length; k++) {
        const i = ch.idx[k], kind = tileKind[i], t = tileTone[i];
        if (kind === 0) c.copy(ocean).lerp(ocean2, t);
        else if (kind === 1) landColor(c, tileElev[i], t);
        else c.copy(snow).lerp(land2, t * 0.08);
        paintTile(ch.M, k, c);
      }
      ch.M.colAttr.needsUpdate = true;
    }
    palette = { ocean, ocean2, landColor };
    paintDetail();
    renderer.setClearColor(new THREE.Color(css("--bg")), 1);   // the canvas is opaque; match the page
    core.material.color.copy(lin("--g-core"));
    pinMat.color.copy(lin("--g-pin"));
    inkMat.color.copy(lin("--g-pin"));
    accentMat.color.copy(lin("--accent"));
    trailMat.color.copy(lin("--g-trail"));
    atmo.material.uniforms.color.value.copy(lin("--g-atmo"));
    digitMat.color.copy(lin("--accent-ink"));
    needsRender = true;
  }
  applyTheme();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
  new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  // Layout
  let W = 0, Hh = 0, layout = "wide";
  function resize() {
    const nw = canvas.clientWidth || innerWidth, nh = canvas.clientHeight || innerHeight;
    if (nw === W && nh === Hh) return;
    W = nw; Hh = nh;
    renderer.setSize(W, Hh, false);
    camera.aspect = W / Hh;
    layout = W >= 1100 ? "wide" : W >= 700 ? "mid" : "narrow";
    if (layout === "mid") camera.setViewOffset(W, Hh, -W * 0.2, 0, W, Hh);
    else if (layout === "narrow") camera.setViewOffset(W, Hh, 0, Hh * 0.2, W, Hh);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    needsRender = true;
    if (started) renderer.render(scene, camera);   // resizing clears the canvas; never show it blank
  }
  let started = false;
  addEventListener("resize", resize);
  resize();

  // Camera: look at a point on the globe from slightly south of it, pulled back during long moves.
  const cur = { dir: vecFromLatLon(INTRO.lat, INTRO.lon), logAlt: Math.log(INTRO.dist - 1), dist: INTRO.dist };
  let detailP = 0, lastM = 0, lastDetail = -1, detailOn = false;
  let spin = 0, userLat = 0;
  // Drag and zoom the globe while the intro is on screen.
  const drag = { on: false, id: null, x: 0, y: 0, t: 0, vLon: 0, vLat: 0, lastMove: -1e9 };
  const pz = zoomGestures(canvas, () => ALL[active] === INTRO, () => document.querySelector("#intro .card"));
  canvas.addEventListener("pointerdown", e => {
    if (ALL[active] !== INTRO) return;
    if (pz.pinching) { drag.on = false; drag.vLon = drag.vLat = 0; drag.lastMove = performance.now(); return; }
    drag.on = true; drag.id = e.pointerId; drag.x = e.clientX; drag.y = e.clientY; drag.t = performance.now();
    drag.vLon = drag.vLat = 0;
    canvas.setPointerCapture(e.pointerId);
    document.documentElement.classList.add("dragging");
  });
  canvas.addEventListener("pointermove", e => {
    if (!drag.on || e.pointerId !== drag.id || pz.pinching) return;
    const now = performance.now(), dtm = Math.max(1, now - drag.t) / 1000;
    // Degrees per pixel from the globe's radius on screen, so the surface moves a little slower than the pointer.
    const radiusPx = (Hh / 2) / (Math.tan(camera.fov * D / 2) * Math.sqrt(Math.max(0.2, cur.dist * cur.dist - 1)));
    const dpp = G.camera.dragSpeed * (180 / Math.PI) / radiusPx;
    const dLon = -(e.clientX - drag.x) * dpp, dLat = (e.clientY - drag.y) * dpp;
    spin += dLon; userLat += dLat;
    const cap = v => Math.max(-40, Math.min(40, v));
    drag.vLon = cap(drag.vLon * 0.7 + (dLon / dtm) * 0.3); drag.vLat = cap(drag.vLat * 0.7 + (dLat / dtm) * 0.3);
    drag.x = e.clientX; drag.y = e.clientY; drag.t = now; drag.lastMove = now;
  });
  const endDrag = e => {
    if (!drag.on || e.pointerId !== drag.id) return;
    drag.on = false; drag.lastMove = performance.now();
    if (performance.now() - drag.t > 80) drag.vLon = drag.vLat = 0;
    document.documentElement.classList.remove("dragging");
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  const tgtDir = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), scratchV = new THREE.Vector3(), camN = new THREE.Vector3();
  const east = new THREE.Vector3(), north = new THREE.Vector3(), camDir = new THREE.Vector3(), look = new THREE.Vector3();
  const qStep = new THREE.Quaternion(), qId = new THREE.Quaternion(), qFull = new THREE.Quaternion();
  const proj = new THREE.Vector3();
  window.onStopChange = () => {};
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  let last = null;
  let sleeping3D = false;
  function frame(now) {
    if (MODE !== "3d") { sleeping3D = true; return; }
    const dt = last === null ? 0 : Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
    const stop = ALL[active];
    const still = reduceMotion.matches;
    const overview = stop === INTRO;
    if (overview !== wasOverview) { document.documentElement.classList.toggle("can-drag", overview); wasOverview = overview; syncScrollZone(); }
    if (overview) {
      if (!drag.on) {
        // Coast after a flick, then resume the slow spin once the globe has been left alone.
        spin += drag.vLon * dt; userLat += drag.vLat * dt;
        drag.vLon *= Math.pow(0.05, dt); drag.vLat *= Math.pow(0.05, dt);
        if (!still && now - drag.lastMove > 2500) spin += dt * G.camera.idleSpinDegPerSec;
      }
      userLat = Math.max(-55, Math.min(50, userLat));
    } else {
      spin *= Math.pow(0.1, dt); userLat *= Math.pow(0.1, dt); pz.log *= Math.pow(0.1, dt);
      drag.vLon = drag.vLat = 0;
    }
    {
      const la = (stop.lat + userLat) * D, lo = (stop.lon + spin) * D;
      tgtDir.set(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo));
    }
    const ang = cur.dir.angleTo(tgtDir);
    const k = still ? 1 : 1 - Math.exp(-dt * (overview && now - drag.lastMove < 2500 ? 7 : 2.4));
    if (ang > 1e-5) {
      qFull.setFromUnitVectors(cur.dir, tgtDir);
      qStep.copy(qId).slerp(qFull, k);
      cur.dir.applyQuaternion(qStep).normalize();
    }
    // Altitude eases in log space so a zoom from orbit to street level feels even; long moves pull back first.
    const narrowBoost = camera.aspect < 1 ? 1 + (1 - camera.aspect) * 1.1 * smooth(0.6, 2.2, stop.dist - 1) : 1;
    const baseLog = Math.log((stop.dist - 1) * narrowBoost) + pz.log;
    const tLog = Math.min(baseLog + (still ? 0 : Math.min(2.6, ang * 5)), Math.max(baseLog, Math.log(2.6)));
    const kz = still ? 1 : 1 - Math.exp(-dt * 8);   // zoom follows the fingers closely
    cur.logAlt += (tLog - cur.logAlt) * (overview && Math.abs(pz.log) > 1e-4 ? Math.max(k, kz) : k);
    // Hold the camera above the tallest tiles until the globe has flattened for the close-up.
    cur.logAlt = Math.max(cur.logAlt, Math.log((heightOf(true, MAX_ELEV, lastM) + 0.0022) / 0.8));
    const alt = Math.exp(cur.logAlt);
    cur.dist = 1 + alt;

    // Camera sits above and south of the focus point; far out it frames the whole globe instead.
    const zoom = smooth(2.4, 1.2, alt);        // 0 frames the whole globe, 1 aims at the stop itself
    east.crossVectors(up, cur.dir);
    if (east.lengthSq() < 1e-6) east.set(1, 0, 0);
    east.normalize();
    north.crossVectors(cur.dir, east).normalize();
    const tilt = G.camera.closeTiltDeg * D * smooth(1.6, 0.3, alt);
    look.copy(cur.dir).multiplyScalar(zoom);
    camDir.copy(cur.dir).multiplyScalar(Math.cos(tilt)).addScaledVector(north, -Math.sin(tilt));
    camera.position.copy(camDir).multiplyScalar(cur.dist - zoom).add(look);
    camera.up.copy(north);
    camera.lookAt(look);
    camera.near = Math.max(0.00004, alt * 0.05);
    camera.far = cur.dist + 2;
    camera.updateProjectionMatrix();

    // Load the Bay Area detail when the camera is close over it.
    const stopRegion = stop === INTRO ? null : regionOf(stop);
    const wantDetail = !!stopRegion && alt < G.detail.loadBelowAltitudeKm / EARTH_KM;
    if (wantDetail && !DT) buildDetail();
    if (wantDetail && !detailOn && detailP === 0) setDetailFocus(tgtDir);
    detailOn = wantDetail;
    const wave = G.detail.waveSeconds;
    detailP = still ? (wantDetail ? 1 : 0) : Math.max(0, Math.min(1, detailP + (wantDetail ? dt / wave : -dt / (wave / 2))));
    const m = smooth(0, 0.3, detailP);
    heightUniforms.uM.value = lastM = m;
    heightUniforms.uP.value = lastDetail = detailP;
    if (DT) DT.mesh.visible = detailP > 0 && DT.count > 0;
    trailMat.opacity = 0.9 * smooth(0.03, 0.12, alt);
    trailMat.visible = trailMat.opacity > 0.01;
    atmo.material.uniforms.strength.value = smooth(0.25, 0.9, alt);
    atmo.visible = alt > 0.25;

    // Blocks: skip those beyond the horizon, and draw the rest nearest first so hidden pixels are rejected early.
    camN.copy(camera.position).normalize();
    // A point at height h is in sight while its angle from the camera's axis is under acos(1/d) + acos(1/(1+h)).
    const horizon = Math.acos(Math.min(1, 1 / camera.position.length())) + 0.02;
    for (const ch of chunks) {
      const off = camN.angleTo(ch.center);
      ch.mesh.visible = off - ch.radius < horizon + Math.acos(1 / (1 + heightOf(ch.land, ch.peak, lastM)));
      ch.mesh.renderOrder = Math.round(off * 100);
    }
    // Nothing moved and nothing is animating: skip the pin, label and grouping work, and the draw.
    const cp = camera.position, cq = camera.quaternion;
    const camKey = cp.x * 1.31 + cp.y * 1.73 + cp.z * 2.97 + cq.x * 3.11 + cq.y * 3.71 + cq.z * 4.33 + cq.w * 5.37 + detailP * 7.1 + W + Hh * 1e-3;
    if (camKey === lastCamKey && !animating && !needsRender) { requestAnimationFrame(frame); return; }
    lastCamKey = camKey;
    animating = false;

    // Markers and labels
    const toCam = scratchV;
    const ease = still ? 1 : 1 - Math.exp(-dt * 8);
    const pinScale = pos => Math.min(2.4, camera.position.distanceTo(pos) * (layout === "narrow" ? 0.62 : 0.5));
    const toScreen = v => { proj.copy(v).project(camera); return [(proj.x + 1) / 2 * W, (1 - proj.y) / 2 * Hh]; };
    // Where each pin stands and whether it faces the camera.
    for (const m of markers) {
      m.base = 1 + heightOf(m.land, m.elev, lastM) + 0.0001;
      m.holder.position.copy(m.dir).multiplyScalar(m.base);
      toCam.copy(camera.position).sub(m.holder.position).normalize();
      m.facing = toCam.dot(m.dir) > 0.15;
      m.screen = toScreen(m.holder.position);
    }
    // Group facing pins closer than ~46 px; pins grouped last frame stay together until ~62 px, so groups don't flicker.
    const parent = markers.map((_, i) => i);
    const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
    for (let i = 0; i < markers.length; i++) for (let j = i + 1; j < markers.length; j++) {
      const A = markers[i], B = markers[j];
      if (!A.facing || !B.facing || A.s.id === stop.id || B.s.id === stop.id) continue;
      const limit = A.group && A.group === B.group ? 62 : 46;
      if (Math.hypot(A.screen[0] - B.screen[0], A.screen[1] - B.screen[1]) < limit) parent[find(i)] = find(j);
    }
    const groups = new Map();
    markers.forEach((m, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(m); });
    const live = new Set();
    for (const members of groups.values()) {
      const key = members.length > 1 ? members.map(m => m.s.id).join("+") : null;
      for (const m of members) m.group = key;
      if (!key) continue;
      live.add(key);
      const c = clusterFor(key, members);
      c.dir.set(0, 0, 0);
      for (const m of members) c.dir.add(m.dir);
      c.dir.normalize();
      c.base = 1;
      for (const m of members) if (m.base > c.base) c.base = m.base;
    }
    for (const [key, c] of clusters) {
      const cTarget = live.has(key) ? 1 : 0;
      if (Math.abs(cTarget - c.vis) > 1e-3) animating = true;
      c.vis += (cTarget - c.vis) * ease;
      if (!live.has(key) && c.vis < 0.01) {
        markerGroup.remove(c.holder); clusters.delete(key); continue;
      }
      c.holder.position.copy(c.dir).multiplyScalar(c.base);
      east0.crossVectors(up, c.dir).normalize();
      north0.crossVectors(c.dir, east0);
      c.holder.quaternion.setFromRotationMatrix(frame0.makeBasis(east0, north0, c.dir));
      const ms = pinScale(c.holder.position);
      c.holder.scale.setScalar(ms * c.vis);
      c.holder.visible = c.vis > 0.01;

    }
    markers.forEach(m => {
      const on = stop.id === m.s.id;
      const target = on ? 1.9 : 1;
      if (Math.abs(target - m.scale) > 1e-3 || Math.abs((m.group ? 0 : 1) - (m.vis ?? 1)) > 1e-3) animating = true;
      m.scale += (target - m.scale) * (still ? 1 : 1 - Math.exp(-dt * 6));
      m.head.scale.setScalar(m.scale);
      // A pin inside a group shrinks away while the group's pin grows in its place.
      m.vis = (m.vis ?? 1) + ((m.group ? 0 : 1) - (m.vis ?? 1)) * ease;
      // Pins keep about the same size on screen at every zoom: scale with distance from the camera.
      const ms = pinScale(m.holder.position);
      m.holder.scale.setScalar(ms * m.vis);
      m.holder.visible = m.vis > 0.01;
      m.top.copy(m.dir).multiplyScalar(m.base + (m.H + 0.012) * ms);
      const [x, y] = toScreen(m.top);
      const tf = `translate(${x.toFixed(1)}px, ${(y - 16).toFixed(1)}px) translate(-50%, -100%)`;
      if (tf !== m.tf) { m.label.style.transform = tf; m.tf = tf; }
      const settled = ang < Math.max(0.0004, alt * 0.3);
      // Booleans only: classList.toggle(name, undefined) flips the class instead of clearing it.
      const neighbour = !on && !!m.region && m.region === stopRegion && detailP > 0.8 && settled && !m.group;
      m.label.classList.toggle("on", !!(m.facing && ((on && settled) || neighbour)));
      m.label.classList.toggle("dim", neighbour);
    });

    // Skip the draw when nothing on screen changed since the last one.
    const e = camera.matrixWorld.elements;
    let sig = heightUniforms.uM.value * 7 + heightUniforms.uP.value * 13 + trailMat.opacity + W * 1e-3 + Hh * 1e-5;
    for (let i = 0; i < 16; i++) sig += e[i] * (i + 1);
    for (const m of markers) sig += m.scale * 3 + m.vis * 5 + m.head.rotation.z;
    for (const c of clusters.values()) sig += c.vis * 11 + c.dir.x;
    if (needsRender || !(Math.abs(sig - lastSig) <= 1e-9)) {
      renderer.render(scene, camera);
      lastSig = sig;
      needsRender = false;
      if (!started && detailStops.length) {
        const idle = window.requestIdleCallback || (fn => setTimeout(fn, 200));
        setTimeout(() => idle(() => buildDetail(), { timeout: 3000 }), 800);
      }
      started = true;
    }
    requestAnimationFrame(frame);
  }
  window.__resume3D = () => {
    if (!sleeping3D) return;
    // Switching views clears the drag flag on <html>; forget the last state so the next frame sets it again.
    sleeping3D = false; last = null; needsRender = true; wasOverview = null;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
