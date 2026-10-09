// Starting the page: the default 3D view, the other views by URL, no JavaScript, and falling back to the HTML
// document when the interactive views can't start.
import { test, expect, open, globeDrawn, PHONE, DESKTOP, THREE_URL, siteData } from "./fixtures.mjs";

test.describe("on a phone", () => {
  test.use(PHONE);

  test("starts in 3D with the name card, the hint and a drawn globe", async ({ page }) => {
    await open(page);
    await expect(page.locator("html")).toHaveAttribute("data-mode", "3d");
    const site = await siteData();
    await expect(page.locator("#intro .card h1")).toHaveText(site.profile.name);
    await expect(page.locator(".drag-hint")).toHaveText("Try dragging and zooming the globe!");
    await expect(page.locator("#plain")).toBeHidden();
    await globeDrawn(page);
  });

  test("#ascii opens the ASCII view, with the name as a banner and a plain copy for screen readers", async ({ page }) => {
    await open(page, "ascii");
    await expect(page.locator("html")).toHaveAttribute("data-mode", "ascii");
    await expect(page.locator("#intro .abox .a-plain")).toHaveText((await siteData()).profile.name);
    await expect(page.locator("#ascii-globe .a-row").first()).toBeAttached();
    expect(await page.locator("#ascii-globe").innerText()).toMatch(/[*#%@]/);   // land is drawn
  });

  test("#html opens the plain document, and three.js isn't downloaded", async ({ page }) => {
    let threeRequested = false;
    page.on("request", r => { if (r.url() === THREE_URL) threeRequested = true; });
    await open(page, "html");
    await expect(page.locator("html")).toHaveAttribute("data-mode", "html");
    await expect(page.locator("#plain h1")).toBeVisible();
    await expect(page.locator("#stops")).toBeHidden();
    expect(threeRequested).toBe(false);
  });
});

test.describe("without JavaScript", () => {
  test.use({ ...PHONE, javaScriptEnabled: false });

  test("the document is there, with every stop", async ({ page }) => {
    await page.goto("/");
    const site = await siteData();
    await expect(page.locator("#plain h1")).toHaveText(site.profile.name);
    await expect(page.locator("#plain article")).toHaveCount(site.stops.length);
    for (const s of site.stops) await expect(page.locator(`#plain-${s.id} h3`)).toHaveText(s.title);
  });
});

test.describe("falling back to the HTML document", () => {
  test.use(DESKTOP);

  test("when three.js can't load", async ({ page }) => {
    await page.route(THREE_URL, r => r.abort());   // overrides the fixture's copy
    await open(page);
    await expect(page.locator("html")).toHaveAttribute("data-mode", "html");
    await expect(page.locator("#plain h1")).toBeVisible();
  });

  test("when site.json can't load, with a notice saying so", async ({ page, pageErrors }) => {
    await page.route("**/data/site.json", r => r.abort());
    await open(page);
    await expect(page.locator("html")).toHaveAttribute("data-mode", "html");
    await expect(page.locator("#data-problems")).toContainText("Interactive views are unavailable");
    await expect(page.locator("#plain h1")).toBeVisible();
    pageErrors.length = 0;   // site.js stops the module graph by throwing; that's expected here
  });

  test("when a module can't load", async ({ page }) => {
    await page.route("**/js/globe.js", r => r.abort());
    await open(page);
    await expect(page.locator("html")).toHaveAttribute("data-mode", "html");
  });

  test("but not when only the tile worker fails: the tiles are built on the page instead", async ({ page }) => {
    await page.route("**/js/tiles-worker.js", r => r.abort());
    await open(page);
    await expect(page.locator("html")).toHaveAttribute("data-mode", "3d");
    await globeDrawn(page);
  });

  test("the loading screen's link reads the document straight away", async ({ page }) => {
    await page.route(THREE_URL, () => {});   // three.js never arrives
    await page.route("**/data/site.json", () => {});   // nor does the data, so the loading screen stays up
    await page.goto("/");
    await page.getByRole("link", { name: "Read HTML" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-mode", "html");
    await expect(page.locator("#plain h1")).toBeVisible();
  });
});
