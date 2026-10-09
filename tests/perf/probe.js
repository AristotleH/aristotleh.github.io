// Injected before the page's own scripts (page.addInitScript). It records, per animation frame:
// - the main-thread time spent in requestAnimationFrame callbacks (the views' frame loops),
// - the WebGL draw calls made in that frame and the vertices they submitted,
// and, for the whole page: long tasks, and when the globe first drew.
// window.__perf.mark() starts a measurement and window.__perf.stats() summarizes the frames since.
(() => {
  const P = window.__perf = {
    frames: [],        // { t, js, draws, verts } for each frame that ran a callback
    longTasks: [],     // { start, duration }
    firstDraw: null,   // ms since navigation of the first frame that drew a globe's worth of vertices (over 100k)
    firstAsciiRow: null,
  };
  let cur = null;
  const raf = window.requestAnimationFrame.bind(window);
  // All callbacks queued for one frame get the same timestamp; they're counted as one frame.
  window.requestAnimationFrame = cb => raf(t => {
    if (!cur || cur.t !== t) { cur = { t, js: 0, draws: 0, verts: 0 }; P.frames.push(cur); if (P.frames.length > 4000) P.frames.splice(0, 2000); }
    const s = performance.now();
    try { cb(t); } finally { cur.js += performance.now() - s; }
  });

  const count = (proto, name, vertsOf) => {
    const f = proto?.[name];
    if (!f) return;
    proto[name] = function (...a) {
      const v = vertsOf(a);
      if (cur) { cur.draws++; cur.verts += v; if (P.firstDraw === null && cur.verts > 100000) P.firstDraw = performance.now(); }
      return f.apply(this, a);
    };
  };
  for (const proto of [window.WebGL2RenderingContext?.prototype, window.WebGLRenderingContext?.prototype]) {
    count(proto, "drawElements", a => a[1]);
    count(proto, "drawArrays", a => a[2]);
    count(proto, "drawElementsInstanced", a => a[1] * a[4]);
    count(proto, "drawArraysInstanced", a => a[2] * a[3]);
  }
  try {
    new PerformanceObserver(l => { for (const e of l.getEntries()) P.longTasks.push({ start: e.startTime, duration: e.duration }); })
      .observe({ type: "longtask", buffered: true });
  } catch (e) {}
  // The first ASCII globe row on the page.
  new MutationObserver((_, obs) => {
    if (document.querySelector("#ascii-globe .a-row")) { P.firstAsciiRow = performance.now(); obs.disconnect(); }
  }).observe(document, { childList: true, subtree: true });

  // Statistics over the frames since `mark()`.
  let from = 0;
  P.mark = () => { from = performance.now(); };
  P.stats = () => {
    const fr = P.frames.filter(f => f.t >= from);
    const drew = fr.filter(f => f.draws > 0);
    const q = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
    const js = fr.map(f => f.js);
    const span = (performance.now() - from) / 1000;
    // Gaps between frames that drew (or, with no WebGL, all frames), as frame times.
    const shown = drew.length ? drew : fr;
    const gaps = shown.slice(1).map((f, i) => f.t - shown[i].t);
    return {
      seconds: +span.toFixed(2),
      frames: fr.length,
      drawnFrames: drew.length,
      fps: +(shown.length / span).toFixed(1),
      gapP50: +q(gaps, 0.5).toFixed(1), gapP95: +q(gaps, 0.95).toFixed(1), gapMax: +Math.max(0, ...gaps).toFixed(1),
      jsP50: +q(js, 0.5).toFixed(2), jsP95: +q(js, 0.95).toFixed(2), jsMax: +Math.max(0, ...js).toFixed(2),
      jsMean: +(js.reduce((a, b) => a + b, 0) / Math.max(1, js.length)).toFixed(2),
      drawsP50: q(drew.map(f => f.draws), 0.5), drawsMax: Math.max(0, ...drew.map(f => f.draws)),
      vertsP50: q(drew.map(f => f.verts), 0.5), vertsMax: Math.max(0, ...drew.map(f => f.verts)),
      longTasks: P.longTasks.filter(l => l.start >= from).map(l => Math.round(l.duration)),
    };
  };
})();
