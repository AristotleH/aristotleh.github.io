// The ASCII globe: every character cell casts a ray at the sphere; what it hits picks the glyph and color.
import { ALL, EARTH_KM, INTRO, KINDS, REGIONS, SITE, STOPS, TERRAIN, reduceMotion, shapeOf } from "./site.js";
import { MODE } from "./mode.js";
import { active, syncScrollZone, viewStop } from "./page.js";
import { zoomGestures } from "./gestures.js";
import { MARK, escHtml, renderBoxes, toAscii } from "./ascii-text.js";

export function asciiGlobe() {
  const pre = document.getElementById("ascii-globe");
  const G = SITE.globe, T = G.terrain, D = Math.PI / 180;
  const MW = G.layers.land.columns, MH = G.layers.land.rows, PER = MW / 360, lmask = SITE.globe.mask;
  let E = null, sleeping = true, last = null, needs = true, lastKey = NaN;
  TERRAIN.then(t => { E = t; needs = true; });

  const regionAt = (lat, lon) => REGIONS.find(g => lat > g.lat0 && lat < g.lat1 && lon > g.lon0 && lon < g.lon1);
  const landAt = (lat, lon) => {
    const g = regionAt(lat, lon);
    if (g) return g.mask[Math.floor((g.lat1 - lat) / g.step) * g.w + Math.floor((lon - g.lon0) / g.step)];
    const r = Math.min(MH - 1, Math.max(0, Math.floor((90 - lat) * PER)));
    return lmask[r * MW + ((Math.floor((lon + 180) * PER) % MW) + MW) % MW];
  };
  function bilinear(data, w, h, lat1, lon0, step, wrapX, lat, lon) {
    const x = (lon - lon0) / step - 0.5, y = (lat1 - lat) / step - 0.5;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const at = (c, r) => {
      r = Math.min(h - 1, Math.max(0, r));
      c = wrapX ? ((c % w) + w) % w : Math.min(w - 1, Math.max(0, c));
      return data[r * w + c];
    };
    return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
  }
  const EL = G.layers.elevation;
  const elevAt = (lat, lon) => {
    if (!E) return 0;
    const g = regionAt(lat, lon);
    if (g && g.elevationLayer && E.regions[g.id]) {
      const L = g.elevationLayer;
      return bilinear(E.regions[g.id], L.columns, L.rows, g.lat1, g.lon0, (g.lon1 - g.lon0) / L.columns, false, lat, lon) * L.metersPerUnit / 1000;
    }
    return bilinear(E.globe, EL.columns, EL.rows, 90, -180, 360 / EL.columns, true, lat, lon) * EL.metersPerUnit / 1000;
  };
  const hash = (a, b) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };

  // Vector helpers on plain arrays.
  const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const fromLL = (lat, lon) => [Math.cos(lat * D) * Math.cos(lon * D), Math.sin(lat * D), -Math.cos(lat * D) * Math.sin(lon * D)];
  // Stops inside a detail region: the overview can zoom all the way in near these, where the fine land data is.
  const detailDirs = STOPS.filter(s => regionAt(s.lat, s.lon)).map(s => fromLL(s.lat, s.lon));
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  // Camera: the same path as the 3D globe (ease toward the stop, pull back on long moves, tilt in close-ups).
  const cur = { dir: fromLL(INTRO.lat, INTRO.lon), logAlt: Math.log(INTRO.dist - 1) };
  let spin = 0, userLat = 0;
  const drag = { on: false, x: 0, y: 0, lastMove: -1e9 };

  // Grid size from a measured character cell.
  let cols = 0, rows = 0, cw = 7, ch = 12, layout = "wide";
  function measureGrid() {
    const probe = document.getElementById("ascii-probe-globe");
    // Width from ten measured characters; height from the line spacing (line-height is 1, so one line = the font size).
    // An inline span's box is taller than its line, which left rows missing at the bottom.
    const cs = getComputedStyle(pre), lh = parseFloat(cs.lineHeight), fs = parseFloat(cs.fontSize);
    cw = probe.getBoundingClientRect().width / 10 || 7;
    ch = (isFinite(lh) ? lh : fs) || 12;
    const W = innerWidth, H = pre.clientHeight || innerHeight;
    cols = Math.max(20, Math.floor(W / cw)); rows = Math.max(10, Math.floor(H / ch));
    layout = W >= 1100 ? "wide" : W >= 700 ? "mid" : "narrow";
    needs = true;
  }
  addEventListener("resize", () => { measureGrid(); renderBoxes(); });

  const pz = zoomGestures(pre, () => ALL[active] === INTRO, () => document.querySelector("#intro .abox"));
  pre.addEventListener("pointerdown", e => {
    if (ALL[active] !== INTRO) return;
    if (pz.pinching) { drag.on = false; drag.lastMove = performance.now(); return; }
    drag.on = true; drag.x = e.clientX; drag.y = e.clientY;
    pre.setPointerCapture(e.pointerId);
  });
  pre.addEventListener("pointermove", e => {
    if (!drag.on || pz.pinching) return;
    // Degrees per character shrink with altitude, so the ground keeps pace with the pointer when zoomed in.
    const k = 0.35 * G.camera.dragSpeed * Math.min(1, Math.exp(cur.logAlt) / (INTRO.dist - 1));
    spin -= (e.clientX - drag.x) / cw * k * 2; userLat += (e.clientY - drag.y) / ch * k * 2;
    drag.x = e.clientX; drag.y = e.clientY; drag.lastMove = performance.now();
  });
  const end = () => { drag.on = false; drag.lastMove = performance.now(); };
  pre.addEventListener("pointerup", end);
  pre.addEventListener("pointercancel", end);

  let rowEls = [], rowHtml = [], lastDraw = 0;
  const route = SITE.globe.routeArcs ? STOPS.filter(s => KINDS[s.kind].onRoute) : [];
  const RAMP_LAND = "*#%@", RAMP_ICE = "*#%";
  let wasIntro = null;

  function frame(now) {
    if (MODE !== "ascii") { sleeping = true; return; }
    const dt = last === null ? 0 : Math.min(0.05, (now - last) / 1000); last = now;
    const stop = viewStop(), overview = stop === INTRO, still = reduceMotion.matches;
    if (overview !== wasIntro) { pre.classList.toggle("can-drag", overview); wasIntro = overview; syncScrollZone(); }
    if (overview) {
      if (!drag.on && !still && now - drag.lastMove > 2500) spin += dt * G.camera.idleSpinDegPerSec * Math.min(1, Math.exp(cur.logAlt) / (INTRO.dist - 1));
      userLat = Math.max(-55, Math.min(50, userLat));
    } else { spin = userLat = pz.log = 0; }   // as in 3D: fly straight from the current view to the stop
    const tgt = fromLL(stop.lat + userLat, stop.lon + spin);
    const ang = Math.acos(Math.max(-1, Math.min(1, dot(cur.dir, tgt))));
    const k = still || drag.on ? 1 : 1 - Math.exp(-dt * 2.4);
    cur.dir = norm([cur.dir[0] + (tgt[0] - cur.dir[0]) * k, cur.dir[1] + (tgt[1] - cur.dir[1]) * k, cur.dir[2] + (tgt[2] - cur.dir[2]) * k]);
    const aspectPx = (cols * cw) / (rows * ch);
    const narrowBoost = aspectPx < 1 ? 1 + (1 - aspectPx) * 1.1 * smooth(0.6, 2.2, stop.dist - 1) : 1;
    // As in 3D: deep zoom only near detail; elsewhere the overview stops higher and eases back up if you pan away.
    if (overview) {
      const near = detailDirs.some(p => Math.acos(Math.max(-1, Math.min(1, dot(cur.dir, p)))) < 0.15);
      const floorLog = Math.log(0.35 * G.detail.loadBelowAltitudeKm / EARTH_KM / (INTRO.dist - 1));
      if (!near && pz.log < floorLog) pz.log = still ? floorLog : pz.log + (floorLog - pz.log) * (1 - Math.exp(-dt * 3));
    }
    const baseLog = Math.log((stop.dist - 1) * narrowBoost) + pz.log;
    const tLog = Math.min(baseLog + (still ? 0 : Math.min(2.6, ang * 5)), Math.max(baseLog, Math.log(2.6)));
    const kz = still ? 1 : 1 - Math.exp(-dt * 8);
    cur.logAlt += (tLog - cur.logAlt) * (overview && Math.abs(pz.log) > 1e-4 ? Math.max(k, kz) : k);
    const alt = Math.exp(cur.logAlt), dist = 1 + alt;

    // Camera frame, as in the 3D view.
    const zoom = smooth(2.4, 1.2, alt), tilt = G.camera.closeTiltDeg * D * smooth(1.6, 0.3, alt);
    let east = cross([0, 1, 0], cur.dir); if (Math.hypot(...east) < 1e-6) east = [1, 0, 0]; east = norm(east);
    const north = norm(cross(cur.dir, east));
    const look = cur.dir.map(v => v * zoom);
    const cd = norm(cur.dir.map((v, i) => v * Math.cos(tilt) - north[i] * Math.sin(tilt)));
    const C = cd.map((v, i) => v * (dist - zoom) + look[i]);
    const F = norm(look.map((v, i) => v - C[i]));
    const R = norm(cross(F, north)), U = cross(R, F);
    const tanH = Math.tan(G.camera.fovDeg * D / 2);
    const offX = layout === "mid" ? 0.4 : 0, offY = layout === "narrow" ? 0.4 : 0;

    const key = C[0] * 1.3 + C[1] * 1.7 + C[2] * 2.9 + F[0] * 3.1 + F[1] * 3.7 + cols * 7 + rows * 11 + (E ? 1 : 0);
    if (key === lastKey && !needs) { requestAnimationFrame(frame); return; }
    // The idle spin moves the globe less than a character a frame, so it redraws at 30 fps; drags, zooms and
    // flights still redraw every frame.
    const idleSpin = overview && !drag.on && !pz.pinching && now - drag.lastMove > 2500 && Math.abs(tLog - cur.logAlt) < 1e-3;
    if (idleSpin && !needs && now - lastDraw < 30) { requestAnimationFrame(frame); return; }
    lastDraw = now;
    lastKey = key; needs = false;

    // Light in camera space: key from the upper left, like the 3D globe.
    const Ldir = norm(R.map((v, i) => v * -1.4 + U[i] * 1.1 - F[i] * 0.55));
    const light = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    const onLight = parseInt(light.slice(1, 3), 16) > 128;
    const cellDeg = (alt * tanH * 2 / rows) / D;   // roughly how many degrees one character covers
    const glyph = new Array(cols * rows), cls = new Uint8Array(cols * rows);   // 0 none 1 ocean 2 land 3 high 4 ice 5 atmo 6 star 7 route 8 marker 9 label 10 active label
    const cc = dot(C, C) - 1;
    // Which cells hit the sphere, and the screen direction of the surface normal there, for the outline.
    const hit = new Uint8Array(cols * rows), sx = new Float32Array(cols * rows), sy = new Float32Array(cols * rows);
    for (let j = 0; j < rows; j++) {
      const py = 1 - (j + 0.5) / rows * 2 - offY;
      for (let i = 0; i < cols; i++) {
        const px = (i + 0.5) / cols * 2 - 1 - offX, n = j * cols + i;
        const rx = F[0] + (R[0] * px * aspectPx + U[0] * py) * tanH;
        const ry = F[1] + (R[1] * px * aspectPx + U[1] * py) * tanH;
        const rz = F[2] + (R[2] * px * aspectPx + U[2] * py) * tanH;
        const rl = Math.hypot(rx, ry, rz), dx = rx / rl, dy = ry / rl, dz = rz / rl;
        const b = C[0] * dx + C[1] * dy + C[2] * dz, disc = b * b - cc;
        if (disc < 0) {
          // Missed the globe: a sparse starfield. Stars never use ".", which is the ocean's glyph.
          if (hash(i * 3.1, j * 7.7) < 0.006) { glyph[n] = hash(i, j * 2) < 0.3 ? "*" : "+"; cls[n] = 6; }
          else glyph[n] = " ";
          continue;
        }
        const s = -b - Math.sqrt(disc);
        const x = C[0] + dx * s, y = C[1] + dy * s, z = C[2] + dz * s;
        hit[n] = 1; sx[n] = x * R[0] + y * R[1] + z * R[2]; sy[n] = x * U[0] + y * U[1] + z * U[2];
        const lat = Math.asin(Math.max(-1, Math.min(1, y))) / D, lon = Math.atan2(-z, x) / D;
        let nx = x, ny = y, nz = z;
        const land = landAt(lat, lon);
        if (!land) {
          // Ocean stays quiet so the land reads, but fills the disc: dots everywhere in the light, a checkerboard
          // in shadow, and a few waves where it's brightest.
          const lit = Math.max(0, nx * Ldir[0] + ny * Ldir[1] + nz * Ldir[2]);
          const lattice = (i + j) % 2 === 0, t = hash(i, j);
          glyph[n] = lit > 0.5 && t < 0.07 ? "~" : lit > 0.3 || lattice ? "." : " ";
          cls[n] = 1;
          continue;
        }
        // Hillshade: tilt the normal by the elevation slope across this cell.
        const d = Math.max(0.01, cellDeg), e0 = elevAt(lat, lon);
        // Forward differences, doubled to match the old central ones: three lookups a cell instead of five.
        const gE = (elevAt(lat, lon + d) - e0) * 2, gN = (elevAt(lat + d, lon) - e0) * 2;
        const exag = 12 / Math.max(0.02, d);
        const eLon = [-Math.sin(lon * D), 0, -Math.cos(lon * D)], nLat = [-Math.sin(lat * D) * Math.cos(lon * D), Math.cos(lat * D), Math.sin(lat * D) * Math.sin(lon * D)];
        nx -= (eLon[0] * gE + nLat[0] * gN) * exag * 0.001; ny -= (eLon[1] * gE + nLat[1] * gN) * exag * 0.001; nz -= (eLon[2] * gE + nLat[2] * gN) * exag * 0.001;
        const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
        const lit = Math.max(0, nx * Ldir[0] + ny * Ldir[1] + nz * Ldir[2]);
        const bright = Math.min(1, 0.25 + lit * 0.85);
        const ice = lat > T.iceLatitude.north || lat < T.iceLatitude.south;
        if (ice) {
          const idx = Math.floor((onLight ? 1 - bright : bright) * (RAMP_ICE.length - 0.01));
          glyph[n] = RAMP_ICE[idx]; cls[n] = 4;
        } else if (e0 > 3.2 && lit > 0.3) { glyph[n] = "^"; cls[n] = 3; }
        else {
          const r = onLight ? 1 - bright : bright, jitter = (hash(i * 1.7, j * 2.3) - 0.5) * 0.28;
          glyph[n] = RAMP_LAND[Math.max(0, Math.min(RAMP_LAND.length - 1, Math.floor((r + jitter) * RAMP_LAND.length)))];
          cls[n] = e0 > 1.5 ? 3 : 2;
        }
      }
    }

    // Outline: sphere cells next to a cell that misses it get a line glyph that follows the edge.
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const n = j * cols + i;
      if (!hit[n]) continue;
      const a = Math.atan2(sy[n], sx[n]) / D;   // 0 is right, 90 is up, on screen
      const q = ((a % 180) + 180) % 180;
      // Steep edges only look sideways and flat edges only up and down, so the line stays one glyph thick.
      const hOut = (i > 0 && !hit[n - 1]) || (i < cols - 1 && !hit[n + 1]);
      const vOut = (j > 0 && !hit[n - cols]) || (j < rows - 1 && !hit[n + cols]);
      const steep = q < 30 || q >= 150, flat = q >= 70 && q < 110;
      if (!(steep ? hOut : flat ? vOut : hOut || vOut)) continue;
      glyph[n] = q < 22.5 || q >= 157.5 ? "|" : q < 67.5 ? "\\" : q < 112.5 ? "-" : "/";
      cls[n] = 11;
    }

    // World point -> cell. Hidden when on the far side of the globe.
    const toCell = p => {
      if (dot(p, C) <= 1) return null;
      const v = [p[0] - C[0], p[1] - C[1], p[2] - C[2]], zc = dot(v, F);
      if (zc <= 0) return null;
      const px = dot(v, R) / (zc * tanH * aspectPx) + offX, py = dot(v, U) / (zc * tanH) + offY;
      const ci = Math.floor((px + 1) / 2 * cols), cj = Math.floor((1 - py) / 2 * rows);
      return ci >= 0 && ci < cols && cj >= 0 && cj < rows ? [ci, cj] : null;
    };
    const put = (ci, cj, text, c, force) => {
      for (let q = 0; q < text.length; q++) {
        const i = ci + q; if (i < 0 || i >= cols) continue;
        const n = cj * cols + i;
        if (!force && cls[n] >= 7) return false;
      }
      for (let q = 0; q < text.length; q++) { const i = ci + q; if (i >= 0 && i < cols) { glyph[cj * cols + i] = text[q]; cls[cj * cols + i] = c; } }
      return true;
    };

    // Route: dotted great-circle arcs between school and work stops, hidden in close-ups.
    if (alt > 0.12) for (let r = 0; r + 1 < route.length; r++) {
      const A = fromLL(route[r].lat, route[r].lon), B = fromLL(route[r + 1].lat, route[r + 1].lon);
      const om = Math.acos(Math.max(-1, Math.min(1, dot(A, B)))), steps = Math.max(8, Math.ceil(om / D * 2));
      for (let k2 = 1; k2 < steps; k2++) {
        const t = k2 / steps, sa = Math.sin((1 - t) * om), sb = Math.sin(t * om), so = Math.sin(om) || 1;
        const lift = 1 + 0.03 + Math.sin(Math.PI * t) * Math.max(0.01, om * 0.35);
        const p = [0, 1, 2].map(q => (A[q] * sa + B[q] * sb) / so * lift);
        const cell = toCell(p);
        if (cell && k2 % 2 === 0) put(cell[0], cell[1], ".", 7);
      }
    }

    // Pins: grouped when they share a cell neighbourhood; the current stop stays on its own.
    const pins = [];
    for (const s of STOPS) {
      const cell = toCell(fromLL(s.lat, s.lon));
      if (cell) pins.push({ s, cell, on: s.id === stop.id });
    }
    const groups = [];
    for (const p of pins) {
      const g = !p.on && groups.find(g => !g.on && Math.abs(g.cell[0] - p.cell[0]) <= 3 && Math.abs(g.cell[1] - p.cell[1]) <= 1);
      if (g) g.members.push(p); else groups.push({ cell: p.cell, on: p.on, members: [p] });
    }
    const close = alt < 0.2;
    for (const g of groups) {
      const [ci, cj] = g.cell;
      if (g.members.length > 1) { put(ci - 1, cj, `(${g.members.length})`, 8, true); continue; }
      const p = g.members[0], m = MARK[shapeOf(p.s)];
      if (p.on) {
        put(ci - 1, cj, `[${m}]`, 8, true);
        const label = " " + toAscii(p.s.title).toUpperCase() + " ";
        if (!put(ci + 3, cj, label, 10) && !put(ci - 2 - label.length, cj, label, 10)) put(ci - Math.floor(label.length / 2), cj - 1, label, 10);
      } else {
        put(ci, cj, m, 8, true);
        if (close) { const label = " " + toAscii(p.s.title) + " "; put(ci + 2, cj, label, 9) || put(ci - 1 - label.length, cj, label, 9); }
      }
    }

    // Compose runs of the same class into spans. Each row is its own element and only rows whose markup changed
    // are replaced, so a slow spin restyles and repaints a few rows a frame instead of the whole screen.
    const CL = ["", "a-o", "a-l", "a-h", "a-i", "a-atm", "a-star", "a-rt", "a-mk", "a-lb", "a-lbo", "a-rim"];
    if (rowEls.length !== rows) {
      pre.textContent = "";
      rowEls = []; rowHtml = [];
      for (let j = 0; j < rows; j++) {
        const r = document.createElement("span");
        r.className = "a-row";
        pre.appendChild(r); rowEls.push(r); rowHtml.push("");
        if (j < rows - 1) pre.appendChild(document.createTextNode("\n"));
      }
    }
    for (let j = 0; j < rows; j++) {
      let html = "", run = "", rc = -1;
      for (let i = 0; i < cols; i++) {
        const n = j * cols + i, c = cls[n];
        if (c !== rc) { if (run) html += rc > 0 ? `<span class="${CL[rc]}">${escHtml(run)}</span>` : escHtml(run); run = ""; rc = c; }
        run += glyph[n];
      }
      if (run) html += rc > 0 ? `<span class="${CL[rc]}">${escHtml(run)}</span>` : escHtml(run);
      if (html !== rowHtml[j]) { rowEls[j].innerHTML = html; rowHtml[j] = html; }
    }
    requestAnimationFrame(frame);
  }
  window.__resumeAscii = () => {
    if (!sleeping) return;
    sleeping = false; last = null; needs = true; wasIntro = null;
    measureGrid();
    requestAnimationFrame(frame);
  };
  window.__asciiNeeds = () => { measureGrid(); needs = true; };
  new MutationObserver(() => { needs = true; }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { needs = true; });
}
