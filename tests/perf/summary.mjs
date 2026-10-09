// Prints perf-results.json against the budgets as a Markdown table (for the GitHub job summary, or a terminal):
// each metric with a limit or target, its value, and whether it meets them. node perf/summary.mjs [results.json]
import { readFile } from "node:fs/promises";
import { BUDGETS, meets } from "./budgets.mjs";

const file = process.argv[2] || new URL("../perf-results.json", import.meta.url);
const results = JSON.parse(await readFile(file, "utf8"));
const lines = ["| Scenario | Metric | Value | Limit | Target |", "| --- | --- | ---: | ---: | ---: |"];
let over = 0, toGo = 0;
for (const [name, r] of Object.entries(results)) {
  const { limit = {}, target = {} } = BUDGETS[name] || {};
  for (const metric of new Set([...Object.keys(limit), ...Object.keys(target)])) {
    const key = metric.replace("min:", ""), floor = metric.startsWith("min:") ? "≥ " : "≤ ";
    const okLimit = !(metric in limit) || meets(r, metric, limit[metric]), okTarget = !(metric in target) || meets(r, metric, target[metric]);
    if (!okLimit) over++;
    if (!okTarget) toGo++;
    const show = (v, ok) => v === undefined ? "" : `${floor}${v} ${ok ? "✓" : "✗"}`;
    lines.push(`| ${name} | ${key} | ${r[key]} | ${show(limit[metric], okLimit)} | ${show(target[metric], okTarget)} |`);
  }
}
console.log(`### Performance\n\n${over ? `${over} over their limit` : "All within their limits"}; ${toGo} short of their target.\n`);
console.log(lines.join("\n"));
