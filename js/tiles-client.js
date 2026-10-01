// Starts the tile build (tiles.js) in a worker, as early as possible, and hands the globe its results: `globe`
// resolves with the tiles and block geometry, `detail` with the close-up detail. Where module workers aren't
// supported the same code runs on the page instead.
import { SITE, STOPS, REGIONS, TERRAIN } from "./site.js";

const D = Math.PI / 180;
const dirOf = (lat, lon) => [Math.cos(lat * D) * Math.cos(lon * D), Math.sin(lat * D), -Math.cos(lat * D) * Math.sin(lon * D)];
const inRegion = (g, lat, lon) => lat > g.lat0 && lat < g.lat1 && lon > g.lon0 && lon < g.lon1;

// Land and elevation, as plain data for terrain.js. One promise, so whoever asks first is answered first: the tile
// build asks before the globe does, so the worker gets its input before the page sets up its own lookups.
let terrain = null;
export function terrainInput() {
  return terrain ||= TERRAIN.then(T => {
    const G = SITE.globe, EL = G.layers.elevation;
    return {
      mask: SITE.globe.mask, MW: G.layers.land.columns, MH: G.layers.land.rows,
      globeElev: { w: EL.columns, h: EL.rows, lat1: 90, lon0: -180, step: 360 / EL.columns, wrap: true, km: EL.metersPerUnit / 1000, data: T.globe },
      regions: REGIONS.map(g => ({ lat0: g.lat0, lat1: g.lat1, lon0: g.lon0, lon1: g.lon1, step: g.step, w: g.w, h: g.h, mask: g.mask,
        elev: g.elevationLayer ? { w: g.elevationLayer.columns, h: g.elevationLayer.rows, lat1: g.lat1, lon0: g.lon0,
          step: (g.lon1 - g.lon0) / g.elevationLayer.columns, wrap: false, km: g.elevationLayer.metersPerUnit / 1000, data: T.regions[g.id] } : null })),
    };
  });
}
function tileInput(terrain) {
  const G = SITE.globe;
  // Stops inside a detail region, and one centre per region for its hex detail grids.
  const detailStops = [], anchors = [];
  for (const g of REGIONS) {
    const ps = STOPS.filter(s => inRegion(g, s.lat, s.lon)).map(s => dirOf(s.lat, s.lon));
    if (!ps.length) continue;
    detailStops.push(...ps);
    const c = ps.reduce((m, p) => [m[0] + p[0], m[1] + p[1], m[2] + p[2]], [0, 0, 0]), l = Math.hypot(...c) || 1;
    anchors.push([c[0] / l, c[1] / l, c[2] / l]);
  }
  return { ...G.grid, gap: G.grid.tileGap, sizeToDistance: G.detail.sizeToDistance, ice: G.terrain.iceLatitude,
    detailStops, anchors, terrain };
}

let job = null;
export function startTiles() {
  if (job) return job;
  let toGlobe, toDetail, onPage = false;
  job = { globe: new Promise(r => toGlobe = r), detail: new Promise(r => toDetail = r) };
  const here = async () => {
    if (onPage) return;
    onPage = true;
    const { buildGlobe, buildDetail } = await import("./tiles.js"), input = tileInput(await terrainInput());
    const G = buildGlobe(input);
    toGlobe(G);
    if (input.detailStops.length) setTimeout(() => toDetail(buildDetail(input, G)), 0);
  };
  try {
    const w = new Worker(new URL("./tiles-worker.js", import.meta.url), { type: "module" });
    w.onmessage = ({ data }) => data.type === "globe" ? toGlobe(data.G) : toDetail(data.DT);
    w.onerror = e => { e.preventDefault?.(); here(); };
    w.postMessage({ type: "grid", hex: SITE.globe.grid.shape === "hex", n: SITE.globe.grid.hexSubdivisions });
    terrainInput().then(t => w.postMessage({ type: "build", input: tileInput(t) }));
  } catch (e) { here(); }
  return job;
}
