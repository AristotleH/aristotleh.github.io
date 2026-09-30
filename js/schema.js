// The shape of data/site.json, written as JSON Schema (draft 2020-12 subset) so any standard validator can
// check the same file. The small validator below covers the keywords used here. Cross-references (a stop's
// kind, view and marker must exist) are checked after it, in checkSite().
export const LAT = { type: "number", minimum: -90, maximum: 90 };
export const LON = { type: "number", minimum: -180, maximum: 180 };
export const MONTH = "^\\d{4}-(0[1-9]|1[0-2])$";
export const TEXT = { type: "string", minLength: 1 };
export const PAIR = (min, max) => ({
  type: "object", additionalProperties: false, required: ["globe", "closeUp"],
  properties: { globe: { type: "number", minimum: min, maximum: max }, closeUp: { type: "number", minimum: min, maximum: max } },
});
// Raster layers cover their bounds (the whole Earth for globe layers) in equal lat/lon cells, north row first.
// Each is a file of base64 text next to site.json; `src` is its path from there.
export const LAYER_SRC = { type: "string", pattern: "^[a-z0-9][a-z0-9/_.-]*\\.txt$" };
export const LAND_LAYER = {
  type: "object", additionalProperties: false, required: ["columns", "rows", "encoding", "src"],
  properties: {
    columns: { type: "integer", minimum: 1 }, rows: { type: "integer", minimum: 1 },
    encoding: { const: "rle-varint-base64" },   // per row: alternating water/land run lengths as varints
    source: TEXT, src: LAYER_SRC,
  },
};
export const ELEVATION_LAYER = {
  type: "object", additionalProperties: false, required: ["columns", "rows", "encoding", "metersPerUnit", "src"],
  properties: {
    columns: { type: "integer", minimum: 2 }, rows: { type: "integer", minimum: 2 },
    encoding: { const: "uint8-deflate-base64" },   // one byte per cell, zlib-compressed; 0 = sea level or below
    metersPerUnit: { type: "number", minimum: 1, maximum: 100 },
    source: TEXT, src: LAYER_SRC,
  },
};
export const SITE_SCHEMA = {
  $id: "site.schema",
  type: "object",
  additionalProperties: false,
  required: ["profile", "overview", "views", "markers", "kinds", "stops", "globe"],
  properties: {
    $schema: { type: "string" },
    profile: {
      type: "object", additionalProperties: false,
      required: ["name", "headline", "location", "intro"],
      properties: {
        name: TEXT, headline: TEXT, location: TEXT, intro: TEXT,
        links: { type: "array", items: {
          type: "object", additionalProperties: false, required: ["label", "url"],
          properties: { label: TEXT, url: { type: "string", pattern: "^https://" } } } },
      },
    },
    // Stop order on the page: as written in `stops`, or sorted by `start` (photos by `photo.taken`).
    // Stops without a date keep their place relative to each other, after the dated ones.
    order: { enum: ["as-listed", "oldest-first", "newest-first"] },
    // The page after the intro, top to bottom: "projects" is one card listing `projects` (left out while the
    // list is empty), "experience" is every stop, sorted by `order`. The label titles the projects card, and
    // heads each section in the HTML view.
    layout: {
      type: "array", minItems: 1, maxItems: 2,
      items: {
        type: "object", additionalProperties: false, required: ["section"],
        properties: { section: { enum: ["projects", "experience"] }, label: TEXT },
      },
    },
    // Pages hosted on this site, each in its own folder under /projects/. `stop` ties one to a place: it's also
    // linked from that stop's card.
    projects: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["id", "title", "path", "summary"],
        properties: {
          id: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*$" },
          title: TEXT, summary: TEXT,
          path: { type: "string", pattern: "^/projects/[a-z0-9][a-z0-9-]*/$" },
          date: { type: "string", pattern: MONTH },
          tags: { type: "array", items: TEXT },
          stop: TEXT,
        },
      },
    },
    // Where the page opens: a point and one of `views`.
    overview: {
      type: "object", additionalProperties: false, required: ["lat", "lon", "view"],
      properties: { lat: LAT, lon: LON, view: TEXT },
    },
    // Named zoom levels. Stops refer to these by name.
    views: {
      type: "object", minProperties: 1,
      additionalProperties: {
        type: "object", additionalProperties: false, required: ["altitudeKm"],
        properties: { altitudeKm: { type: "number", minimum: 20, maximum: 40000 } },
      },
    },
    // Map pin styles, and the legend text shown for each on the intro card.
    markers: {
      type: "object", minProperties: 1,
      additionalProperties: {
        type: "object", additionalProperties: false, required: ["shape", "legend"],
        properties: { shape: { enum: ["cube", "diamond"] }, legend: TEXT },
      },
    },
    // Stop kinds: which pin they use, which card layout, and whether the route line connects them.
    kinds: {
      type: "object", minProperties: 1,
      additionalProperties: {
        type: "object", additionalProperties: false, required: ["marker", "card", "onRoute"],
        properties: { marker: TEXT, card: { enum: ["entry", "photo"] }, onRoute: { type: "boolean" } },
      },
    },
    // Stops. "entry" cards need start and body; "photo" cards need photo.
    stops: {
      type: "array", minItems: 1,
      items: {
        type: "object", additionalProperties: false,
        required: ["id", "kind", "title", "place", "lat", "lon", "view"],
        properties: {
          id: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*$" },
          kind: TEXT, title: TEXT, place: TEXT, lat: LAT, lon: LON, view: TEXT,
          start: { type: "string", pattern: MONTH },
          end: { type: "string", pattern: "^(\\d{4}-(0[1-9]|1[0-2])|present)$" },
          employment: TEXT,
          workplace: { enum: ["On-site", "Remote", "Hybrid"] },
          role: { type: ["string", "null"], minLength: 1 },   // optional; null or absent skips the role line
          body: TEXT,
          tags: { type: "array", items: TEXT },
          photo: {
            type: "object", additionalProperties: false, required: ["caption"],
            properties: {
              src: TEXT, alt: TEXT, caption: TEXT, placeholder: { type: "boolean" },
              taken: { type: "string", pattern: MONTH },
            },
          },
        },
      },
    },
    // Areas with fine land data. Stops inside one get subdivided tiles in the close-up.
    detailRegions: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["id", "name", "bounds", "land"],
        properties: {
          id: TEXT, name: TEXT,
          bounds: {
            type: "object", additionalProperties: false, required: ["south", "north", "west", "east"],
            properties: { south: LAT, north: LAT, west: LON, east: LON },
          },
          land: LAND_LAYER,
          elevation: ELEVATION_LAYER,   // optional; the globe's elevation layer is used where missing
        },
      },
    },
    // How the globe is built and moves. Colors stay in the CSS theme tokens (--g-*), since they differ by theme.
    globe: {
      type: "object", additionalProperties: false, required: ["grid", "terrain", "detail", "camera", "layers"],
      properties: {
        // Dashed arcs joining the school and work stops in order.
        routeArcs: { type: "boolean" },
        grid: {
          type: "object", additionalProperties: false, required: ["shape", "tilesPerFaceEdge", "hexSubdivisions", "tileGap"],
          properties: {
            // "hex": hexagonal tiles on a subdivided icosahedron (12 of them sit where only 5 neighbours meet).
            // "square": square tiles on a cube pushed out onto the sphere.
            shape: { enum: ["hex", "square"] },
            tilesPerFaceEdge: { type: "integer", minimum: 16, maximum: 192 },   // square: tiles along each cube face edge
            hexSubdivisions: { type: "integer", minimum: 12, maximum: 128 },    // hex: splits along each icosahedron edge
            tileGap: { type: "number", minimum: 0, maximum: 0.5 },              // share of a tile left as a gap
          },
        },
        // Tile height = ocean thickness, plus (on land) the land base and elevation x exaggeration.
        // Each is given for the whole-globe view and for close-ups; the globe blends between them.
        terrain: {
          type: "object", additionalProperties: false,
          required: ["verticalExaggeration", "landBaseKm", "oceanThicknessKm", "iceLatitude"],
          properties: {
            verticalExaggeration: PAIR(1, 200),
            landBaseKm: PAIR(0, 100),
            oceanThicknessKm: PAIR(0.01, 100),
            iceLatitude: {
              type: "object", additionalProperties: false, required: ["north", "south"],
              properties: { north: LAT, south: LAT },
            },
          },
        },
        detail: {
          type: "object", additionalProperties: false, required: ["sizeToDistance", "loadBelowAltitudeKm", "waveSeconds"],
          properties: {
            sizeToDistance: { type: "number", minimum: 0.05, maximum: 1 },   // tile size / distance to nearest stop
            loadBelowAltitudeKm: { type: "number", minimum: 100, maximum: 20000 },
            waveSeconds: { type: "number", minimum: 0.1, maximum: 10 },
          },
        },
        camera: {
          type: "object", additionalProperties: false, required: ["fovDeg", "closeTiltDeg", "dragSpeed", "idleSpinDegPerSec", "overviewZoom"],
          properties: {
            fovDeg: { type: "number", minimum: 10, maximum: 90 },
            closeTiltDeg: { type: "number", minimum: 0, maximum: 60 },
            dragSpeed: { type: "number", minimum: 0.05, maximum: 3 },   // 1 = surface follows the pointer
            idleSpinDegPerSec: { type: "number", minimum: 0, maximum: 60 },
            // How far the overview can zoom by wheel or pinch, as factors of its starting altitude.
            overviewZoom: {
              type: "object", additionalProperties: false, required: ["in", "out"],
              properties: { in: { type: "number", minimum: 1, maximum: 20 }, out: { type: "number", minimum: 1, maximum: 4 } },
            },
          },
        },
        layers: {
          type: "object", additionalProperties: false, required: ["land", "elevation"],
          properties: { land: LAND_LAYER, elevation: ELEVATION_LAYER },
        },
      },
    },
  },
};

export function validate(value, schema, path = "site", errors = []) {
  const at = msg => errors.push(`${path}: ${msg}`);
  const kind = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
  if (schema.type) {
    const types = [].concat(schema.type);
    const ok = types.some(t => t === "integer" ? Number.isInteger(value) : t === kind);
    if (!ok) { at(`expected ${types.join(" or ")}, got ${kind}`); return errors; }
  }
  if ("const" in schema && value !== schema.const) at(`must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) at(`must be one of ${schema.enum.join(", ")}`);
  if (kind === "string") {
    if (schema.minLength && value.length < schema.minLength) at("must not be empty");
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) at(`does not match ${schema.pattern}`);
  }
  if (kind === "number") {
    if ("minimum" in schema && value < schema.minimum) at(`must be at least ${schema.minimum}`);
    if ("maximum" in schema && value > schema.maximum) at(`must be at most ${schema.maximum}`);
  }
  if (kind === "array") {
    if (schema.minItems && value.length < schema.minItems) at(`needs at least ${schema.minItems} item(s)`);
    if (schema.items) value.forEach((v, i) => validate(v, schema.items, `${path}[${i}]`, errors));
  }
  if (kind === "object") {
    const props = schema.properties || {};
    for (const key of schema.required || []) if (!(key in value)) at(`missing "${key}"`);
    if (schema.minProperties && Object.keys(value).length < schema.minProperties) at("must not be empty");
    for (const [key, v] of Object.entries(value)) {
      if (props[key]) validate(v, props[key], `${path}.${key}`, errors);
      else if (schema.additionalProperties === false) at(`unknown field "${key}"`);
      else if (typeof schema.additionalProperties === "object") validate(v, schema.additionalProperties, `${path}.${key}`, errors);
    }
  }
  return errors;
}

// Land masks: each row is a run of water cells, then land, then water... as base64 varints.
export function decodeMask(bytes, w, h) {
  if (!(bytes instanceof Uint8Array)) throw new Error(`can't be read${bytes ? ` (${bytes.message})` : ""}`);
  const out = new Uint8Array(w * h);
  let k = 0;
  const read = () => {
    let n = 0, sh = 0, b;
    do { if (k >= bytes.length) throw new Error("mask ends early"); b = bytes[k++]; n |= (b & 127) << sh; sh += 7; } while (b & 128);
    return n;
  };
  for (let r = 0; r < h; r++) {
    let c = 0, v = 0;
    while (c < w) {
      const n = read();
      if (c + n > w) throw new Error(`row ${r} is longer than ${w} cells`);
      if (v) out.fill(1, r * w + c, r * w + c + n);
      c += n; v ^= 1;
    }
  }
  if (k !== bytes.length) throw new Error("mask has extra data");
  return out;
}

// Structural errors stop the page; problems local to one stop or region drop only that item.
// `files` maps each layer's src to its bytes, or to the error from reading it.
export function checkSite(raw, files) {
  // Stops, projects and regions are checked one at a time below, so one bad item doesn't block the page.
  const P = SITE_SCHEMA.properties;
  const outer = { ...SITE_SCHEMA, properties: { ...P, stops: { ...P.stops, items: { type: "object" } },
    detailRegions: { ...P.detailRegions, items: { type: "object" } },
    projects: { ...P.projects, items: { type: "object" } } } };
  const errors = validate(raw, outer);
  if (errors.length) return { errors, site: null };
  const site = structuredClone(raw);
  const itemOk = (list, schema, name) => list.filter((item, i) => {
    const e = validate(item, schema, `site.${name}[${i}]${item.id ? ` (${item.id})` : ""}`);
    errors.push(...e);
    return !e.length;
  });
  const drop = [];
  const views = site.views, kinds = site.kinds, markers = site.markers;
  for (const [name, k] of Object.entries(kinds))
    if (!markers[k.marker]) errors.push(`site.kinds.${name}: unknown marker "${k.marker}"`);
  if (!views[site.overview.view]) errors.push(`site.overview: unknown view "${site.overview.view}"`);
  const gl = site.globe.layers;
  if (gl.land.columns !== 2 * gl.land.rows) errors.push("site.globe.layers.land: needs twice as many columns as rows");
  if (gl.elevation.columns !== 2 * gl.elevation.rows) errors.push("site.globe.layers.elevation: needs twice as many columns as rows");
  const ice = site.globe.terrain.iceLatitude;
  if (ice.south >= ice.north) errors.push("site.globe.terrain.iceLatitude: south must be below north");
  try { site.globe.mask = decodeMask(files.get(gl.land.src), gl.land.columns, gl.land.rows); }
  catch (e) { errors.push(`site.globe.layers.land: ${e.message}`); }
  if (errors.length) return { errors, site: null };

  // From here on, a problem drops only the stop or region it is in.
  site.stops = itemOk(site.stops, P.stops.items, "stops");
  site.detailRegions = itemOk(site.detailRegions || [], P.detailRegions.items, "detailRegions");
  const ids = new Set();
  site.stops = site.stops.filter((s, i) => {
    const p = `site.stops (${s.id})`, before = errors.length;
    if (ids.has(s.id)) errors.push(`${p}: duplicate id`);
    ids.add(s.id);
    const kind = kinds[s.kind];
    if (!kind) errors.push(`${p}: unknown kind "${s.kind}"`);
    if (!views[s.view]) errors.push(`${p}: unknown view "${s.view}"`);
    if (kind && kind.card === "entry") {
      for (const f of ["start", "body"]) if (!(f in s)) errors.push(`${p}: an entry card needs "${f}"`);
      if (s.start && s.end && s.end !== "present" && s.end < s.start) errors.push(`${p}: ends before it starts`);
    }
    if (kind && kind.card === "photo" && !s.photo) errors.push(`${p}: a photo card needs "photo"`);
    if (kind && kind.card === "photo" && s.photo && !s.photo.src && !s.photo.placeholder)
      errors.push(`${p}: a photo needs "src", or "placeholder": true`);
    if (errors.length > before) { drop.push(s.id); return false; }
    return true;
  });
  // Layout: each section at most once, and experience always (every stop needs a card).
  const layout = site.layout || [{ section: "projects" }, { section: "experience" }];
  for (const sec of ["projects", "experience"]) {
    const n = layout.filter(b => b.section === sec).length;
    if (n > 1) errors.push(`site.layout: "${sec}" is listed ${n} times`);
  }
  site.layout = layout.filter((b, i) => layout.findIndex(o => o.section === b.section) === i);
  if (!site.layout.some(b => b.section === "experience")) {
    errors.push(`site.layout: needs an "experience" section`);
    site.layout.push({ section: "experience" });
  }
  for (const s of site.stops) if (s.id === "intro" || s.id === "projects") errors.push(`site.stops (${s.id}): "${s.id}" is reserved`);
  site.stops = site.stops.filter(s => s.id !== "intro" && s.id !== "projects");
  site.projects = itemOk(site.projects || [], P.projects.items, "projects");
  const pids = new Set(), stopIds = new Set(site.stops.map(s => s.id));
  site.projects = site.projects.filter(pr => {
    const p = `site.projects (${pr.id})`, before = errors.length;
    if (pids.has(pr.id)) errors.push(`${p}: duplicate id`);
    pids.add(pr.id);
    if (pr.stop && !stopIds.has(pr.stop)) errors.push(`${p}: unknown stop "${pr.stop}"`);
    return errors.length === before;
  });
  site.detailRegions = (site.detailRegions || []).filter((g, i) => {
    const p = `site.detailRegions (${g.id})`, b = g.bounds;
    if (b.south >= b.north || b.west >= b.east) { errors.push(`${p}: bounds are inverted`); return false; }
    const cellW = (b.east - b.west) / g.land.columns, cellH = (b.north - b.south) / g.land.rows;
    if (Math.abs(cellW - cellH) > 1e-9) {
      errors.push(`${p}.land: cells are ${cellW}° wide but ${cellH}° tall; they must be square`); return false;
    }
    g.cellDeg = cellW;
    try { g.mask = decodeMask(files.get(g.land.src), g.land.columns, g.land.rows); }
    catch (e) { errors.push(`${p}.land: ${e.message}`); return false; }
    return true;
  });
  if (!site.stops.length) { errors.push("site.stops: no valid stops left"); return { errors, site: null }; }
  return { errors, site, dropped: drop };
}
