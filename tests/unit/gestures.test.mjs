// js/gestures.js: wheel and pinch zoom, driven through a fake element.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installBrowserEnv } from "./env.mjs";

installBrowserEnv();
globalThis.innerHeight = 800;
const { zoomGestures } = await import("../../js/gestures.js");
const { SITE } = await import("../../js/site.js");
const MIN = -Math.log(SITE.globe.camera.overviewZoom.in), MAX = Math.log(SITE.globe.camera.overviewZoom.out);

// An element that records listeners and pointer capture, and dispatches events to them.
function fakeElement() {
  const on = {}, captured = new Set();
  return {
    captured,
    addEventListener(type, fn) { (on[type] ||= []).push(fn); },
    setPointerCapture(id) { captured.add(id); },
    fire(type, props = {}) { const e = { preventDefault() { this.prevented = true; }, ...props }; for (const fn of on[type] || []) fn(e); return e; },
  };
}
const setup = (floor = () => -Infinity, cardBottom = 100) => {
  const el = fakeElement();
  const z = zoomGestures(el, () => true, () => ({ getBoundingClientRect: () => ({ bottom: cardBottom, height: 50 }) }), floor);
  return { el, z };
};
const touch = (el, type, id, x, y) => el.fire(type, { pointerId: id, pointerType: "touch", clientX: x, clientY: y });

test("the wheel over the globe zooms (and keeps the page still) but not below the name card", () => {
  const { el, z } = setup();
  const e = el.fire("wheel", { deltaY: -100, deltaMode: 0, clientY: 50 });
  assert.ok(e.prevented);
  assert.ok(z.log < 0);
  const below = el.fire("wheel", { deltaY: -100, deltaMode: 0, clientY: 150 });
  assert.ok(!below.prevented, "below the card the wheel scrolls the page");
});

test("zoom stops at the configured limits", () => {
  const { el, z } = setup();
  for (let i = 0; i < 500; i++) el.fire("wheel", { deltaY: -100, deltaMode: 0, clientY: 50 });
  assert.equal(z.log, MIN);
  for (let i = 0; i < 500; i++) el.fire("wheel", { deltaY: 100, deltaMode: 0, clientY: 50 });
  assert.equal(z.log, MAX);
});

test("zooming in stops at the view's floor instead of going past it (which made the view bounce)", () => {
  const floor = -1.2;
  const { el, z } = setup(() => floor);
  for (let i = 0; i < 200; i++) el.fire("wheel", { deltaY: -100, deltaMode: 0, clientY: 50 });
  assert.equal(z.log, floor);
});

test("below a floor that rose, a gesture can't go further down, but can come back up", () => {
  let floor = -Infinity;
  const { el, z } = setup(() => floor);
  for (let i = 0; i < 50; i++) el.fire("wheel", { deltaY: -100, deltaMode: 0, clientY: 50 });
  const deep = z.log;
  floor = deep + 1;   // panned away from detail: the floor is now above the view
  el.fire("wheel", { deltaY: -100, deltaMode: 0, clientY: 50 });
  assert.equal(z.log, deep);
  el.fire("wheel", { deltaY: 100, deltaMode: 0, clientY: 50 });
  assert.ok(z.log > deep);
});

test("a pinch zooms by the change in finger spread, and every finger is captured", () => {
  const { el, z } = setup();
  touch(el, "pointerdown", 1, 100, 100);
  touch(el, "pointerdown", 2, 200, 100);
  assert.ok(z.pinching);
  assert.deepEqual([...el.captured], [1, 2]);
  touch(el, "pointermove", 2, 300, 100);   // spread doubles
  assert.ok(Math.abs(z.log + Math.log(2)) < 1e-9);
});

test("a pinch ends when every finger lifts, however it lifts", () => {
  const { el, z } = setup();
  touch(el, "pointerdown", 1, 100, 100);
  touch(el, "pointerdown", 2, 200, 100);
  touch(el, "pointerup", 1, 100, 100);
  assert.ok(z.pinching, "one finger still down");
  touch(el, "lostpointercapture", 2, 0, 0);   // a lift that went elsewhere still ends it
  assert.ok(!z.pinching);
});

test("a pinch that hits a limit starts over from there, so pinching back answers at once", () => {
  const { el, z } = setup(() => -0.5);
  touch(el, "pointerdown", 1, 100, 100);
  touch(el, "pointerdown", 2, 110, 100);
  touch(el, "pointermove", 2, 400, 100);   // far past the floor
  assert.equal(z.log, -0.5);
  touch(el, "pointermove", 2, 380, 100);   // a little back
  assert.ok(z.log > -0.5);
});

test("nothing happens while the overview isn't showing", () => {
  const el = fakeElement();
  const z = zoomGestures(el, () => false, () => null);
  el.fire("wheel", { deltaY: -100, deltaMode: 0, clientY: 50 });
  touch(el, "pointerdown", 1, 100, 100);
  touch(el, "pointerdown", 2, 200, 100);
  assert.equal(z.log, 0);
  assert.ok(!z.pinching);
});
