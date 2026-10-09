// A lost WebGL context (phones drop it under memory pressure): the globe rebuilds its tiles and draws again, and if
// it can't, the page shows the HTML document instead of a blank globe.
import { test, expect, open, globeDrawn, colours, DESKTOP, siteData } from "./fixtures.mjs";

test.use(DESKTOP);

// Loses the canvas's context, then restores it, as the browser does.
const loseAndRestore = page => page.evaluate(async () => {
  const c = document.getElementById("globe");
  const gl = c.getContext("webgl2") || c.getContext("webgl");   // the context the globe already made
  const ext = gl.getExtension("WEBGL_lose_context");
  ext.loseContext();
  await new Promise(r => setTimeout(r, 300));
  ext.restoreContext();
});

// Serves js/tiles-client.js with rebuildTiles() replaced, so a rebuild after a lost context fails as asked.
async function breakRebuild(page, body) {
  await page.route("**/js/tiles-client.js", async route => {
    const res = await route.fetch(), src = await res.text();
    const patched = src.replace(/export function rebuildTiles\(\) \{[^\n]*\}/, `export function rebuildTiles() { ${body} }`);
    expect(patched).not.toBe(src);
    await route.fulfill({ response: res, body: patched });
  });
}

test("after a lost context the globe draws again", async ({ page }) => {
  await open(page);
  await globeDrawn(page);
  await loseAndRestore(page);
  await expect(page.locator("html")).toHaveAttribute("data-mode", "3d");
  await globeDrawn(page);
  // and it still turns and zooms: the wheel changes the picture
  const before = await page.locator("#globe").screenshot();
  await page.mouse.move(900, 400);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -120);
  await expect.poll(async () => Buffer.compare(before, await page.locator("#globe").screenshot())).not.toBe(0);
});

test("close-up detail that arrives while the context is lost is kept for close-ups", async ({ page }) => {
  const warnings = [];
  page.on("console", m => { if (m.type() === "warning") warnings.push(m.text()); });
  // Hold the detail back 3 s, so it arrives while the context is gone.
  await page.route("**/js/tiles-client.js", async route => {
    const res = await route.fetch(), src = await res.text();
    const patched = src.replace("toDetail(data.DT);", "setTimeout(() => toDetail(data.DT), 3000);");
    expect(patched).not.toBe(src);
    await route.fulfill({ response: res, body: patched });
  });
  await open(page);
  await globeDrawn(page);
  await page.evaluate(async () => {
    const c = document.getElementById("globe"), gl = c.getContext("webgl2") || c.getContext("webgl");
    const ext = gl.getExtension("WEBGL_lose_context");
    ext.loseContext();
    await new Promise(r => setTimeout(r, 4000));
    ext.restoreContext();
  });
  await expect(page.locator("html")).toHaveAttribute("data-mode", "3d");
  await globeDrawn(page);
  expect(warnings.filter(w => w.includes("detail failed"))).toEqual([]);
});

test("if the tiles can't be rebuilt, the HTML document shows instead of a blank globe", async ({ page }) => {
  await breakRebuild(page, `return { globe: Promise.reject(new Error("test: no tiles")), detail: new Promise(() => {}) };`);
  await open(page);
  await globeDrawn(page);
  await loseAndRestore(page);
  await expect(page.locator("html")).toHaveAttribute("data-mode", "html");
  await expect(page.locator("#plain h1")).toBeVisible();
  // and 3D can't be chosen again into a globe that can't draw
  await page.locator('.modebar button[data-mode="3d"]').click();
  await page.waitForTimeout(500);
  await expect(page.locator("html")).toHaveAttribute("data-mode", "html");
});

test("if only the close-up detail can't be rebuilt, the globe carries on with its own tiles", async ({ page }) => {
  await breakRebuild(page, `const j = startTiles(); return { globe: j.globe, detail: Promise.reject(new Error("test: no detail")) };`);
  const warnings = [];
  page.on("console", m => { if (m.type() === "warning") warnings.push(m.text()); });
  const site = await siteData();
  const newest = [...site.stops].sort((a, b) => b.start.localeCompare(a.start))[0];   // in a detail region
  await open(page);
  await page.evaluate(id => document.getElementById(`stop-${id}`).scrollIntoView({ block: "center" }), newest.id);
  await expect.poll(() => page.evaluate(() => document.getElementById("hud-name").textContent)).toBe(newest.title);
  await page.waitForTimeout(4000);   // the camera arrives and the close-up detail loads
  await globeDrawn(page);
  await loseAndRestore(page);
  await expect.poll(() => warnings.some(w => w.includes("Close-up detail failed to rebuild"))).toBe(true);
  await expect(page.locator("html")).toHaveAttribute("data-mode", "3d");
  await globeDrawn(page);
  // no hole where the detail was: the middle of the view is drawn, not the background
  const shot = await page.locator("#globe").screenshot({ clip: { x: 540, y: 300, width: 200, height: 200 } });
  expect(await colours(shot)).toBeGreaterThan(20);
});
