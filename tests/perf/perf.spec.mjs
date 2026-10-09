// Performance: frame rate and main-thread work per frame in each view, at phone and desktop sizes, while idle,
// dragging, zooming and flying between stops; and how long the page takes to show the globe.
//
// Phone scenarios run at 393x852 and three device pixels per CSS pixel, with the page's CPU slowed 4x (CDP
// Emulation.setCPUThrottlingRate), roughly a mid-range phone. WebGL runs on SwiftShader, so the GPU here is the test
// machine's CPU: draw calls and vertices per frame are counted exactly and are the budget for GPU work, while frame
// rates in 3D show the direction of a change more than what a phone does.
//
// Each scenario's numbers are written to perf-results.json (and attached to the report); summary.mjs tabulates them.
// Limits and targets are in budgets.mjs. PERF_REPORT_ONLY=1 records without checking the limits.
import { test, expect, open, globeDrawn, PHONE, DESKTOP, siteData } from "../integration/fixtures.mjs";
import { readFile, writeFile } from "node:fs/promises";
import { BUDGETS, meets } from "./budgets.mjs";

const PROBE = await readFile(new URL("./probe.js", import.meta.url), "utf8");
const RESULTS = new URL("../perf-results.json", import.meta.url);
const REPORT_ONLY = !!process.env.PERF_REPORT_ONLY;

test.describe.configure({ mode: "serial" });   // one at a time, so scenarios don't compete for the CPU

async function start(page, { cpu = 1 } = {}) {
  await page.addInitScript(PROBE);
  const c = await page.context().newCDPSession(page);
  if (cpu > 1) await c.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  return c;
}
const mark = page => page.evaluate(() => window.__perf.mark());
const stats = page => page.evaluate(() => window.__perf.stats());
const wait = (page, ms) => page.waitForTimeout(ms);

// A finger held on the globe and moved back and forth for `ms`, a move every 16 ms.
async function touchSwipe(c, page, ms, [x, y] = [196, 260], amp = 120) {
  const T = (type, pts) => c.send("Input.dispatchTouchEvent", { type, touchPoints: pts });
  await T("touchStart", [{ x, y, id: 1 }]);
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const ph = (Date.now() - t0) / 1000 * Math.PI;
    await T("touchMove", [{ x: x + Math.sin(ph) * amp, y: y + Math.sin(ph * 0.7) * amp * 0.3, id: 1 }]);
    await wait(page, 16);
  }
  await T("touchEnd", []);
}
async function mouseSwipe(page, ms, [x, y] = [900, 400], amp = 200) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const ph = (Date.now() - t0) / 1000 * Math.PI;
    await page.mouse.move(x + Math.sin(ph) * amp, y + Math.sin(ph * 0.7) * amp * 0.3);
    await wait(page, 16);
  }
  await page.mouse.up();
}
async function wheelZoom(page, ms, [x, y] = [900, 400]) {
  await page.mouse.move(x, y);
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const ph = (Date.now() - t0) / 1000 * Math.PI;
    await page.mouse.wheel(0, Math.sin(ph) > 0 ? -40 : 40);
    await wait(page, 16);
  }
}
const stopCount = async () => (await siteData()).stops.length;

const results = {};
test.afterAll(async () => {
  let all = {};
  try { all = JSON.parse(await readFile(RESULTS, "utf8")); } catch (e) {}
  await writeFile(RESULTS, JSON.stringify({ ...all, ...results }, null, 2) + "\n");
});

// Records a scenario's numbers and checks them against its limits (budgets.mjs). Every limit is checked, so one
// run reports all that are over.
async function check(name, s, info) {
  results[name] = s;
  await info.attach(name, { body: JSON.stringify(s, null, 2), contentType: "application/json" });
  console.log(name, JSON.stringify(s));
  const limit = BUDGETS[name]?.limit;
  if (REPORT_ONLY || !limit) return;
  for (const [metric, value] of Object.entries(limit))
    expect.soft(meets(s, metric, value), `${name}: ${metric.replace("min:", "")} is ${s[metric.replace("min:", "")]}, limit ${value}`).toBe(true);
}

// A phone at three device pixels per CSS pixel, as current iPhones and many Android phones are, with a 4x slower CPU.
const PHONE3 = { ...PHONE, deviceScaleFactor: 3 };
for (const [size, use, cpu] of [["phone", PHONE3, 4], ["desktop", DESKTOP, 1]]) {
  test.describe(`3D on a ${size}`, () => {
    test.use(use);

    test(`3d-${size}-load`, async ({ page }, info) => {
      await start(page, { cpu });
      await open(page);
      await globeDrawn(page);
      const s = await page.evaluate(() => ({ firstDraw: Math.round(window.__perf.firstDraw),
        longTasks: window.__perf.longTasks.map(l => Math.round(l.duration)) }));
      await check(`3d-${size}-load`, s, info);
    });

    test(`3d-${size}-idle`, async ({ page }, info) => {
      await start(page, { cpu });
      await open(page);
      await globeDrawn(page);
      await wait(page, 2000);
      await mark(page);
      await wait(page, 4000);
      await check(`3d-${size}-idle`, await stats(page), info);
    });

    test(`3d-${size}-drag`, async ({ page }, info) => {
      const c = await start(page, { cpu });
      await open(page);
      await globeDrawn(page);
      await wait(page, 2000);
      await mark(page);
      if (size === "phone") await touchSwipe(c, page, 4000); else await mouseSwipe(page, 4000);
      await check(`3d-${size}-drag`, await stats(page), info);
    });

    test(`3d-${size}-zoom`, async ({ page }, info) => {
      const c = await start(page, { cpu });
      await open(page);
      await globeDrawn(page);
      await wait(page, 2000);
      await mark(page);
      if (size === "phone") {
        // Pinch out and back in, twice.
        const T = (type, pts) => c.send("Input.dispatchTouchEvent", { type, touchPoints: pts });
        await T("touchStart", [{ x: 150, y: 260, id: 1 }, { x: 240, y: 260, id: 2 }]);
        const t0 = Date.now();
        while (Date.now() - t0 < 4000) {
          const s = 45 + Math.abs(Math.sin((Date.now() - t0) / 1000 * Math.PI / 2)) * 120;
          await T("touchMove", [{ x: 195 - s, y: 260, id: 1 }, { x: 195 + s, y: 260, id: 2 }]);
          await wait(page, 16);
        }
        await T("touchEnd", []);
      } else await wheelZoom(page, 4000);
      await check(`3d-${size}-zoom`, await stats(page), info);
    });

    test(`3d-${size}-flight`, async ({ page }, info) => {
      await start(page, { cpu });
      await open(page);
      await globeDrawn(page);
      await wait(page, 2000);
      await mark(page);
      // Through every stop, a flight each 2.5 s: overview to the Bay Area (close-up detail loads), then down the coast,
      // across the country and back.
      for (let i = 0, n = await stopCount(); i < n; i++) {
        await page.evaluate(() => document.getElementById("next").click());
        await wait(page, 2500);
      }
      await check(`3d-${size}-flight`, await stats(page), info);
    });
  });

  test.describe(`ASCII on a ${size}`, () => {
    test.use(use);

    test(`ascii-${size}-load`, async ({ page }, info) => {
      await start(page, { cpu });
      await open(page, "ascii");
      await page.waitForFunction(() => window.__perf.firstAsciiRow);
      const s = await page.evaluate(() => ({ firstRow: Math.round(window.__perf.firstAsciiRow),
        longTasks: window.__perf.longTasks.map(l => Math.round(l.duration)) }));
      await check(`ascii-${size}-load`, s, info);
    });

    test(`ascii-${size}-idle`, async ({ page }, info) => {
      await start(page, { cpu });
      await open(page, "ascii");
      await wait(page, 2000);
      await mark(page);
      await wait(page, 4000);
      await check(`ascii-${size}-idle`, await stats(page), info);
    });

    test(`ascii-${size}-drag`, async ({ page }, info) => {
      const c = await start(page, { cpu });
      await open(page, "ascii");
      await wait(page, 2000);
      await mark(page);
      if (size === "phone") await touchSwipe(c, page, 4000); else await mouseSwipe(page, 4000);
      await check(`ascii-${size}-drag`, await stats(page), info);
    });

    test(`ascii-${size}-flight`, async ({ page }, info) => {
      await start(page, { cpu });
      await open(page, "ascii");
      await wait(page, 2000);
      await mark(page);
      for (let i = 0, n = await stopCount(); i < n; i++) {
        await page.evaluate(() => document.getElementById("next").click());
        await wait(page, 2500);
      }
      await check(`ascii-${size}-flight`, await stats(page), info);
    });
  });
}
