// Entry point: builds the page, then shows the chosen view. Each view starts the first time it's shown and sleeps
// while another one is up.
import { MODE, useMode } from "./mode.js";
import { initPage, measure, renderHud, showInPlain, sizeHud, syncScrollZone, updateActive } from "./page.js";
import { globe } from "./globe.js";
import { renderBoxes } from "./ascii-text.js";
import { asciiGlobe } from "./ascii-globe.js";
import { renderPlain } from "./plain.js";
import { startTiles } from "./tiles-client.js";

// The globe's tiles take the longest to make, so in 3D their build starts now, alongside everything else.
if (MODE === "3d") startTiles();

// Resolves true once WebGL is up, or false if it can't be; the tiles go on building behind the cards. A build that
// fails before then rejects, so the view falls back; one that fails after leaves an empty globe, so the document
// is shown instead.
function startGlobe() {
  let shown = false;
  return new Promise((ready, fail) => {
    globe(() => { shown = true; ready(true); }).then(ok => ok || ready(false), error => {
      if (!shown) return fail(error);
      console.warn("The 3D globe failed to build; showing the HTML document.", error);
      if (MODE === "3d") setMode("html");
    });
  });
}

let globeStarted = false, asciiStarted = false, modeRequest = 0, globeJob;
async function setMode(m, explicit = false) {
  const request = ++modeRequest;
  useMode(m);
  document.documentElement.classList.remove("can-drag");
  try {
    if (m === "html") {
      renderPlain();
    } else if (m === "3d") {
      if (!globeStarted) {
        globeJob ||= startGlobe();
        const ready = await globeJob;
        if (request !== modeRequest) return;
        if (!ready) { await setMode("html", false); return; }
        globeStarted = true;
      }
      window.__resume3D?.();
    } else {
      if (!asciiStarted) { asciiGlobe(); asciiStarted = true; }
      renderBoxes();
      window.__resumeAscii();
    }
  } catch (error) {
    if (request !== modeRequest) return;
    console.warn("Interactive view unavailable; keeping the HTML document.", error);
    useMode("html");
    m = "html";
  }
  // Once startup falls back, keep the document in place instead of switching it
  // unexpectedly when a slow interactive view eventually finishes initializing.
  if (!explicit && m !== "html" && window.siteStartup?.mode === "html") {
    await setMode("html", false);
    return;
  }
  // Commit the view only after its initialization succeeds.
  const fromGlobe = document.documentElement.dataset.mode !== "html";
  document.documentElement.dataset.mode = m;
  document.getElementById("plain").hidden = m !== "html";
  window.siteStartup?.finish();
  for (const b of document.querySelectorAll(".modebar button")) b.setAttribute("aria-pressed", String(b.dataset.mode === m));
  if (explicit && fromGlobe && m === "html") showInPlain();
  syncScrollZone();
  renderHud();
  sizeHud();
  requestAnimationFrame(() => { measure(); updateActive(); });
}
for (const b of document.querySelectorAll(".modebar button")) b.addEventListener("click", () => setMode(b.dataset.mode, true));
document.fonts?.ready.then(() => { if (asciiStarted) { renderBoxes(); window.__asciiNeeds(); } });
initPage();
for (const selector of ["#globe", "#ascii-globe", "#labels", "#stops", ".hud", ".modebar"])
  document.querySelector(selector).hidden = false;
setMode(MODE, false);
