// Dragging, zooming and scrolling on the overview, in both globe views, and what the ASCII globe draws as it turns.
import { test, expect, open, globeDrawn, PHONE, DESKTOP } from "./fixtures.mjs";

const touchDrag = async (page, from, to, steps = 10) => {
  const c = await page.context().newCDPSession(page);
  const T = (type, pts) => c.send("Input.dispatchTouchEvent", { type, touchPoints: pts });
  await T("touchStart", [{ x: from[0], y: from[1], id: 1 }]);
  for (let i = 1; i <= steps; i++) {
    await T("touchMove", [{ x: from[0] + (to[0] - from[0]) * i / steps, y: from[1] + (to[1] - from[1]) * i / steps, id: 1 }]);
    await page.waitForTimeout(30);
  }
  await T("touchEnd", []);
};
const scrollY = page => page.evaluate(() => scrollY);
const globeShot = page => page.screenshot({ clip: { x: 0, y: 80, width: 393, height: 300 } });

// The ASCII globe's characters, row by row, and how many are outline (whose count follows the globe's size).
const asciiGrid = page => page.evaluate(() => ({
  rows: [...document.querySelectorAll("#ascii-globe .a-row")].map(r => r.textContent),
  outline: [...document.querySelectorAll("#ascii-globe .a-rim")].reduce((n, s) => n + s.textContent.length, 0),
}));
// Waits until the ASCII globe stops changing and returns its rows. The elevation data arrives after the first frames
// and changes the land's characters, and with reduced motion nothing else moves the globe.
async function settledRows(page) {
  let prev = null;
  for (;;) {
    const rows = (await asciiGrid(page)).rows, key = rows.join("\n");
    if (key === prev) return rows;
    prev = key;
    await page.waitForTimeout(400);
  }
}

// How the land characters near the middle of the globe moved between two grids: the shift (dx columns, dy rows) at
// which most of them reappear, the share that do, and the share that stayed put. Near the middle a small turn moves
// everything by about the same amount, so the glyphs line up again at that shift; glyphs fixed to the screen would
// line up best unshifted.
function landShift(before, after) {
  // The globe's rows run from the top of its outline to the bottom (the grid also covers the screen below it).
  const edge = before.map((row, j) => /--/.test(row) ? j : -1).filter(j => j >= 0);
  const cy = (edge[0] + edge.at(-1)) / 2, r = (edge.at(-1) - edge[0]) / 2, cx = before[0].length / 2;
  const LAND = "*#%@^";
  const score = (dx, dy) => {
    let land = 0, same = 0;
    before.forEach((row, j) => { if (Math.abs(j - cy) > r / 2) return; for (let i = 0; i < row.length; i++) {
      if (Math.abs(i - cx) > r * 0.75 || !LAND.includes(row[i])) continue;
      land++; if (after[j + dy]?.[i + dx] === row[i]) same++;
    } });
    expect(land).toBeGreaterThan(100);
    return same / land;
  };
  let best = { f: -1 };
  for (let dy = -2; dy <= 2; dy++) for (let dx = -8; dx <= 8; dx++) { const f = score(dx, dy); if (f > best.f) best = { dx, dy, f }; }
  return { ...best, unshifted: score(0, 0) };
}

test.describe("on a phone", () => {
  test.use({ ...PHONE, contextOptions: { reducedMotion: "reduce" } });

  for (const mode of ["3d", "ascii"]) {
    test(`${mode}: a swipe on the globe turns it without scrolling; a swipe on the card scrolls`, async ({ page }) => {
      await open(page, mode);
      if (mode === "3d") await globeDrawn(page);
      const before = await globeShot(page);
      await touchDrag(page, [200, 200], [320, 160]);
      await page.waitForTimeout(600);
      expect(await scrollY(page)).toBe(0);
      expect(Buffer.compare(before, await globeShot(page))).not.toBe(0);
      const card = await page.locator(mode === "3d" ? "#intro .card" : "#intro .abox").boundingBox();
      await touchDrag(page, [card.x + 60, card.y + 60], [card.x + 60, card.y - 140]);
      await expect.poll(() => scrollY(page)).toBeGreaterThan(50);
    });
  }

  test("ascii: after a pinch that ends over the name card, one finger pans instead of zooming", async ({ page }) => {
    await open(page, "ascii");
    const c = await page.context().newCDPSession(page);
    const T = (type, pts) => c.send("Input.dispatchTouchEvent", { type, touchPoints: pts });
    const card = await page.locator("#intro .abox").boundingBox();
    // Pinch, sliding the lower finger onto the name card while both are down, so the globe redraws (and replaces the
    // text under the fingers) during the pinch; the finger spread shrinks a little, so the globe zooms out and its
    // outline stays on screen. Then lift the finger on the card, and the one on the globe.
    const to = [card.x + 40, card.y + 30];
    await T("touchStart", [{ x: 200, y: 150, id: 1 }, { x: 200, y: 330, id: 2 }]);
    for (let i = 1; i <= 10; i++) {
      await T("touchMove", [{ x: 200 - i * 10, y: 150 + i * 18, id: 1 }, { x: 200 + (to[0] - 200) * i / 10, y: 330 + (to[1] - 330) * i / 10, id: 2 }]);
      await page.waitForTimeout(40);
    }
    await T("touchEnd", [{ x: 100, y: 330, id: 1 }]);
    await T("touchEnd", []);
    const before = await settledRows(page), outline = (await asciiGrid(page)).outline;
    await touchDrag(page, [150, 300], [210, 300], 6);
    const after = await settledRows(page);
    // The globe turned with the finger (a pinch left hanging blocks the drag)...
    const m = landShift(before, after);
    expect(m.dx).toBeGreaterThan(0);
    expect(m.f).toBeGreaterThan(0.75);
    // ...and didn't zoom: the outline, whose length follows the globe's size, is about the same.
    expect(Math.abs((await asciiGrid(page)).outline - outline) / outline).toBeLessThan(0.05);
  });

  test("ascii: the characters move with the globe as it turns, not stay on the screen", async ({ page }) => {
    await open(page, "ascii");
    const before = await settledRows(page);
    await touchDrag(page, [150, 300], [210, 300], 6);   // turns the globe about 7 degrees
    const after = await settledRows(page);
    const m = landShift(before, after);
    expect(m.dx).toBeGreaterThan(0);   // dragged right, so the surface moved right
    expect(m.f).toBeGreaterThan(0.75);
    expect(m.unshifted).toBeLessThan(m.f - 0.2);
  });

  test("ascii: turning the globe there and back draws the same characters", async ({ page }) => {
    await open(page, "ascii");
    const start = (await settledRows(page)).join("\n");
    await touchDrag(page, [150, 300], [230, 300], 8);
    await page.waitForTimeout(400);
    expect((await asciiGrid(page)).rows.join("\n")).not.toBe(start);
    await touchDrag(page, [230, 300], [150, 300], 8);
    const back = (await settledRows(page)).join("\n");
    let same = 0;
    for (let i = 0; i < start.length; i++) if (back[i] === start[i]) same++;
    expect(same / start.length).toBeGreaterThan(0.98);
  });

  test("ascii: pin groups don't change as the globe turns", async ({ page }) => {
    await open(page, "ascii");
    const groups = async () => ((await asciiGrid(page)).rows.join("\n").match(/\(\d+\)/g) || []).sort();
    const start = await groups();
    expect(start.length).toBeGreaterThan(0);   // the Bay Area pins are grouped on the overview
    for (let k = 0; k < 4; k++) {
      await touchDrag(page, [140, 220], [200, 220], 6);
      await page.waitForTimeout(500);
      const now = await groups();
      if (now.length) expect(now).toEqual(start);   // a group may turn out of sight, but never splits or merges
    }
  });
});

test.describe("on a desktop", () => {
  test.use({ ...DESKTOP, contextOptions: { reducedMotion: "reduce" } });

  for (const mode of ["3d", "ascii"]) {
    test(`${mode}: the wheel zooms the globe, and scrolls the page over the name card and below it`, async ({ page }) => {
      await open(page, mode);
      if (mode === "3d") await globeDrawn(page);
      await page.mouse.move(900, 400);
      for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -120);
      await page.waitForTimeout(500);
      expect(await scrollY(page)).toBe(0);
      const card = await page.locator(mode === "3d" ? "#intro .card" : "#intro .abox").boundingBox();
      await page.mouse.move(card.x + 50, card.y + 50);
      await page.mouse.wheel(0, 300);
      await expect.poll(() => scrollY(page)).toBeGreaterThan(0);
    });
  }
});
