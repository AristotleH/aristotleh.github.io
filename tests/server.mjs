// A static file server for the repository root, for the integration tests: `node server.mjs [port]`.
// Plain Node with explicit MIME types, so module scripts (.js, .mjs) are served the way GitHub Pages serves them.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 4173);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".png": "image/png", ".ico": "image/x-icon", ".pdf": "application/pdf", ".webmanifest": "application/manifest+json",
};

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (path.endsWith("/")) path += "index.html";
  const file = normalize(ROOT + path);
  if (!file.startsWith(ROOT) || file.split(sep).includes("node_modules")) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Serving ${ROOT} at http://127.0.0.1:${PORT}/`));
