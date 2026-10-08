// Overview zoom for both globes: the wheel (or a trackpad pinch) over the globe, or a two-finger pinch.
// z.log is added to the camera's log altitude; the page still scrolls from the name card, which sits above the globe,
// and the wheel still scrolls anywhere below the card's bottom edge.
import { SITE } from "./site.js";

// `floor()` is the lowest z.log the view allows right now (it changes as the globe turns); zooming in stops there
// instead of going past and being eased back each frame, which made the view bounce. Below it already (the floor rose
// as the globe turned), a gesture can't take the view further down; the view eases it back up on its own.
export function zoomGestures(el, isActive, card, floor = () => -Infinity) {
  const z = { log: 0, pinching: false }, pts = new Map();
  let pinch0 = 0, log0 = 0;
  const clampLog = v => {
    const lo = Math.max(-Math.log(SITE.globe.camera.overviewZoom.in), Math.min(z.log, floor()));
    return Math.max(lo, Math.min(Math.log(SITE.globe.camera.overviewZoom.out), v));
  };
  const spread = () => { const [p, q] = [...pts.values()]; return Math.hypot(p.x - q.x, p.y - q.y) || 1; };
  el.addEventListener("wheel", e => {
    if (!isActive()) return;
    const box = card()?.getBoundingClientRect();
    if (box && box.height && e.clientY > box.bottom) return;
    e.preventDefault();
    const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1);
    z.log = clampLog(z.log + px * (e.ctrlKey ? 0.01 : 0.0015));
  }, { passive: false });
  // Registered before the drag handlers, so they can see z.pinching on the same event. Each finger is captured to
  // `el`, so its moves and its lift reach `el` even when it slides over the name card, or the node under it is
  // replaced (the ASCII globe redraws its text every frame). A lift that went elsewhere would leave the finger
  // counted, and the pinch would never end: one-finger drags would zoom instead of pan.
  el.addEventListener("pointerdown", e => {
    if (!isActive() || e.pointerType !== "touch") return;
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) { z.pinching = true; pinch0 = spread(); log0 = z.log; }
  });
  el.addEventListener("pointermove", e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (z.pinching && pts.size >= 2) {
      const want = log0 - Math.log(spread() / pinch0);
      z.log = clampLog(want);
      // At a limit, start the pinch over from here, so pinching the other way answers at once.
      if (z.log !== want) { pinch0 = spread(); log0 = z.log; }
    }
  });
  // The pinch holds until every finger lifts, so the last finger doesn't jerk the globe around.
  const up = e => { pts.delete(e.pointerId); if (!pts.size) z.pinching = false; };
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("lostpointercapture", up);
  return z;
}
