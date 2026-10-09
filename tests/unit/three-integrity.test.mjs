// The three.js URL and integrity hash in index.html. A wrong hash makes every visitor's browser refuse three.js, and
// the page falls back to the HTML view.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { ROOT } from "./env.mjs";

const html = await readFile(new URL("index.html", ROOT), "utf8");
const url = html.match(/threeUrl: "([^"]+)"/)?.[1];
const integrity = html.match(/threeIntegrity: "([^"]+)"/)?.[1];
const local = new URL("../node_modules/three/build/three.min.js", import.meta.url);

test("index.html names three.js r128 on cdnjs, with a sha512 integrity hash", () => {
  assert.equal(url, "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js");
  assert.match(integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
});

test("the hash matches the three@0.128.0 build (cdnjs mirrors npm)", async t => {
  let file;
  try { file = await readFile(local); } catch { t.skip("run npm ci in tests/ first"); return; }
  const pkg = JSON.parse(await readFile(new URL("../node_modules/three/package.json", import.meta.url), "utf8"));
  assert.equal(pkg.version, "0.128.0");
  assert.equal(`sha512-${createHash("sha512").update(file).digest("base64")}`, integrity);
});
