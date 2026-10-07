// Loads data/site.json and the layer files it names, checks them, and derives what every view shares.
import { checkSite } from "./schema.js";
import { esc, eyebrowOf as eyebrowWith, ordered } from "./plain-content.mjs";
export { esc, fmtMonth, profileLinks } from "./plain-content.mjs";

export const EARTH_KM = 6371;
export const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

// Problems always go to the console. On the page, problems that only skip some data are listed while previewing
// locally; visitors see a box only when the interactive views can't start.
const LOCAL = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
export const PROBLEMS = [];
export function showProblems(errors, fatal) {
  if (!errors.length) return;
  if (fatal) window.siteStartup?.fallback();
  console.warn("Site data problems:\n" + errors.join("\n"));
  PROBLEMS.push(...errors);
  if (!fatal && !LOCAL) return;
  const box = document.getElementById("data-problems");
  box.hidden = false;
  box.innerHTML = `<strong>${fatal ? "Interactive views are unavailable. The HTML document is shown below." : "Some site data was skipped."}</strong>
    <ul>${PROBLEMS.map(e => `<li>${esc(e)}</li>`).join("")}</ul>`;
}

// Layer files (base64 text) are fetched side by side and decoded to bytes; a file that can't be read maps to the
// error instead.
export const layerFiles = new Map();
export async function fetchLayer(src) {
  try {
    const r = await fetch("data/" + src);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const bin = atob((await r.text()).trim()), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    layerFiles.set(src, bytes);
  } catch (e) { layerFiles.set(src, e); }
}
// Elevation layers are zlib-compressed bytes. The browser inflates them; a bad layer reads as sea level.
export async function loadElevation(layer, path) {
  try {
    if (!window.DecompressionStream) throw new Error("this browser can't decompress it");
    const bytes = layerFiles.get(layer.src);
    if (!(bytes instanceof Uint8Array)) throw new Error(`can't be read${bytes ? ` (${bytes.message})` : ""}`);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    const out = new Uint8Array(await new Response(stream).arrayBuffer());
    if (out.length !== layer.columns * layer.rows)
      throw new Error(`has ${out.length} cells, expected ${layer.columns} x ${layer.rows}`);
    return out;
  } catch (e) {
    showProblems([`${path}: ${e.message}. Terrain there is drawn flat.`], false);
    return new Uint8Array(layer.columns * layer.rows);
  }
}

export let raw = null;
try {
  const r = await fetch("data/site.json");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  raw = await r.json();
} catch (e) { showProblems([`data/site.json can't be read: ${e.message}`], true); }
if (raw) {
  const layers = [raw.globe?.layers?.land, raw.globe?.layers?.elevation,
    ...(Array.isArray(raw.detailRegions) ? raw.detailRegions.flatMap(g => [g?.land, g?.elevation]) : [])];
  await Promise.all([...new Set(layers.map(l => l?.src).filter(s => typeof s === "string"))].map(fetchLayer));
}
export const checked = raw ? checkSite(raw, layerFiles) : { errors: [], site: null };
if (raw) showProblems(checked.errors, !checked.site);
export const SITE = checked.site;
if (!SITE) throw new Error("site data invalid");

export const altitude = view => SITE.views[view].altitudeKm / EARTH_KM;
export const STOPS = ordered(SITE.stops, SITE.order).map(s => ({ ...s, dist: 1 + altitude(s.view) }));
export const KINDS = SITE.kinds, MARKERS = SITE.markers;
// Pins grouped on screen, the same way in both globe views. Pins within `limit` px of each other join one group,
// measured as if both stood at the middle of the view: their angle apart times `pxPerRad`, the screen size of one
// radian of globe there. So turning the globe never splits or joins a group; zooming does, at the same zoom each time
// for the same pins. Pins that shared a group last frame (`was`: a group key per stop, or null) stay together until
// `keep` px, so a group doesn't flicker at the edge. Both views pass GROUP_PX. The current stop stays on its own.
// Returns lists of STOPS indices.
const STOP_DIRS = STOPS.map(s => {
  const la = s.lat * Math.PI / 180, lo = s.lon * Math.PI / 180;
  return [Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)];
});
const STOP_ANGLES = STOP_DIRS.map(a => STOP_DIRS.map(b => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])))));
export const GROUP_PX = { limit: 46, keep: 62 };
export function groupStops(pxPerRad, limit, keep, currentId, was) {
  const parent = STOPS.map((_, i) => i);
  const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  for (let i = 0; i < STOPS.length; i++) for (let j = i + 1; j < STOPS.length; j++) {
    if (STOPS[i].id === currentId || STOPS[j].id === currentId) continue;
    const together = was[i] != null && was[i] === was[j];
    if (STOP_ANGLES[i][j] * pxPerRad < (together ? keep : limit)) parent[find(i)] = find(j);
  }
  const groups = new Map();
  STOPS.forEach((_, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
  return [...groups.values()];
}
export const shapeOf = s => MARKERS[KINDS[s.kind].marker].shape;
export const INTRO = { id: "intro", lat: SITE.overview.lat, lon: SITE.overview.lon,
  dist: 1 + altitude(SITE.overview.view), name: "Overview" };
export const P = SITE.profile;

// The page after the intro, in `layout` order. The projects card is one step; the globe pulls back to the
// overview framing while it's on screen.
export const PROJECTS = ordered(SITE.projects, SITE.order);
export let PROJECTS_STEP = null;
export const SEQ = [];
for (const b of SITE.layout) {
  let items;
  if (b.section === "projects") {
    if (!PROJECTS.length) continue;
    PROJECTS_STEP = { id: "projects", title: b.label || "Projects",
      lat: INTRO.lat, lon: INTRO.lon, dist: INTRO.dist };
    items = [PROJECTS_STEP];
  } else items = STOPS;
  SEQ.push(...items);
}
export const projectsAt = s => PROJECTS.filter(pr => pr.stop === s.id);
// Every step of the page: the intro, then SEQ.
export const ALL = [INTRO, ...SEQ];
export const eyebrowOf = s => eyebrowWith(s, KINDS);
// Each step's <section>. Stops' sections are prefixed, so a stop id can't clash with another element's id.
export const sectionId = s => s === INTRO || s === PROJECTS_STEP ? s.id : `stop-${s.id}`;
// Elevation layers, decoded once and shared by the 3D globe and the ASCII globe.
export const TERRAIN = (async () => {
  const out = { globe: await loadElevation(SITE.globe.layers.elevation, "site.globe.layers.elevation"), regions: {} };
  for (const g of SITE.detailRegions) if (g.elevation)
    out.regions[g.id] = await loadElevation(g.elevation, `site.detailRegions (${g.id}).elevation`);
  return out;
})();
export const REGIONS = SITE.detailRegions.map(g => ({
  id: g.id, name: g.name, lat0: g.bounds.south, lat1: g.bounds.north, lon0: g.bounds.west, lon1: g.bounds.east,
  step: g.cellDeg, w: g.land.columns, h: g.land.rows, mask: g.mask, elevationLayer: g.elevation,
}));
