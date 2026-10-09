// Land and elevation lookups, shared by the globe (for pins) and the tile builder (which may run in a worker).
// `input` is plain data, so it can be posted to a worker:
//   mask, MW, MH: the globe land mask, equirectangular, north row first
//   globeElev: { w, h, lat1, lon0, step, wrap, km, data } for the whole Earth
//   regions: [{ lat0, lat1, lon0, lon1, step, w, h, mask, elev }] with an optional elev like globeElev
export function makeTerrain(input) {
  const { mask, MW, MH, globeElev } = input, D = Math.PI / 180, PER_DEG = MW / 360;
  const regions = input.regions;
  const isLand = (lat, lon) => {
    const r = Math.min(MH - 1, Math.max(0, Math.floor((90 - lat) * PER_DEG)));
    const c = ((Math.floor((lon + 180) * PER_DEG) % MW) + MW) % MW;
    return mask[r * MW + c];
  };
  // Elevation (km) from the globe layer, or a region's own layer where it has one. Bilinear between cell centres.
  function sampleElev(E, lat, lon) {
    const x = (lon - E.lon0) / E.step - 0.5, y = (E.lat1 - lat) / E.step - 0.5;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, w = E.w, h = E.h, data = E.data;
    // The four samples' rows and columns, clamped (or wrapped around the globe).
    const r0 = Math.min(h - 1, Math.max(0, y0)) * w, r1 = Math.min(h - 1, Math.max(0, y0 + 1)) * w;
    const c0 = E.wrap ? ((x0 % w) + w) % w : Math.min(w - 1, Math.max(0, x0));
    const c1 = E.wrap ? (((x0 + 1) % w) + w) % w : Math.min(w - 1, Math.max(0, x0 + 1));
    const top = data[r0 + c0] * (1 - fx) + data[r0 + c1] * fx, bot = data[r1 + c0] * (1 - fx) + data[r1 + c1] * fx;
    return (top * (1 - fy) + bot * fy) * E.km;
  }
  const elevPoint = (lat, lon) => {
    let g = null;
    for (const r of regions) if (r.elev && lat > r.lat0 && lat < r.lat1 && lon > r.lon0 && lon < r.lon1) { g = r; break; }
    return sampleElev(g ? g.elev : globeElev, lat, lon);
  };
  // Mean over a tile: 3 x 3 samples across its footprint.
  function elevAt(lat, lon, halfDeg) {
    let sum = 0;
    const hc = halfDeg / Math.max(0.05, Math.cos(lat * D));
    for (const dy of [-0.66, 0, 0.66]) for (const dx of [-0.66, 0, 0.66]) sum += elevPoint(lat + dy * halfDeg, lon + dx * hc);
    return sum / 9;
  }
  let maxElev = 0;
  for (let i = 0, d = globeElev.data; i < d.length; i++) if (d[i] > maxElev) maxElev = d[i];
  maxElev *= globeElev.km;

  const regionAt = (lat, lon, half = 0) => regions.find(g => lat - half > g.lat0 && lat + half < g.lat1 &&
    lon - half / Math.cos(lat * D) > g.lon0 && lon + half / Math.cos(lat * D) < g.lon1);
  // Summed-area tables over each region's fine mask, for the share of land in a large box. Made the first time one
  // is needed: the page asks only about its pins, whose boxes are a few cells, counted directly.
  const satOf = g => {
    if (!g.sat) {
      g.SW = g.w + 1; g.sat = new Float32Array(g.SW * (g.h + 1));
      for (let r = 0; r < g.h; r++) for (let c = 0; c < g.w; c++)
        g.sat[(r + 1) * g.SW + c + 1] = g.mask[r * g.w + c] + g.sat[r * g.SW + c + 1] + g.sat[(r + 1) * g.SW + c] - g.sat[r * g.SW + c];
    }
    return g.sat;
  };
  // Share of land in a box around a point: from a region's fine mask when the box is inside it, else the globe mask.
  function coarseFrac(lat, lon, halfDeg) {
    const hc = halfDeg / Math.cos(lat * D);
    const r0 = Math.floor((90 - lat - halfDeg) * PER_DEG), r1 = Math.max(r0, Math.floor((90 - lat + halfDeg) * PER_DEG - 1e-9));
    const c0 = Math.floor((lon + 180 - hc) * PER_DEG), c1 = Math.max(c0, Math.floor((lon + 180 + hc) * PER_DEG - 1e-9));
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
    let sum = 0;
    if ((r1 - r0) * (c1 - c0) <= 64) {
      for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) sum += g.mask[r * g.w + c];
    } else {
      const sat = satOf(g);
      sum = sat[r1 * g.SW + c1] - sat[r0 * g.SW + c1] - sat[r1 * g.SW + c0] + sat[r0 * g.SW + c0];
    }
    return sum / ((r1 - r0) * (c1 - c0));
  }
  return { isLand, elevPoint, elevAt, regionAt, landFrac, maxElev };
}
