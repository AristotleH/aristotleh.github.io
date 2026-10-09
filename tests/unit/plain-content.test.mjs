// js/plain-content.mjs: the helpers every view shares, and the HTML document.
import { test } from "node:test";
import assert from "node:assert/strict";
import { esc, fmtMonth, ordered, eyebrowOf, profileLinks, plainContent, dateOf } from "../../js/plain-content.mjs";
import { readJson } from "./env.mjs";

const KINDS = { work: { card: "entry" }, photo: { card: "photo" } };

test("esc escapes the characters that matter in HTML text and attributes", () => {
  assert.equal(esc(`<a href="x">&</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  assert.equal(esc(42), "42");
});

test("fmtMonth formats YYYY-MM as a short month and year, and passes 'present' through", () => {
  assert.equal(fmtMonth("2023-07"), "Jul 2023");
  assert.equal(fmtMonth("2019-12"), "Dec 2019");
  assert.equal(fmtMonth("present"), "present");
});

test("dateOf takes start, then date, then the photo's date", () => {
  assert.equal(dateOf({ start: "2020-01", date: "2021-01" }), "2020-01");
  assert.equal(dateOf({ date: "2021-01" }), "2021-01");
  assert.equal(dateOf({ photo: { taken: "2022-05" } }), "2022-05");
  assert.equal(dateOf({}), null);
});

test("ordered sorts by date, keeps ties and undated items in listed order, and leaves as-listed alone", () => {
  const items = [{ id: "a", start: "2020-01" }, { id: "u1" }, { id: "b", start: "2022-01" }, { id: "c", start: "2020-01" }, { id: "u2" }];
  const ids = list => list.map(i => i.id).join(",");
  assert.equal(ids(ordered(items, "newest-first")), "b,a,c,u1,u2");
  assert.equal(ids(ordered(items, "oldest-first")), "a,c,b,u1,u2");
  assert.equal(ids(ordered(items, "as-listed")), "a,u1,b,c,u2");
  assert.equal(ids(ordered(items, undefined)), "a,u1,b,c,u2");
});

test("eyebrowOf shows dates then place, or a photo's month then place", () => {
  assert.equal(eyebrowOf({ kind: "work", start: "2023-07", end: "present", place: "San Mateo, California" }, KINDS),
    "Jul 2023 – present, San Mateo, California");
  assert.equal(eyebrowOf({ kind: "work", start: "2018-06", place: "Monterey" }, KINDS), "Jun 2018, Monterey");
  assert.equal(eyebrowOf({ kind: "photo", place: "Kyoto", photo: { taken: "2024-04" } }, KINDS), "Apr 2024, Kyoto");
  assert.equal(eyebrowOf({ kind: "photo", place: "Kyoto", photo: {} }, KINDS), "Kyoto");
});

test("profileLinks adds the resume only while it's shown", () => {
  const links = [{ label: "GitHub", url: "https://github.com/x" }];
  assert.deepEqual(profileLinks({ links }), links);
  assert.deepEqual(profileLinks({ links, resume: { path: "/r.pdf", show: false } }), links);
  assert.deepEqual(profileLinks({ links, resume: { path: "/r.pdf", show: true } }).at(-1), { label: "Resume", url: "/r.pdf" });
  assert.equal(profileLinks({ links, resume: { path: "/r.pdf", label: "CV", show: true } }).at(-1).label, "CV");
  assert.deepEqual(profileLinks({}), []);
});

test("plainContent writes every stop of the real data, in order, under the layout's headings", async () => {
  const site = await readJson("data/site.json");
  const html = plainContent(site);
  assert.match(html, new RegExp(`<h1>${site.profile.name}</h1>`));
  const ids = [...html.matchAll(/<article id="plain-([a-z0-9-]+)">/g)].map(m => m[1]);
  assert.deepEqual(ids, ordered(site.stops, site.order).map(s => s.id));
  const experience = site.layout.find(b => b.section === "experience");
  assert.match(html, new RegExp(`<h2>${experience.label}</h2>`));
});

test("plainContent leaves out an empty projects section and lists projects when there are some", async () => {
  const site = await readJson("data/site.json");
  assert.doesNotMatch(plainContent({ ...site, projects: [] }), /plain-projects/);
  const withProject = plainContent({ ...site, projects: [{ id: "p", title: "Tide clock", path: "/projects/p/", summary: "S", stop: site.stops[0].id }] });
  assert.match(withProject, /<h2 id="plain-projects">/);
  assert.match(withProject, /<a href="\/projects\/p\/">Tide clock<\/a>/);
  // The project is also linked from its stop.
  assert.match(withProject, new RegExp(`id="plain-${site.stops[0].id}"[\\s\\S]*?Projects: <a href="/projects/p/">`));
});

test("plainContent escapes content and skips a missing role", async () => {
  const site = await readJson("data/site.json");
  const stop = { ...site.stops[0], title: "<script>x</script>", role: null };
  const html = plainContent({ ...site, stops: [stop] });
  assert.doesNotMatch(html, /<script>x/);
  assert.match(html, /&lt;script&gt;x/);
  assert.doesNotMatch(html.slice(html.indexOf(`plain-${stop.id}`)), /<strong>/);
});
