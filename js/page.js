// The page: one section per step with its card (and an empty box the ASCII view fills), scroll tracking, and the
// stop bar.
import { ALL, INTRO, KINDS, MARKERS, P, PROJECTS, PROJECTS_STEP, SEQ, STOPS, esc, fmtMonth, eyebrowOf, projectsAt, reduceMotion } from "./site.js";
import { MODE } from "./mode.js";
import { toAscii } from "./ascii-text.js";

export const markHtml = shape => `<span class="mark${shape === "diamond" ? " diamond" : ""}"></span>`;
export const tagsHtml = tags => tags && tags.length ? `<p class="tags">${tags.map(esc).join(", ")}</p>` : "";
export function projectsCard(step) {
  const list = PROJECTS.map(pr => `<li>
  <a class="proj-link" href="${esc(pr.path)}"><span class="proj-title">${esc(pr.title)}</span>${pr.date ? `<span class="proj-date">${esc(fmtMonth(pr.date))}</span>` : ""}</a>
  <p class="body">${esc(pr.summary)}</p>${tagsHtml(pr.tags)}</li>`).join("");
  return `<article class="card"><h2>${esc(step.title)}</h2>
  <ul class="projects">${list}</ul></article>`;
}
export function cardOf(s) {
  if (s === PROJECTS_STEP) return projectsCard(s);
  const head = `<h2>${esc(s.title)}</h2><p class="eyebrow">${esc(eyebrowOf(s))}</p>`;
  let inner;
  if (KINDS[s.kind].card === "photo") {
    const media = s.photo.src
      ? `<img src="${esc(s.photo.src)}" alt="${esc(s.photo.alt || s.photo.caption)}">`
      : `<div class="photo-slot"><span>Photo goes here</span></div>`;
    inner = `<figure class="photo">${media}<figcaption class="body">${esc(s.photo.caption)}</figcaption></figure>`;
  } else {
    inner = `${s.role ? `<p class="role">${esc(s.role)}</p>` : ""}<p class="body">${esc(s.body)}</p>${tagsHtml(s.tags)}`;
  }
  const own = projectsAt(s);
  if (own.length) inner += `<p class="stop-projects">Projects: ${own.map(pr => `<a href="${esc(pr.path)}">${esc(pr.title)}</a>`).join(", ")}</p>`;
  return `<article class="card">${head}${inner}</article>`;
}
export let sections = [];

// ---------- Scroll tracking ----------
export let active = 0;
export function goTo(i) {
  i = Math.max(0, Math.min(ALL.length - 1, i));
  sections[i].scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "center" });
}
export const toTop = () => scrollTo({ top: 0, behavior: reduceMotion.matches ? "auto" : "smooth" });

// Section centres are measured once (and again when layout changes), so scrolling reads no layout.
export let centers = [];
export function measure() {
  centers = sections.map(el => { const r = el.getBoundingClientRect(); return r.top + scrollY + r.height / 2; });
}
// Sized from the name card's bottom edge to the bottom of the screen while a globe can be dragged.
export function syncScrollZone() {
  const zone = document.getElementById("scroll-zone");
  const drag = MODE === "3d" ? document.documentElement.classList.contains("can-drag")
    : MODE === "ascii" && document.getElementById("ascii-globe").classList.contains("can-drag");
  const card = drag && document.querySelector(MODE === "3d" ? "#intro .card" : "#intro .abox");
  const top = card ? Math.max(0, card.getBoundingClientRect().bottom) : innerHeight;
  zone.style.display = top < innerHeight ? "block" : "none";
  zone.style.top = top + "px";
}
export function updateActive() {
  syncScrollZone();
  const mid = scrollY + innerHeight / 2;
  let best = 0, bestD = Infinity;
  centers.forEach((c, i) => {
    const d = Math.abs(c - mid);
    if (d < bestD) { bestD = d; best = i; }
  });
  if (best !== active || !updateActive.done) {
    sections[active].classList.remove("active");
    active = best;
    sections[active].classList.add("active");
    renderHud();
    updateActive.done = true;
    if (window.onStopChange) window.onStopChange(active);
  }
}
// The name of the school or company on screen, or yours on the intro.
export function renderHud(i = active) {
  const s = ALL[i], ascii = MODE === "ascii";
  const name = s === INTRO ? P.name : s.title;
  document.getElementById("hud-name").textContent = ascii ? toAscii(name) : name;
  document.getElementById("prev").textContent = ascii ? "^" : "↑";
  document.getElementById("next").textContent = ascii ? "v" : "↓";
}
// One width for the stop bar: the widest it gets across all stops (in the current view mode), so it doesn't
// resize from stop to stop. Capped to the screen; a name that still doesn't fit ends in "...".
export function sizeHud() {
  const hudEl = document.querySelector(".hud");
  if (MODE === "html") return;
  hudEl.style.width = "auto";
  hudEl.style.maxWidth = "none";
  let widest = 0;
  for (let i = 0; i < ALL.length; i++) { renderHud(i); widest = Math.max(widest, hudEl.scrollWidth); }
  renderHud();
  hudEl.style.maxWidth = "";
  hudEl.style.width = innerWidth < 700 ? "" : `${Math.ceil(widest) + 2}px`;
}

// Fills in the profile, the intro card and one section per step, and starts tracking the scroll.
export function initPage() {
  document.title = P.name;
  const linksHtml = (P.links || []).map(l => `<a href="${esc(l.url)}">${esc(l.label)}</a>`).join("");
  // A legend only when there's more than one kind of pin to tell apart.
  const used = [...new Set(STOPS.map(s => KINDS[s.kind].marker))];
  const legend = used.length > 1
    ? `<ul class="legend">${used.map(m => `<li>${markHtml(MARKERS[m].shape)}${esc(MARKERS[m].legend)}</li>`).join("")}</ul>` : "";
  document.getElementById("intro").innerHTML = `<article class="card">
  <h1>${esc(P.name)}</h1>
  <p class="eyebrow">${esc(P.headline)}, ${esc(P.location)}</p>
  <p class="lede">${esc(P.intro)}</p>
  ${legend}
  ${linksHtml ? `<div class="links">${linksHtml}</div>` : ""}
  <p class="fallback hint">This browser can't draw the 3D globe, so the places are listed as text below.</p>
</article><pre class="abox"></pre>`;
  const main = document.getElementById("stops");
  SEQ.forEach((s, i) => {
    const sec = document.createElement("section");
    sec.className = "stop " + (i % 2 ? "side-right" : "side-left");
    sec.id = s.id;
    sec.innerHTML = cardOf(s) + `<pre class="abox"></pre>`;
    main.appendChild(sec);
  });
  sections = ALL.map(s => document.getElementById(s.id));

  document.getElementById("prev").onclick = () => goTo(active - 1);
  document.getElementById("next").onclick = () => goTo(active + 1);
  // Tapping the middle of the stop bar scrolls back to the top.
  const hudTop = document.getElementById("hud-top");
  hudTop.addEventListener("click", toTop);
  hudTop.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toTop(); } });

  addEventListener("resize", sizeHud);
  document.fonts?.ready.then(sizeHud);
  let scrollQueued = false;
  addEventListener("scroll", () => {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => { scrollQueued = false; updateActive(); });
  }, { passive: true });
  measure();
  updateActive();
  new ResizeObserver(() => { measure(); updateActive(); }).observe(main);
}
