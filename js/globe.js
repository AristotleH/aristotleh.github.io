// The 3D globe (three.js): tiles raised by elevation, pins that group when they crowd, and a camera that flies
// between stops. It starts the first time the 3D view is shown and sleeps while another view is up.
import { ALL, EARTH_KM, INTRO, KINDS, SITE, STOPS, reduceMotion, shapeOf } from "./site.js";
import { MODE } from "./mode.js";
import { active, goTo, syncScrollZone, viewStop } from "./page.js";
import { zoomGestures } from "./gestures.js";
import { makeTerrain } from "./terrain.js";
import { startTiles, terrainInput } from "./tiles-client.js";

// onReady is called once WebGL is up, before the tiles are built, so the page can show the cards meanwhile.
export async function globe(onReady) {
  const G = SITE.globe, T = G.terrain;
  let lastSig = NaN, needsRender = true, lastCamKey = NaN, animating = true, wasOverview = null;   // render-on-demand state
  const canvas = document.getElementById("globe");
  let renderer;
  try {
    if (!window.THREE) throw new Error("three.js missing");
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  } catch (e) {
    document.documentElement.classList.add("no-webgl");
    return false;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  onReady?.();

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

  const D = Math.PI / 180;
  // Land and elevation lookups for the pins. The tiles themselves are built off the page (tiles-client.js).
  const TR = makeTerrain(await terrainInput());
  const { elevPoint, landFrac, regionAt } = TR, MAX_ELEV = TR.maxElev;
  const regionOf = s => regionAt(s.lat, s.lon);
  // Tile height, in globe radii. m blends from the whole-globe settings (0) to the close-up settings (1).
  const blend = (pair, m) => pair.globe + (pair.closeUp - pair.globe) * m;
  const heightOf = (land, elevKm, m) => (blend(T.oceanThicknessKm, m) +
    (land ? Math.max(0, blend(T.landBaseKm, m) + elevKm * blend(T.verticalExaggeration, m)) : 0)) / EARTH_KM;
  const vecFromLatLon = (lat, lon, r = 1) => new THREE.Vector3(
    r * Math.cos(lat * D) * Math.cos(lon * D), r * Math.sin(lat * D), -r * Math.cos(lat * D) * Math.sin(lon * D));
  const latLonOf = v => [Math.asin(Math.max(-1, Math.min(1, v.y))) / D, Math.atan2(-v.z, v.x) / D];

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
  // The globe's tiles, from the worker: what each tile is, and each block's geometry as plain arrays.
  const tiles = await startTiles().globe;
  const COUNT = tiles.count, { tileDir, tileKind, tileTone, tileElev, tileBay } = tiles;
  const tileDelay = new Float32Array(COUNT);
  // Arrays to GPU buffers. Once uploaded the arrays are freed; colours are rebuilt when the theme changes, and wave
  // timing is kept only where detail replaces tiles, since only those tiles' timing ever changes.
  function geometryFrom(a, keepInfo) {
    const free = function () { this.array = null; };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(a.pos, 3).onUpload(free));
    geo.setAttribute("normal", new THREE.BufferAttribute(a.nor, 3, true).onUpload(free));
    const colAttr = new THREE.BufferAttribute(new Uint16Array(a.nv * 3), 3, true).onUpload(free);
    geo.setAttribute("color", colAttr);
    const infoAttr = new THREE.BufferAttribute(a.info, 4);
    if (!keepInfo) infoAttr.onUpload(free);
    geo.setAttribute("aInfo", infoAttr);
    geo.setIndex(new THREE.BufferAttribute(a.index, 1).onUpload(free));
    return { geo, vStart: a.vStart, nv: a.nv, infoAttr, colAttr };
  }
  // Colour, and wave delay, for one tile's vertices. A freed colour array is made again for a repaint.
  function paintTile(M, n, c) {
    const col = M.colAttr.array || (M.colAttr.array = new Uint16Array(M.nv * 3));
    const r = Math.round(c.r * 65535), g = Math.round(c.g * 65535), b = Math.round(c.b * 65535);
    for (let v = M.vStart[n]; v < M.vStart[n + 1]; v++) { col[v * 3] = r; col[v * 3 + 1] = g; col[v * 3 + 2] = b; }
  }
  function delayTile(M, n, d) { const info = M.infoAttr.array; for (let v = M.vStart[n]; v < M.vStart[n + 1]; v++) info[v * 4 + 2] = d; }

  // Blocks beyond the horizon or outside the view are skipped entirely. Each block knows its tallest tile, so flat
  // ocean blocks are dropped right at the horizon while mountain blocks stay until their peaks have set. A block's
  // buffers are made the first time it comes over the horizon (and the rest in idle time), so the first frame only
  // uploads the side of the globe that's showing.
  const chunks = tiles.blocks.map(b => ({ mesh: null, M: null, geo: b.geo, idx: b.idx, center: new THREE.Vector3(...b.center),
    radius: b.radius, land: b.land, peak: b.peak, bayAt: b.bayAt }));
  function realize(ch) {
    ch.M = geometryFrom(ch.geo, ch.bayAt.length > 0);
    ch.geo = null;
    // Bounds for three.js frustum culling: the block's cap of the sphere, plus room for the tallest tiles.
    ch.M.geo.boundingSphere = new THREE.Sphere(ch.center.clone(), 2 * Math.sin(ch.radius / 2) + 0.07);
    ch.mesh = new THREE.Mesh(ch.M.geo, tileMat);
    ch.mesh.frustumCulled = true;
    scene.add(ch.mesh);
    if (palette) paintChunk(ch);
    needsRender = true;
  }

  // Close-up detail arrives from the worker after the globe; until then the camera just flies in without it.
  let DT = null, detailFocus = null;
  startTiles().detail.then(d => {
    const M = geometryFrom(d.geo, true), mesh = new THREE.Mesh(M.geo, heightMaterial(true));
    M.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(...d.center), 2 * Math.sin(d.radius / 2) + 0.07);
    mesh.visible = false;
    mesh.renderOrder = -1;   // nearest to the camera when shown, so draw it first
    DT = { mesh, M, count: d.count, parent: d.parent, kind: d.kind, tone: d.tone, elev: d.elev,
      center: new THREE.Vector3(...d.center), radius: d.radius };
    if (detailFocus) setDetailFocus(detailFocus);
    paintDetail();
    scene.add(mesh);
    // Compile its shader now, in the gap after arrival, rather than on the first frame of a flight into the region.
    mesh.visible = true; renderer.compile(scene, camera); mesh.visible = false;
    needsRender = true;
  });
  // A globe tile and the pieces that replace it share one clock, so the swap never leaves a hole.
  function setDetailFocus(dir) {
    detailFocus = dir.clone();
    const f = new THREE.Vector3(), cap = 0.06;
    for (let i = 0; i < COUNT; i++) if (tileBay[i]) tileDelay[i] = Math.min(1, f.fromArray(tileDir, i * 3).angleTo(dir) / cap);
    for (const ch of chunks) if (ch.M && ch.bayAt.length) {
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
  const route = SITE.globe.routeArcs ? STOPS.filter(s => KINDS[s.kind].onRoute) : [];
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
  function paintChunk(ch) {
    const { ocean, ocean2, land2, snow, landColor } = palette, c = new THREE.Color();
    for (let k = 0; k < ch.idx.length; k++) {
      const i = ch.idx[k], kind = tileKind[i], t = tileTone[i];
      if (kind === 0) c.copy(ocean).lerp(ocean2, t);
      else if (kind === 1) landColor(c, tileElev[i], t);
      else c.copy(snow).lerp(land2, t * 0.08);
      paintTile(ch.M, k, c);
    }
    ch.M.colAttr.needsUpdate = true;
  }
  function applyTheme() {
    const ocean = lin("--g-ocean"), ocean2 = lin("--g-ocean2");
    const land = lin("--g-land"), land2 = lin("--g-land2"), land3 = lin("--g-land3");
    const snow = lin("--g-snow");
    // Tinted by height: lowland (--g-land) to upland at 1.5 km (--g-land2) to mountain at 3.5 km (--g-land3), and
    // only the highest ground (above 5 km) pales toward --g-snow. Each tile's tone shifts it slightly.
    const clamp01 = x => Math.max(0, Math.min(1, x));
    const landColor = (out, km, t) => {
      const h = km + (t - 0.5) * 0.3;
      if (h < 1.5) out.copy(land).lerp(land2, clamp01(h / 1.5));
      else out.copy(land2).lerp(land3, clamp01((h - 1.5) / 2));
      if (km > 5) out.lerp(snow, Math.min(0.6, (km - 5) / 1.5));
      return out;
    };
    palette = { ocean, ocean2, land2, snow, landColor };
    for (const ch of chunks) if (ch.M) paintChunk(ch);
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
  let detailP = 0, lastM = 0, lastDetail = -1, detailOn = false, lowM = 0;
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
    // Close in, the ground under the view is about `alt` away, much nearer than the horizon; the smaller of the two
    // (scaled to agree at the overview's altitude) keeps the ground under the finger at every zoom.
    const reach = Math.min(Math.sqrt(Math.max(0.2, cur.dist * cur.dist - 1)), (cur.dist - 1) * 1.32);
    const radiusPx = (Hh / 2) / (Math.tan(camera.fov * D / 2) * reach);
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
    const stop = viewStop();
    const still = reduceMotion.matches;
    const overview = stop === INTRO;
    if (overview !== wasOverview) { document.documentElement.classList.toggle("can-drag", overview); wasOverview = overview; syncScrollZone(); }
    if (overview) {
      if (!drag.on) {
        // Coast after a flick, then resume the slow spin once the globe has been left alone.
        spin += drag.vLon * dt; userLat += drag.vLat * dt;
        drag.vLon *= Math.pow(0.05, dt); drag.vLat *= Math.pow(0.05, dt);
        // The spin slows as you zoom in, so the ground passes at about the same pace on screen at any altitude.
        if (!still && now - drag.lastMove > 2500) spin += dt * G.camera.idleSpinDegPerSec * Math.min(1, Math.exp(cur.logAlt) / (INTRO.dist - 1));
      }
      userLat = Math.max(-55, Math.min(50, userLat));
    } else {
      // Away from the overview, drag and zoom offsets are dropped at once: they were relative to the overview's own
      // centre, so fading them out would aim the camera somewhere else first. The camera still eases from wherever
      // it is, so the flight goes straight from the current view to the stop.
      spin = userLat = pz.log = 0;
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
    // Deep zoom only where there's detail to see: near a detail area the overview comes all the way down; elsewhere
    // it stops once the relief has eased to close-up heights, and eases back up to there if you pan away from one.
    if (overview) {
      const near = DT && cur.dir.angleTo(DT.center) < DT.radius + 0.12;
      const floorLog = Math.log(0.35 * G.detail.loadBelowAltitudeKm / EARTH_KM / (INTRO.dist - 1));
      if (!near && pz.log < floorLog) pz.log = still ? floorLog : pz.log + (floorLog - pz.log) * (1 - Math.exp(-dt * 3));
    }
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
    // Detail shows at a stop inside a detail region, or on the overview when you've zoomed low enough and the
    // detail area is on screen: the patch of globe in view (out to the horizon, or the edge of the view when closer)
    // reaches it. Zooming back out or turning it away runs the load-in wave in reverse.
    const low = alt < G.detail.loadBelowAltitudeKm / EARTH_KM;
    let detailInView = false;
    if (DT && overview && low) {
      const seen = Math.min(Math.acos(1 / cur.dist), alt * Math.tan(camera.fov * D / 2) * Math.max(1, camera.aspect) * 1.3);
      detailInView = cur.dir.angleTo(DT.center) < DT.radius + seen;
    }
    const wantDetail = !!DT && low && (!!stopRegion || detailInView);
    if (wantDetail && !detailOn && detailP === 0) setDetailFocus(tgtDir);
    detailOn = wantDetail;
    const wave = G.detail.waveSeconds;
    detailP = still ? (wantDetail ? 1 : 0) : Math.max(0, Math.min(1, detailP + (wantDetail ? dt / wave : -dt / (wave / 2))));
    // Relief eases to the close-up settings with detail, and on the overview also as you zoom below the detail
    // altitude anywhere, so the camera can come down low without the globe-scale relief in the way. It eases rather
    // than follows the altitude directly, so leaving the overview never makes the terrain jump.
    const lowTarget = overview ? smooth(G.detail.loadBelowAltitudeKm / EARTH_KM, 0.35 * G.detail.loadBelowAltitudeKm / EARTH_KM, alt) : 0;
    lowM = still ? lowTarget : lowM + (lowTarget - lowM) * (1 - Math.exp(-dt * 3));
    if (Math.abs(lowTarget - lowM) > 1e-3) animating = true;
    const m = Math.max(smooth(0, 0.3, detailP), lowM);
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
      const shown = off - ch.radius < horizon + Math.acos(1 / (1 + heightOf(ch.land, ch.peak, lastM)));
      if (shown && !ch.mesh) realize(ch);
      if (!ch.mesh) continue;
      ch.mesh.visible = shown;
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
      // The label sits just above the head as drawn: the head's centre on screen, less the on-screen radius of a ball
      // around the cube at its current size (a corner reaches sqrt(3) x the half-width from the centre).
      m.top.copy(m.dir).multiplyScalar(m.base + m.H * ms);
      const [x, y] = toScreen(m.top);
      const rPx = 0.009 * Math.sqrt(3) * m.scale * ms * m.vis / (camera.position.distanceTo(m.top) * Math.tan(camera.fov * Math.PI / 360)) * Hh / 2;
      const tf = `translate(${x.toFixed(1)}px, ${(y - rPx - 6).toFixed(1)}px) translate(-50%, -100%)`;
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
      if (!started) {
        // Blocks on the far side are built in idle moments too, so turning the globe never waits on one.
        const idle = window.requestIdleCallback || (fn => setTimeout(() => fn({ timeRemaining: () => 6 }), 50));
        const blocks = d => {
          for (const ch of chunks) if (!ch.mesh) { realize(ch); ch.mesh.visible = false; if (d.timeRemaining() < 2) return idle(blocks); }
        };
        setTimeout(() => idle(blocks), 300);
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
  return true;
}
