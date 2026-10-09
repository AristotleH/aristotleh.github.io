// Layout on phones: the notch and home indicator (safe areas), the 3D globe's proportions after the window changed
// under another view, and the ASCII name card's box lining up.
import { test, expect, open, globeDrawn, PHONE, PHONE_LANDSCAPE } from "./fixtures.mjs";

// Emulates a notched phone's safe areas, before the page loads.
async function notch(page, insets) {
  const c = await page.context().newCDPSession(page);
  await c.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, left: 0, bottom: 0, right: 0, ...insets } });
}
const box = (page, sel) => page.locator(sel).first().evaluate(e => e.getBoundingClientRect().toJSON());
const switchTo = async (page, mode) => {
  await page.locator(`.modebar button[data-mode="${mode}"]`).tap();
  await expect(page.locator("html")).toHaveAttribute("data-mode", mode);
};

test.describe("in landscape, with the notch on the left", () => {
  test.use(PHONE_LANDSCAPE);
  const LEFT = 47, RIGHT = 47, BOTTOM = 21;
  test.beforeEach(({ page }) => notch(page, { left: LEFT, right: RIGHT, bottom: BOTTOM }));

  for (const mode of ["3d", "ascii", "html"]) {
    test(`${mode}: the view buttons, the stop bar and the content clear the notch and the home indicator`, async ({ page }) => {
      await open(page, mode);
      const W = PHONE_LANDSCAPE.viewport.width, H = PHONE_LANDSCAPE.viewport.height;
      const bar = await box(page, ".modebar");
      expect(bar.left).toBeGreaterThanOrEqual(LEFT + 16);
      if (mode === "html") {
        const h1 = await box(page, "#plain h1");
        expect(h1.left).toBeGreaterThanOrEqual(LEFT);
        expect(h1.right).toBeLessThanOrEqual(W - RIGHT);
      } else {
        const hud = await box(page, ".hud");
        expect(hud.left).toBeGreaterThanOrEqual(LEFT);
        expect(hud.right).toBeLessThanOrEqual(W - RIGHT);
        expect(hud.bottom).toBeLessThanOrEqual(H - BOTTOM);
        const card = await box(page, mode === "3d" ? "#intro .card" : "#intro .abox");
        expect(card.left).toBeGreaterThanOrEqual(LEFT);
        expect(card.right).toBeLessThanOrEqual(W - RIGHT);
      }
    });
  }

  test("3d: the globe still reaches the screen's edges, under the notch", async ({ page }) => {
    await open(page);
    const g = await box(page, "#globe");
    expect(g.left).toBe(0);
    expect(g.width).toBe(PHONE_LANDSCAPE.viewport.width);
  });
});

test.describe("in portrait, with the notch at the top", () => {
  test.use(PHONE);
  test.beforeEach(({ page }) => notch(page, { top: 59, bottom: 34 }));

  test("html: the document, buttons included, starts below the notch", async ({ page }) => {
    await open(page, "html");
    expect((await box(page, ".modebar")).top).toBeGreaterThanOrEqual(59);   // in the page's flow in this view
    expect((await box(page, "#plain")).top).toBeGreaterThanOrEqual(59);
  });

  test("3d: the view buttons sit below the notch, and the stop bar above the home indicator", async ({ page }) => {
    await open(page);
    expect((await box(page, ".modebar")).top).toBeGreaterThanOrEqual(59 + 14);
    expect((await box(page, ".hud")).bottom).toBeLessThanOrEqual(PHONE.viewport.height - 34);
  });
});

// The canvas's drawing buffer has the shape of the canvas on screen, so the globe isn't stretched.
const canvasShape = page => page.evaluate(() => {
  const c = document.getElementById("globe");
  return { buffer: c.width / c.height, screen: c.clientWidth / c.clientHeight };
});

test.describe("after the window changed under another view", () => {
  test.use(PHONE_LANDSCAPE);

  for (const other of ["html", "ascii"]) {
    test(`3d keeps its proportions after the phone turned while ${other} was showing`, async ({ page }) => {
      await open(page);
      await globeDrawn(page);
      await switchTo(page, other);
      await page.setViewportSize(PHONE.viewport);   // turned to portrait
      await page.waitForTimeout(300);
      await switchTo(page, "3d");
      await expect.poll(async () => { const s = await canvasShape(page); return Math.abs(s.buffer / s.screen - 1); }).toBeLessThan(0.02);
      await globeDrawn(page);
    });
  }
});

test.describe("the overview on a phone", () => {
  test.use(PHONE);

  for (const mode of ["3d", "ascii"]) {
    test(`${mode}: the name card stands just above the stop bar`, async ({ page }) => {
      await open(page, mode);
      const card = await box(page, mode === "3d" ? "#intro .card" : "#intro .abox"), hud = await box(page, ".hud");
      const gap = hud.top - card.bottom;
      expect(gap).toBeGreaterThanOrEqual(12);
      expect(gap).toBeLessThanOrEqual(20);
    });
  }

  test("it keeps its place while the page scrolls and the stop bar moves", async ({ page }) => {
    await open(page);
    const before = await page.locator("#intro").evaluate(e => e.getBoundingClientRect().height);
    await page.evaluate(() => scrollTo(0, 300));
    await page.setViewportSize({ width: PHONE.viewport.width, height: PHONE.viewport.height + 60 });   // toolbars collapse
    await page.waitForTimeout(200);
    expect(await page.locator("#intro").evaluate(e => e.getBoundingClientRect().height)).toBe(before);
  });
});

test.describe("the ASCII name card", () => {
  for (const width of [393, 320]) {
    test(`its box lines are all the same width at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await open(page, "ascii");
      // The width each line's text takes up (the lines are blocks, as wide as the card).
      const widths = await page.locator("#intro .abox .ln").evaluateAll(lines => lines.map(l => {
        const r = document.createRange();
        r.selectNodeContents(l);
        return r.getBoundingClientRect().width;
      }).filter(w => w > 0));
      expect(widths.length).toBeGreaterThan(4);
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1);
      // and the box fits on the screen
      expect((await box(page, "#intro .abox")).right).toBeLessThanOrEqual(width);
    });
  }
});
