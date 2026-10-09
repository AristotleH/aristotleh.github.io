// scripts/render-static.mjs and the HTML document checked into index.html.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { plainContent } from "../../js/plain-content.mjs";
import { ROOT, readJson } from "./env.mjs";

const run = promisify(execFile);
const root = fileURLToPath(ROOT);

// A copy of the files the script reads and writes, so the real index.html is never touched.
async function sandbox() {
  const dir = await mkdtemp(join(tmpdir(), "render-static-"));
  for (const d of ["scripts", "js", "data"]) await mkdir(join(dir, d));
  for (const f of ["scripts/render-static.mjs", "js/plain-content.mjs", "data/site.json", "index.html"]) await copyFile(join(root, f), join(dir, f));
  return dir;
}

test("index.html holds the document generated from site.json (what CI checks)", async () => {
  const { stdout } = await run("node", [join(root, "scripts/render-static.mjs"), "--check"]);
  assert.match(stdout, /matches/);
  const html = await readFile(join(root, "index.html"), "utf8");
  const block = html.slice(html.indexOf("<!-- static-content:start -->") + 29, html.indexOf("<!-- static-content:end -->"));
  assert.equal(block.trim(), plainContent(await readJson("data/site.json")).trim());
});

test("--check fails when the document is stale, and a plain run brings it up to date", async () => {
  const dir = await sandbox();
  try {
    const script = join(dir, "scripts/render-static.mjs");
    const site = JSON.parse(await readFile(join(dir, "data/site.json"), "utf8"));
    site.profile.intro = "A changed intro.";
    await writeFile(join(dir, "data/site.json"), JSON.stringify(site));
    await assert.rejects(run("node", [script, "--check"]), /stale/);
    await run("node", [script]);
    await run("node", [script, "--check"]);
    assert.match(await readFile(join(dir, "index.html"), "utf8"), /A changed intro\./);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("the script refuses an index.html without exactly one content block", async () => {
  const dir = await sandbox();
  try {
    const page = join(dir, "index.html");
    await writeFile(page, (await readFile(page, "utf8")).replace("<!-- static-content:end -->", ""));
    await assert.rejects(run("node", [join(dir, "scripts/render-static.mjs")]), /exactly one static content block/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
