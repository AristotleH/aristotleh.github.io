// Moving through the page: the stop bar's arrows, its ends, back to the top, switching views mid-page, and the pin
// label at the current stop.
import { test, expect, open, hud, PHONE, siteData } from "./fixtures.mjs";

test.use({ ...PHONE, contextOptions: { reducedMotion: "reduce" } });   // scrolling and the camera move at once, so steps settle quickly

const ordered = site => [...site.stops].sort((a, b) => b.start.localeCompare(a.start));

for (const mode of ["3d", "ascii"]) {
  test(`${mode}: the arrows step through every stop in order, and are disabled at the ends`, async ({ page }) => {
    const site = await siteData();
    await open(page, mode);
    expect(await hud(page)).toEqual({ name: site.profile.name, prev: false, next: true });
    for (const s of ordered(site)) {
      await page.locator("#next").tap();
      await expect.poll(async () => (await hud(page)).name).toBe(s.title);
    }
    expect(await hud(page)).toMatchObject({ prev: true, next: false });
    await page.locator("#prev").tap();
    await expect.poll(async () => (await hud(page)).name).toBe(ordered(site).at(-2).title);
  });
}

test("down on the last card doesn't move the page, even scrolled to the very bottom", async ({ page }) => {
  await open(page);
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(async () => (await hud(page)).next).toBe(false);
  const y = await page.evaluate(() => scrollY);
  await page.evaluate(() => document.getElementById("next").click());   // a disabled button ignores this, as it would a tap
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => scrollY)).toBe(y);
});

test("tapping the name in the stop bar goes back to the top", async ({ page }) => {
  await open(page);
  await page.locator("#next").tap();
  await page.locator("#next").tap();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await page.locator("#hud-top").tap();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
});

test("switching to HTML at a stop opens the document at that stop", async ({ page }) => {
  const site = await siteData();
  await open(page);
  const stop = ordered(site)[2];
  await page.evaluate(id => document.getElementById(`stop-${id}`).scrollIntoView({ block: "center" }), stop.id);
  await expect.poll(async () => (await hud(page)).name).toBe(stop.title);
  await page.locator('.modebar button[data-mode="html"]').tap();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "html");
  const top = await page.locator(`#plain-${stop.id}`).evaluate(el => el.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(0);
  expect(top).toBeLessThan(40);
});

test("at a stop, its pin label shows above its pin", async ({ page }) => {
  const site = await siteData();
  await open(page);
  const stop = ordered(site)[0];
  await page.evaluate(id => document.getElementById(`stop-${id}`).scrollIntoView({ block: "center" }), stop.id);
  // Wait for the label to be turned on and placed on screen (an element at zero opacity still counts as visible).
  const placed = () => page.evaluate(title => {
    const l = [...document.querySelectorAll("#labels .label.on")].find(e => e.textContent === title);
    if (!l || getComputedStyle(l).opacity < 0.9) return false;
    const r = l.getBoundingClientRect();
    return r.left > 0 && r.right < innerWidth && r.top > 0 && r.bottom < innerHeight;
  }, stop.title);
  await expect.poll(placed, { timeout: 30_000 }).toBe(true);
});
