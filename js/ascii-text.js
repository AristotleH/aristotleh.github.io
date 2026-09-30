// The ASCII view's text: the same site drawn only with printable ASCII. Cards are boxes of + - |, the name is a
// FIGlet banner, and photos become character art. The globe itself is in ascii-globe.js.
import { KINDS, MARKERS, P, PROJECTS, PROJECTS_STEP, STOPS, esc, eyebrowOf, fmtMonth, projectsAt, shapeOf } from "./site.js";
import { FIGLET } from "./ascii-fonts.js";

// Printable ASCII only: common typography mapped, accents dropped, anything else becomes "?".
export function toAscii(s) {
  const map = { "–": "-", "—": "--", "·": "*", "’": "'", "‘": "'", "“": '"', "”": '"', "°": " deg", "…": "...", "×": "x", "•": "*", " ": " " };
  return String(s).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, c => map[c] ?? "?");
}
export const escHtml = s => s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// FIGlet horizontal smushing (controlled rules 1-5), so letters overlap by a column where strokes can merge.
export function smushChar(l, r, mode) {
  if (l === " ") return r;
  if (r === " ") return l;
  if (!(mode & 128)) return null;                                    // font only allows fitting
  const rules = mode & 63;
  if (!rules) return r;                                              // universal smushing: later glyph wins
  if (rules & 1 && l === r) return l;                                // 1: equal characters
  const U = "|/\\[]{}()<>";
  if (rules & 2 && l === "_" && U.includes(r)) return r;             // 2: underscore gives way
  if (rules & 2 && r === "_" && U.includes(l)) return l;
  const H = ["|", "/\\", "[]", "{}", "()", "<>"];                    // 3: hierarchy
  const cl = H.findIndex(c => c.includes(l)), cr = H.findIndex(c => c.includes(r));
  if (rules & 4 && cl >= 0 && cr >= 0 && cl !== cr) return cl > cr ? l : r;
  const pair = l + r;                                                // 4: opposite brackets
  if (rules & 8 && ["[]", "][", "{}", "}{", "()", ")("].includes(pair)) return "|";
  if (rules & 16 && pair === "/\\") return "|";                      // 5: big X
  if (rules & 16 && pair === "\\/") return "Y";
  if (rules & 16 && pair === "><") return "X";
  return null;
}
export function figlet(text, fontName) {
  const font = FIGLET[fontName], h = font.height;
  let rows = null;
  for (const ch of toAscii(text)) {
    const g = (font.glyphs[ch] || font.glyphs["?"]).slice();
    if (!rows) { rows = g; continue; }
    const width = Math.max(...rows.map(r => r.length));
    rows = rows.map(r => r.padEnd(width));
    const gw = Math.max(...g.map(r => r.length));
    let amt = gw;
    for (let r = 0; r < h; r++) {
      const L = rows[r], R = g[r].padEnd(gw);
      const trail = L.length - L.trimEnd().length, lead = R.length - R.trimStart().length;
      let a = trail + lead;
      const lc = L.trimEnd().slice(-1), rc = R.trimStart()[0];
      if (lc && rc && smushChar(lc, rc, font.smush) !== null) a += 1;
      amt = Math.min(amt, a);
    }
    amt = Math.min(amt, width);
    if (font.smush === 0) amt = 0;   // layout 0 in these fonts: letters keep their own spacing (full width)
    rows = rows.map((L, r) => {
      const R = g[r].padEnd(gw);
      let mid = "";
      for (let k = 0; k < amt; k++) {
        const lc = L[L.length - amt + k] ?? " ", rc = R[k] ?? " ";
        mid += smushChar(lc, rc, font.smush) ?? (rc === " " ? lc : rc);
      }
      return L.slice(0, L.length - amt) + mid + R.slice(amt);
    });
  }
  rows = rows || [""];
  while (rows.length && !rows[rows.length - 1].trim()) rows.pop();
  while (rows.length && !rows[0].trim()) rows.shift();   // drop empty rows above the letters too
  return rows.map(r => r.trimEnd());
}

// Banner that fits `width`: whole name, else one word per block. Tries "standard", then "cybermedium",
// "small" and "mini", else plain capitals.
export function banner(text, width) {
  for (const font of ["standard", "cybermedium", "small", "mini"]) {
    const whole = figlet(text, font);
    if (Math.max(...whole.map(r => r.length)) <= width) return whole;
    const words = text.split(/\s+/).map(w => figlet(w, font));
    if (words.every(b => Math.max(...b.map(r => r.length)) <= width)) return words.flatMap((b, i) => i ? ["", ...b] : b);
  }
  return [toAscii(text).toUpperCase()];
}
export function wrap(text, width) {
  const out = [];
  for (const para of toAscii(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= width) line += " " + word;
      else { out.push(line); line = word; }
      while (line.length > width) { out.push(line.slice(0, width)); line = line.slice(width); }
    }
    out.push(line);
  }
  return out;
}

// Box lines are arrays of segments { t: text, href?, cls? }, so links survive inside the <pre>.
// A line can also be { tight: true, segs } to sit closer to its neighbours (banner rows only join up when close).
// Each line is its own block, so line height can differ per line without breaking the columns.
export function boxHtml(lines, inner) {
  const edge = "+" + "-".repeat(inner + 2) + "+";
  const body = lines.map(line => {
    let segs = line, tight = false, wide = false;
    if (line && line.segs) { segs = line.segs; tight = !!line.tight; wide = !!line.wide; }
    if (typeof segs === "string") segs = [{ t: segs }];
    // Never wider than the box: trim from the end so the right border stays in its column.
    const width = wide ? inner + 2 : inner;
    let room = width;
    segs = segs.map(s => { const t = s.t.slice(0, Math.max(0, room)); room -= t.length; return { ...s, t }; });
    const len = segs.reduce((n, s) => n + s.t.length, 0);
    const html = segs.map(s => {
      const t = escHtml(s.t);
      const plain = s.plain ? `<span class="a-plain">${escHtml(s.plain)}</span>` : "";
      if (s.href) return plain + `<a href="${esc(s.href)}">${t}</a>`;
      return plain + (s.cls ? `<span class="${s.cls}">${t}</span>` : t);
    }).join("");
    const pad = " ".repeat(Math.max(0, width - len));
    const deco = t => `<span class="a-deco">${t}</span>`;
    return `<span class="ln${tight ? " tight" : ""}">${wide ? deco("|") + html + deco(pad + "|") : deco("| ") + html + deco(pad + " |")}</span>`;
  });
  return [`<span class="ln a-deco">${edge}</span>`, ...body, `<span class="ln a-deco">${edge}</span>`].join("");
}
export function asciiCoord(lat, lon) {
  return `${Math.abs(lat).toFixed(2)}${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(2)}${lon >= 0 ? "E" : "W"}`;
}
export const MARK = { cube: "@", diamond: "o" };

// Photo stops: the picture itself as ASCII art (brightness to characters), or a drawn frame when there is none.
export const ART_RAMP = " .:-=+*#%@";
export function photoArt(src, cols, rows) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const cv = document.createElement("canvas"), g = cv.getContext("2d");
        cv.width = cols; cv.height = rows;
        g.drawImage(img, 0, 0, cols, rows);
        const px = g.getImageData(0, 0, cols, rows).data, out = [];
        for (let y = 0; y < rows; y++) {
          let line = "";
          for (let x = 0; x < cols; x++) {
            const i = (y * cols + x) * 4, lum = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
            line += ART_RAMP[Math.min(ART_RAMP.length - 1, Math.floor((1 - lum) * ART_RAMP.length))];
          }
          out.push(line);
        }
        resolve(out);
      } catch (e) { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
export function placeholderArt(w) {
  const h = 7, out = [];
  for (let y = 0; y < h; y++) {
    let line = "";
    for (let x = 0; x < w; x++) {
      const hill = Math.round(3.2 + 1.6 * Math.sin(x / 5) + Math.sin(x / 2.3) * 0.6);
      if (y === 1 && x === w - 7) line += "()";
      else if (y === 1 && x === w - 6) continue;
      else if (y >= 5) line += (x + y) % 3 ? "~" : "-";
      else if (y === hill) line += x % 2 ? "/" : "\\";
      else if (y > hill) line += ":";
      else line += " ";
    }
    out.push(line.slice(0, w));
  }
  const label = " photo goes here ";
  const mid = out[3], at = Math.max(0, Math.floor((w - label.length) / 2));
  out[3] = mid.slice(0, at) + label + mid.slice(at + label.length);
  return out;
}

export let boxInner = 44;
export function measureBox() {
  const probe = document.getElementById("ascii-probe-card");
  const cw = probe.getBoundingClientRect().width / 10 || 7.8;
  const avail = Math.min(440, innerWidth - 32);
  boxInner = Math.max(20, Math.min(54, Math.floor(avail / cw) - 5));
}
export function introBox(inner) {
  const lines = [];
  for (const l of wrap(`${P.headline} * ${P.location}`.toUpperCase(), inner)) lines.push([{ t: l, cls: "a-dim" }]);
  lines.push("");
  let rows = banner(P.name, inner + 2);
  const indent = Math.min(...rows.filter(r => r.trim()).map(r => r.length - r.trimStart().length));
  rows = rows.map(r => r.slice(indent));
  const bw = Math.max(...rows.map(r => r.length));
  const lead = " ".repeat(Math.max(0, Math.floor((inner + 2 - bw) / 2)));
  // The banner art isn't selectable; a hidden plain copy of the name is what gets copied and read aloud.
  rows.forEach((r, i) => lines.push({ tight: true, wide: true,
    segs: [{ t: r ? lead + r : "", cls: "a-ink a-deco", plain: i === 0 ? P.name : "" }] }));
  lines.push("");
  lines.push(...wrap(P.intro, inner));
  lines.push("");
  const used = [...new Set(STOPS.map(s => KINDS[s.kind].marker))];
  const legend = [];
  used.forEach((m, i) => {
    if (i) legend.push({ t: "   " });
    legend.push({ t: MARK[MARKERS[m].shape], cls: "a-mk" }, { t: " " + toAscii(MARKERS[m].legend).toLowerCase() });
  });
  lines.push(legend);
  if (P.links && P.links.length) {
    lines.push("");
    const segs = [];
    P.links.forEach((l, i) => { if (i) segs.push({ t: "  " }); segs.push({ t: "[ " }, { t: toAscii(l.label), href: l.url }, { t: " ]" }); });
    lines.push(segs);
  }
  return boxHtml(lines, inner);
}
// Link rows like "[ Tide clock ]  [ Orbit ]", wrapped to the box.
export function linkRows(items, inner) {
  const rows = [];
  let row = [], len = 0;
  for (const it of items) {
    const t = toAscii(it.title), w = t.length + 4;
    if (row.length && len + 2 + w > inner) { rows.push(row); row = []; len = 0; }
    if (row.length) { row.push({ t: "  " }); len += 2; }
    row.push({ t: "[ " }, { t, href: it.path }, { t: " ]" }); len += w;
  }
  if (row.length) rows.push(row);
  return rows;
}
export function projectsBox(step, inner) {
  const lines = [];
  const count = `${PROJECTS.length} ${PROJECTS.length === 1 ? "PROJECT" : "PROJECTS"}`;
  lines.push([{ t: MARK.cube + " ", cls: "a-mk" }, { t: count, cls: "a-dim" }], "");
  for (const l of wrap(step.title.toUpperCase(), inner)) lines.push([{ t: l, cls: "a-ink" }]);
  lines.push([{ t: "=".repeat(Math.min(inner, toAscii(step.title).length)), cls: "a-dim a-deco" }]);
  for (const pr of PROJECTS) {
    lines.push("");
    const title = toAscii(pr.title), date = pr.date ? toAscii(fmtMonth(pr.date)).toUpperCase() : "";
    lines.push([{ t: "> " }, { t: title.slice(0, inner - 2), href: pr.path },
      ...(date && title.length + date.length + 3 <= inner ? [{ t: " ".repeat(inner - 2 - title.length - date.length) + date, cls: "a-dim" }] : [])]);
    lines.push(...wrap(pr.summary, inner - 2).map(l => "  " + l));
    if (pr.tags && pr.tags.length) lines.push(...wrap(pr.tags.map(t => `[${toAscii(t)}]`).join(" "), inner - 2).map(l => [{ t: "  " + l, cls: "a-dim" }]));
  }
  return boxHtml(lines, inner);
}
export function stopBox(s, inner, art) {
  const lines = [];
  wrap(eyebrowOf(s).toUpperCase(), inner - 2).forEach((l, i) =>
    lines.push([{ t: i ? "  " : MARK[shapeOf(s)] + " ", cls: "a-mk" }, { t: l, cls: "a-dim" }]));
  lines.push("");
  for (const l of wrap(s.title.toUpperCase(), inner)) lines.push([{ t: l, cls: "a-ink" }]);
  lines.push([{ t: "=".repeat(Math.min(inner, toAscii(s.title).length)), cls: "a-dim a-deco" }]);
  if (KINDS[s.kind].card === "photo") {
    lines.push("");
    const w = inner - 4, frame = art || placeholderArt(w);
    lines.push(".-" + "-".repeat(w) + "-.");
    for (const r of frame) lines.push("| " + r.padEnd(w).slice(0, w) + " |");
    lines.push("'-" + "-".repeat(w) + "-'");
    lines.push("", ...wrap(s.photo.caption, inner));
  } else {
    if (s.role) for (const l of wrap("> " + s.role, inner)) lines.push(l);
    lines.push("", ...wrap(s.body, inner));
    if (s.tags && s.tags.length) {
      lines.push("");
      let row = "";
      for (const t of s.tags.map(t => `[${toAscii(t)}]`)) {
        if (row && row.length + 1 + t.length > inner) { lines.push(row); row = t; }
        else row = row ? row + " " + t : t;
      }
      if (row) lines.push(row);
    }
  }
  const own = projectsAt(s);
  if (own.length) lines.push("", [{ t: "PROJECTS", cls: "a-dim" }], ...linkRows(own, inner));
  lines.push("");
  wrap(s.place, inner - 2).forEach((l, i) => lines.push([{ t: i ? "  " : "@ ", cls: "a-dim" }, { t: l, cls: "a-dim" }]));
  return boxHtml(lines, inner);
}
export const photoArtCache = new Map();
export function renderBoxes() {
  measureBox();
  document.querySelector("#intro .abox").innerHTML = introBox(boxInner);
  if (PROJECTS_STEP) document.querySelector("#projects .abox").innerHTML = projectsBox(PROJECTS_STEP, boxInner);
  for (const s of STOPS) {
    const pre = document.querySelector(`#${s.id} .abox`);
    const key = s.photo && s.photo.src ? `${s.photo.src}|${boxInner}` : null;
    pre.innerHTML = stopBox(s, boxInner, key && photoArtCache.get(key));
    if (key && !photoArtCache.has(key)) {
      photoArtCache.set(key, null);
      photoArt(s.photo.src, boxInner - 4, 12).then(art => { photoArtCache.set(key, art); if (art) pre.innerHTML = stopBox(s, boxInner, art); });
    }
  }
}
