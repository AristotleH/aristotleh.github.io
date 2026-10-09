// js/schema.js: the validator, the land-mask decoder, and checkSite's handling of good and bad data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, decodeMask, checkSite, SITE_SCHEMA } from "../../js/schema.js";
import { readJson, layerFiles } from "./env.mjs";

const site = await readJson("data/site.json");
const files = await layerFiles(site);
const clone = () => structuredClone(site);

// Encodes a 0/1 mask the way the land layers are stored: per row, alternating water/land runs as LEB128 varints.
function encodeMask(rows) {
  const out = [];
  const varint = n => { do { let b = n & 127; n >>>= 7; if (n) b |= 128; out.push(b); } while (n); };
  for (const row of rows) {
    let v = 0, run = 0;
    for (const cell of row) { if (cell === v) run++; else { varint(run); v ^= 1; run = 1; } }
    varint(run);
  }
  return new Uint8Array(out);
}

test("validate checks types, enums, patterns, lengths, required and unknown keys", () => {
  const schema = { type: "object", additionalProperties: false, required: ["a"], properties: {
    a: { type: "string", minLength: 1, pattern: "^x" }, b: { enum: ["p", "q"] }, c: { type: "array", minItems: 1, maxItems: 2 },
    d: { type: "integer", minimum: 0, maximum: 9 } } };
  assert.deepEqual(validate({ a: "xy", b: "p", c: [1], d: 3 }, schema), []);
  const errors = validate({ a: "", b: "z", c: [1, 2, 3], d: 2.5, e: 1 }, schema).join("\n");
  for (const bit of ["must not be empty", "must be one of p, q", "more than 2", "expected integer", "e"]) assert.match(errors, new RegExp(bit));
  assert.match(validate({}, schema).join(), /a/);
  assert.match(validate({ a: "y" }, schema).join(), /does not match/);
});

test("decodeMask reads the run-length land format and rejects bad rows", () => {
  const rows = [[0, 0, 1, 1, 1, 0], [1, 1, 1, 1, 1, 1], [0, 0, 0, 0, 0, 0]];
  assert.deepEqual([...decodeMask(encodeMask(rows), 6, 3)], rows.flat());
  assert.throws(() => decodeMask(encodeMask(rows), 5, 3), /longer than 5/);
  assert.throws(() => decodeMask(encodeMask(rows).slice(0, 2), 6, 3), /ends early/);
  assert.throws(() => decodeMask(new Error("404"), 6, 3), /can't be read/);
  // Long runs need more than one varint byte.
  const long = [Array(300).fill(0).concat(Array(500).fill(1))];
  assert.deepEqual([...decodeMask(encodeMask(long), 800, 1)], long[0]);
});

test("the real site.json and layers pass with no problems", () => {
  const checked = checkSite(clone(), files);
  assert.deepEqual(checked.errors, []);
  assert.equal(checked.site.stops.length, site.stops.length);
  assert.equal(checked.site.globe.mask.length, site.globe.layers.land.columns * site.globe.layers.land.rows);
});

test("a bad stop is dropped on its own, with a reason", () => {
  const raw = clone();
  raw.stops[1].kind = "nope";
  raw.stops[2].end = "1999-01";   // before its start
  const { errors, site: out } = checkSite(raw, files);
  assert.match(errors.join("\n"), /unknown kind "nope"/);
  assert.match(errors.join("\n"), /ends before it starts/);
  assert.equal(out.stops.length, site.stops.length - 2);
});

test("entry cards need start and body; photo cards need a source or a placeholder", () => {
  const raw = clone();
  delete raw.stops[0].body;
  raw.stops.push({ id: "pic", kind: "photo", title: "P", place: "X", lat: 0, lon: 0, view: "city", photo: { caption: "c" } });
  const { errors } = checkSite(raw, files);
  assert.match(errors.join("\n"), /an entry card needs "body"/);
  assert.match(errors.join("\n"), /a photo needs "src", or "placeholder": true/);
});

test("duplicate ids are reported", () => {
  const raw = clone();
  raw.stops.push({ ...raw.stops[0] });
  assert.match(checkSite(raw, files).errors.join("\n"), /duplicate id/);
});

test("problems outside the stops are fatal", () => {
  const raw = clone();
  raw.overview.view = "nowhere";
  const checked = checkSite(raw, files);
  assert.equal(checked.site, null);
  assert.match(checked.errors.join(), /unknown view "nowhere"/);
  const broken = clone();
  broken.profile.links = [{ label: "x", url: "http://insecure" }];
  assert.equal(checkSite(broken, files).site, null);
  const noMask = new Map(files);
  noMask.set(site.globe.layers.land.src, new Error("HTTP 404"));
  assert.equal(checkSite(clone(), noMask).site, null);
});

test("layout lists each section once and always has experience", () => {
  const raw = clone();
  raw.layout = [{ section: "projects" }];
  const checked = checkSite(raw, files);
  assert.match(checked.errors.join(), /needs an "experience" section/);
  assert.deepEqual(checked.site.layout.map(b => b.section), ["projects", "experience"]);
  const twice = clone();
  twice.layout = [{ section: "experience" }, { section: "experience" }];
  assert.match(checkSite(twice, files).errors.join(), /listed 2 times/);
});

test("the schema requires https links and lowercase ids", () => {
  const stop = SITE_SCHEMA.properties.stops.items;
  assert.deepEqual(validate({ ...site.stops[0] }, stop), []);
  assert.notDeepEqual(validate({ ...site.stops[0], id: "Bad Id" }, stop), []);
});
