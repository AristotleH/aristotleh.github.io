// Entry point: builds the page, then shows the chosen view. Each view starts the first time it's shown and sleeps
// while another one is up.
import { MODE, useMode } from "./mode.js";
import { initPage, measure, renderHud, sizeHud, syncScrollZone, updateActive } from "./page.js";
import { globe } from "./globe.js";
import { renderBoxes } from "./ascii-text.js";
import { asciiGlobe } from "./ascii-globe.js";
import { renderPlain } from "./plain.js";

let globeStarted = false, asciiStarted = false;
function setMode(m, save) {
  useMode(m);
  document.documentElement.dataset.mode = m;
  document.documentElement.classList.remove("can-drag");
  syncScrollZone();
  for (const b of document.querySelectorAll(".modebar button")) b.setAttribute("aria-pressed", String(b.dataset.mode === m));
  if (save) try { localStorage.setItem("site-mode", m); } catch (e) {}
  document.getElementById("plain").hidden = m !== "html";
  if (m === "html") {
    renderPlain();
  } else if (m === "3d") {
    if (!globeStarted) { globeStarted = true; globe(); } else window.__resume3D && window.__resume3D();
  } else {
    if (!asciiStarted) { asciiStarted = true; asciiGlobe(); }
    renderBoxes();
    window.__resumeAscii();
  }
  renderHud();
  sizeHud();
  requestAnimationFrame(() => { measure(); updateActive(); });
}
for (const b of document.querySelectorAll(".modebar button")) b.addEventListener("click", () => setMode(b.dataset.mode, true));
document.fonts?.ready.then(() => { if (asciiStarted) { renderBoxes(); window.__asciiNeeds(); } });
initPage();
setMode(MODE, false);
