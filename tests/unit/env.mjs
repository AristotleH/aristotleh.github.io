// The few browser globals that js/site.js and the modules built on it touch, so they can load in Node with the
// repository's real data. `fetch` reads files from the repository root; `siteJson` can replace data/site.json.
import { readFile } from "node:fs/promises";

export const ROOT = new URL("../../", import.meta.url);

export function installBrowserEnv({ siteJson, hostname = "test" } = {}) {
  globalThis.window = globalThis;
  globalThis.location = { hostname };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.document = { getElementById: () => null };
  globalThis.fetch = async path => {
    if (siteJson && path === "data/site.json") return new Response(JSON.stringify(siteJson));
    try { return new Response(await readFile(new URL(path, ROOT))); }
    catch { return new Response("not found", { status: 404 }); }
  };
}

export const readJson = async path => JSON.parse(await readFile(new URL(path, ROOT), "utf8"));

// The layer files named in site.json, decoded from base64 to bytes, as site.js hands them to checkSite.
export async function layerFiles(site) {
  const files = new Map();
  const layers = [site.globe.layers.land, site.globe.layers.elevation, ...site.detailRegions.flatMap(g => [g.land, g.elevation])];
  for (const l of layers.filter(Boolean))
    files.set(l.src, new Uint8Array(Buffer.from((await readFile(new URL("data/" + l.src, ROOT), "utf8")).trim(), "base64")));
  return files;
}
