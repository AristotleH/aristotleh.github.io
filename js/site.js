// Loads data/site.json and the layer files it names, checks them, and derives what every view shares.
import { checkSite } from "./schema.js";

export const EARTH_KM = 6371;
export const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
export const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
export const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const fmtMonth = m => m === "present" ? "present" : `${MONTHS[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;

export const PROBLEMS = [];
export function showProblems(errors, fatal) {
  if (!errors.length) return;
  if (fatal) window.siteStartup?.fallback();
  console.warn("Site data problems:\n" + errors.join("\n"));
  PROBLEMS.push(...errors);
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
export const dateOf = s => s.start || s.date || (s.photo && s.photo.taken) || null;
export function ordered(stops, order) {
  if (!order || order === "as-listed") return stops;
  const dated = stops.filter(dateOf), undated = stops.filter(s => !dateOf(s));
  // Stable sort by YYYY-MM (string order is date order); ties keep their listed order.
  dated.sort((a, b) => order === "newest-first" ? dateOf(b).localeCompare(dateOf(a)) : dateOf(a).localeCompare(dateOf(b)));
  return [...dated, ...undated];
}
export const STOPS = ordered(SITE.stops, SITE.order).map(s => ({ ...s, dist: 1 + altitude(s.view) }));
export const KINDS = SITE.kinds, MARKERS = SITE.markers;
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
// A stop's dates and place, or its photo date and place.
export function eyebrowOf(s) {
  if (KINDS[s.kind].card === "photo") {
    return [s.photo.taken && fmtMonth(s.photo.taken), s.place].filter(Boolean).join(", ");
  }
  const dates = s.end ? `${fmtMonth(s.start)} – ${fmtMonth(s.end)}` : fmtMonth(s.start);
  return `${dates}, ${s.place}`;
}
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
