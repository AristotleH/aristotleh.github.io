// js/ascii-text.js: ASCII-only text, wrapping, FIGlet banners and the card boxes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installBrowserEnv } from "./env.mjs";

installBrowserEnv();
const A = await import("../../js/ascii-text.js");
const { P, STOPS } = await import("../../js/site.js");

// The text a box line shows, without markup or the hidden plain copies of the banner.
const visible = html => html.replace(/<span class="a-plain">.*?<\/span>/g, "").replace(/<[^>]+>/g, "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const lines = html => [...html.matchAll(/<span class="ln[^"]*"[^>]*>([\s\S]*?)<\/span>(?=<span class="ln|$)/g)].map(m => m[0]);

test("toAscii keeps printable ASCII, maps common typography, drops accents, and marks the rest", () => {
  assert.equal(A.toAscii("Jul 2023 – present"), "Jul 2023 - present");
  assert.equal(A.toAscii("“quoted” it’s"), `"quoted" it's`);
  assert.equal(A.toAscii("Zürich café"), "Zurich cafe");
  assert.match(A.toAscii("東京"), /^\?+$/);
  for (const ch of A.toAscii("Any – “text” é 東")) assert.ok(ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) < 127);
});

test("wrap keeps every line within the width and every word, in order", () => {
  const text = "I develop and maintain the systems that give game developers access to the engine's functionality.";
  for (const w of [20, 44]) {
    const out = A.wrap(text, w);
    for (const l of out) assert.ok(l.length <= w, `"${l}" is over ${w}`);
    assert.equal(out.join(" "), text);
  }
  // A word longer than the line is broken rather than allowed to run past the border.
  const narrow = A.wrap(text, 12);
  for (const l of narrow) assert.ok(l.length <= 12);
  assert.equal(narrow.join("").replace(/ /g, ""), text.replace(/ /g, ""));
});

test("FIGlet rows are equal height and the banner says the name", () => {
  for (const font of ["standard", "small", "mini"]) {
    const rows = A.figlet("Aristotle", font);
    assert.ok(rows.length >= 2);
    assert.ok(rows.every(r => r === r.trimEnd()));
  }
});

test("the banner uses standard where it fits, scales it down a little on phones, and falls back when narrower", () => {
  const width = rows => Math.max(...rows.map(r => r.length));
  const desktop = A.banner(P.name, 54);
  assert.equal(desktop.scale, 1);
  assert.ok(width(desktop.rows) <= 54);
  const phone = A.banner(P.name, 43);   // a 393 px phone's box
  assert.ok(phone.scale < 1 && phone.scale >= 0.78, `scale ${phone.scale}`);
  assert.deepEqual(phone.rows, A.banner(P.name, 54).rows, "the same lettering as desktop");
  const narrow = A.banner(P.name, 33);  // a 320 px phone
  assert.ok(narrow.scale >= 0.78 && width(narrow.rows) * narrow.scale <= 33 + 1e-9);
  assert.equal(A.banner(P.name, 4).rows[0], A.toAscii(P.name).toUpperCase());
});

test("box lines are all the same width, so the borders line up", () => {
  const inner = 40;
  const html = A.boxHtml([[{ t: "short" }], [{ t: "x".repeat(60) }], "", [{ t: "link", href: "https://x.test" }]], inner);
  const widths = lines(html).map(l => visible(l).length);
  assert.ok(widths.length >= 6);
  assert.ok(widths.every(w => w === inner + 4), `widths ${widths}`);
});

test("a scaled banner row keeps full-size borders around a block the width of the box", () => {
  const html = A.boxHtml([{ tight: true, wide: true, scale: 0.85, segs: [{ t: "ABC", cls: "a-ink a-deco" }] }], 40);
  assert.match(html, /class="ln tight" style="font-size:0\.8500em"/);
  assert.match(html, /class="a-deco a-edge" aria-hidden="true" style="font-size:1\.1765em/);
  assert.match(html, /class="a-fit" style="width:[\d.]+px"/);
});

test("decoration is hidden from screen readers; the name has a plain copy for them", () => {
  const html = A.introBox(44);
  assert.match(html, /<span class="ln a-deco" aria-hidden="true">\+-+\+<\/span>/);
  assert.match(html, new RegExp(`<span class="a-plain">${P.name}</span>`));
  assert.match(html, /class="a-ink a-deco" aria-hidden="true"/);
});

test("stop boxes carry the title, dates and body, within the box", () => {
  const s = STOPS[0];
  const text = lines(A.stopBox(s, 44)).map(visible).join("\n");
  assert.match(text, new RegExp(A.toAscii(s.title), "i"));   // titles are in capitals
  assert.match(text, /Jul 2023 - present/);
  assert.match(text.replace(/\s*\|\s*\n\|\s*/g, " "), /I develop and maintain the systems/);
  assert.ok(text.split("\n").every(l => l.length === 48));
});
