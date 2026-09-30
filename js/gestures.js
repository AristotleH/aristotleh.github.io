// Overview zoom for both globes: the wheel (or a trackpad pinch) over the globe, or a two-finger pinch.
// z.log is added to the camera's log altitude; the page still scrolls from the name card, which sits above the globe,
// and the wheel still scrolls anywhere below the card's bottom edge.
import { SITE } from "./site.js";

export function zoomGestures(el, isActive, card) {
  const z = { log: 0, pinching: false }, pts = new Map();
  let pinch0 = 0, log0 = 0;
  const lim = () => [-Math.log(SITE.globe.camera.overviewZoom.in), Math.log(SITE.globe.camera.overviewZoom.out)];
  const clampLog = v => { const [a, b] = lim(); return Math.max(a, Math.min(b, v)); };
  const spread = () => { const [p, q] = [...pts.values()]; return Math.hypot(p.x - q.x, p.y - q.y) || 1; };
  el.addEventListener("wheel", e => {
    if (!isActive()) return;
    const box = card()?.getBoundingClientRect();
    if (box && box.height && e.clientY > box.bottom) return;
    e.preventDefault();
    const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1);
    z.log = clampLog(z.log + px * (e.ctrlKey ? 0.01 : 0.0015));
  }, { passive: false });
  // Registered before the drag handlers, so they can see z.pinching on the same event.
  el.addEventListener("pointerdown", e => {
    if (!isActive() || e.pointerType !== "touch") return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) { z.pinching = true; pinch0 = spread(); log0 = z.log; }
  });
  el.addEventListener("pointermove", e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (z.pinching && pts.size >= 2) z.log = clampLog(log0 - Math.log(spread() / pinch0));
  });
  // The pinch holds until every finger lifts, so the last finger doesn't jerk the globe around.
  const up = e => { pts.delete(e.pointerId); if (!pts.size) z.pinching = false; };
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  return z;
}
