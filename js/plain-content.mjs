// Pure document rendering, shared by the static generator and the browser's HTML view.
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtMonth = m => m === "present" ? "present" : `${MONTHS[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;

export function plainContent(SITE) {
  const P = SITE.profile, KINDS = SITE.kinds;
  const dateOf = s => s.start || s.date || s.photo?.taken || null;
  const ordered = items => {
    if (!SITE.order || SITE.order === "as-listed") return items;
    const dated = items.filter(dateOf), undated = items.filter(s => !dateOf(s));
    dated.sort((a, b) => SITE.order === "newest-first"
      ? dateOf(b).localeCompare(dateOf(a)) : dateOf(a).localeCompare(dateOf(b)));
    return [...dated, ...undated];
  };
  const STOPS = ordered(SITE.stops), PROJECTS = ordered(SITE.projects || []);
  const projectsAt = s => PROJECTS.filter(pr => pr.stop === s.id);
  const eyebrowOf = s => {
    if (KINDS[s.kind].card === "photo")
      return [s.photo.taken && fmtMonth(s.photo.taken), s.place].filter(Boolean).join(", ");
    const dates = s.end ? `${fmtMonth(s.start)} – ${fmtMonth(s.end)}` : fmtMonth(s.start);
    return `${dates}, ${s.place}`;
  };
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
  const layout = SITE.layout || [{ section: "projects" }, { section: "experience" }];
  const sections = layout.map(b => {
    if (b.section === "projects") {
      if (!PROJECTS.length) return "";
      const list = PROJECTS.map(pr => `<li><a href="${esc(pr.path)}">${esc(pr.title)}</a>${pr.date ? ` (${esc(fmtMonth(pr.date))})` : ""}: ${esc(pr.summary)}</li>`).join("\n");
      return `<h2 id="plain-projects">${esc(b.label || "Projects")}</h2>\n<ul>\n${list}\n</ul>`;
    }
    return `<h2>${esc(b.label || "Experience and education")}</h2>\n${STOPS.map(stopHtml).join("\n<hr>\n")}`;
  }).filter(Boolean).join("\n<hr>\n");
  return `<header>
<h1>${esc(P.name)}</h1>
<p>${esc(P.headline)}, ${esc(P.location)}</p>
<p>${esc(P.intro)}</p>
${links ? `<p>${links}</p>` : ""}
</header>
<hr>
${sections}`;
}
