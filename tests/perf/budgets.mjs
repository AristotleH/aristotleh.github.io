// Budgets for perf.spec.mjs, per scenario and metric (the metrics are described in probe.js and perf.spec.mjs).
//
// - `limit`: the run fails past it. Set with room for a slower CI machine, but well beyond where main was.
// - `target`: where we're trying to get. Reported in the summary (summary.mjs), not enforced; raise `limit` toward
//   it as changes get there.
//
// A metric named "min:x" is a floor on x (frame rates); every other metric is a ceiling. vertsP50 and drawsP50
// count the vertices (indices) and draw calls WebGL is asked for per frame: they don't depend on the machine, so
// their limits are tight.
//
// Measured on this branch (SwiftShader, 4 cores; phone = 393x852 at DPR 3 with the CPU slowed 4x), against main:
//   3D phone overview 8-9 fps (main 5.4), desktop overview 9 fps (6.1); ASCII phone flights 54 fps (41).
// The 3D phone numbers include 4x multisampling at DPR 3, which SwiftShader does in software and a phone's GPU does
// cheaply. That leaves their frame rates within noise of main's, so their limits only catch large regressions; the
// draw-call and vertex limits are what hold the gain.
export const BUDGETS = {
  "3d-phone-load": { limit: { firstDraw: 1400 }, target: { firstDraw: 600 } },
  "3d-desktop-load": { limit: { firstDraw: 800 }, target: { firstDraw: 300 } },

  "3d-phone-idle": { limit: { "min:fps": 4, jsP95: 10, drawsP50: 50, vertsP50: 300000 }, target: { "min:fps": 30, jsP95: 4, vertsP50: 150000 } },
  "3d-phone-drag": { limit: { "min:fps": 4, jsP95: 10, drawsP50: 50, vertsP50: 310000 }, target: { "min:fps": 30, jsP95: 4 } },
  "3d-phone-zoom": { limit: { "min:fps": 6, jsP95: 10, drawsP50: 50 }, target: { "min:fps": 30, jsP95: 4 } },
  "3d-phone-flight": { limit: { "min:fps": 6, jsP95: 10, jsMax: 60 }, target: { "min:fps": 30, gapMax: 100 } },
  "3d-desktop-idle": { limit: { "min:fps": 7, jsP95: 4, drawsP50: 48, vertsP50: 270000 }, target: { "min:fps": 20, vertsP50: 150000 } },
  "3d-desktop-drag": { limit: { "min:fps": 7, jsP95: 4, drawsP50: 48, vertsP50: 270000 }, target: { "min:fps": 20 } },
  "3d-desktop-zoom": { limit: { "min:fps": 7, jsP95: 4, drawsP50: 48 }, target: { "min:fps": 20 } },
  "3d-desktop-flight": { limit: { "min:fps": 5.5, jsP95: 4, jsMax: 30 }, target: { "min:fps": 15, gapMax: 100 } },

  "ascii-phone-load": { limit: { firstRow: 800 }, target: { firstRow: 300 } },
  "ascii-desktop-load": { limit: { firstRow: 300 }, target: { firstRow: 100 } },
  "ascii-phone-idle": { limit: { "min:fps": 48, jsP95: 11 }, target: { "min:fps": 59, jsP95: 5, jsMax: 16 } },
  "ascii-phone-drag": { limit: { "min:fps": 48, jsP95: 13 }, target: { "min:fps": 59, jsP95: 6, jsMax: 16 } },
  "ascii-phone-flight": { limit: { "min:fps": 45, jsP95: 18 }, target: { "min:fps": 59, jsP95: 8, jsMax: 16 } },
  "ascii-desktop-idle": { limit: { "min:fps": 57, jsP95: 5 }, target: { "min:fps": 60, jsP95: 2 } },
  "ascii-desktop-drag": { limit: { "min:fps": 57, jsP95: 5 }, target: { "min:fps": 60, jsP95: 2 } },
  "ascii-desktop-flight": { limit: { "min:fps": 57, jsP95: 10 }, target: { "min:fps": 60, jsP95: 4, jsMax: 8 } },
};

// [metric, limit-or-target value] -> whether the measured value meets it.
export function meets(results, metric, value) {
  if (metric.startsWith("min:")) return results[metric.slice(4)] >= value;
  return results[metric] <= value;
}
