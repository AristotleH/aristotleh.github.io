import { readFile, writeFile } from "node:fs/promises";
import { plainContent } from "../js/plain-content.mjs";

const root = new URL("../", import.meta.url);
const site = JSON.parse(await readFile(new URL("data/site.json", root), "utf8"));
const path = new URL("index.html", root);
const html = await readFile(path, "utf8");
const start = "<!-- static-content:start -->", end = "<!-- static-content:end -->";
if (html.split(start).length !== 2 || html.split(end).length !== 2)
  throw new Error("Expected exactly one static content block in index.html");
const rendered = html.slice(0, html.indexOf(start) + start.length) + "\n" +
  plainContent(site) + "\n" + html.slice(html.indexOf(end));
if (process.argv.includes("--check")) {
  if (rendered !== html) throw new Error("Static content is stale. Run node scripts/render-static.mjs");
  console.log("Static content matches data/site.json.");
} else {
  await writeFile(path, rendered);
  console.log("Updated the static document in index.html.");
}
