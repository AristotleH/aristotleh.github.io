// The HTML view: the same data as a plain document, with no styling of its own.
import { KINDS, P, PROJECTS, PROJECTS_STEP, SITE, STOPS, esc, eyebrowOf, fmtMonth, projectsAt } from "./site.js";

export function renderPlain() {
  const el = document.getElementById("plain");
  const links = (P.links || []).map(l => `<a href="${esc(l.url)}">${esc(l.label)}</a>`).join(" | ");
  const stopHtml = s => {
    const head = `<h3>${esc(s.title)}</h3>\n<p><em>${esc(eyebrowOf(s))}</em></p>`;
    const own = projectsAt(s);
    const proj = own.length ? `\n<p>Projects: ${own.map(pr => `<a href="${esc(pr.path)}">${esc(pr.title)}</a>`).join(", ")}</p>` : "";
    if (KINDS[s.kind].card === "photo") {
      const img = s.photo.src ? `<img src="${esc(s.photo.src)}" alt="${esc(s.photo.alt || s.photo.caption)}" width="480">` : "";
      return `<article id="plain-${s.id}">${head}\n<figure>${img}<figcaption>${esc(s.photo.caption)}</figcaption></figure>${proj}</article>`;
    }
    return `<article id="plain-${s.id}">${head}
${s.role ? `<p><strong>${esc(s.role)}</strong></p>` : ""}
<p>${esc(s.body)}</p>
${s.tags && s.tags.length ? `<p>${s.tags.map(esc).join(", ")}</p>` : ""}${proj}</article>`;
  };
  // Same sections, in the same order, as the globe views.
  const sections = SITE.layout.map(b => {
    if (b.section === "projects") {
      if (!PROJECTS_STEP) return "";
      const list = PROJECTS.map(pr => `<li><a href="${esc(pr.path)}">${esc(pr.title)}</a>${pr.date ? ` (${esc(fmtMonth(pr.date))})` : ""}: ${esc(pr.summary)}</li>`).join("\n");
      return `<h2>${esc(PROJECTS_STEP.title)}</h2>\n<ul>\n${list}\n</ul>`;
    }
    return `<h2>${esc(b.label || "Experience and education")}</h2>\n${STOPS.map(stopHtml).join("\n<hr>\n")}`;
  }).filter(Boolean).join("\n<hr>\n");
  el.innerHTML = `<header>
<h1>${esc(P.name)}</h1>
<p>${esc(P.headline)}, ${esc(P.location)}</p>
<p>${esc(P.intro)}</p>
${links ? `<p>${links}</p>` : ""}
</header>
<hr>
${sections}`;
}
