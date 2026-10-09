// Problems in data/site.json, as the page handles them: a bad stop is skipped and listed while previewing locally,
// and the rest of the site still works.
import { test, expect, open, hud, PHONE, siteData } from "./fixtures.mjs";

test.use(PHONE);

// Serves data/site.json changed by `edit`.
async function serveSite(page, edit) {
  const site = await siteData();
  edit(site);
  await page.route("**/data/site.json", route => route.fulfill({ json: site }));
  return site;
}

for (const mode of ["3d", "ascii", "html"]) {
  test(`${mode}: a stop with a mistake is skipped and listed, and the other stops still show`, async ({ page }) => {
    let bad;
    const site = await serveSite(page, s => { bad = s.stops[1]; bad.kind = "spaceship"; });
    await open(page, mode);
    await expect(page.locator("html")).toHaveAttribute("data-mode", mode);
    // Listed in the box, since the tests run on 127.0.0.1 (visitors see this only in the console).
    await expect(page.locator("#data-problems")).toBeVisible();
    await expect(page.locator("#data-problems")).toContainText("Some site data was skipped");
    await expect(page.locator("#data-problems li")).toContainText([new RegExp(bad.id)]);
    const others = site.stops.filter(s => s !== bad);
    if (mode === "html") {
      await expect(page.locator(`#plain-${bad.id}`)).toHaveCount(0);
      for (const s of others) await expect(page.locator(`#plain-${s.id}`)).toHaveCount(1);
    } else {
      await expect(page.locator(`#stop-${bad.id}`)).toHaveCount(0);
      for (const s of others) await expect(page.locator(`#stop-${s.id}`)).toHaveCount(1);
      // and the stop bar steps through the rest, in order
      const order = [...others].sort((a, b) => b.start.localeCompare(a.start));
      for (const s of order) {
        await page.locator("#next").tap();
        await expect.poll(async () => (await hud(page)).name).toBe(s.title);
      }
      expect((await hud(page)).next).toBe(false);
    }
  });
}

test("a mistake outside the stops stops the interactive views, with a notice, and shows the document", async ({ page, pageErrors }) => {
  await serveSite(page, s => { s.overview.view = "nowhere"; });   // the overview must name one of the views
  await open(page);
  await expect(page.locator("html")).toHaveAttribute("data-mode", "html");
  await expect(page.locator("#data-problems")).toContainText("Interactive views are unavailable");
  await expect(page.locator("#plain h1")).toBeVisible();
  pageErrors.length = 0;   // site.js stops the module graph by throwing; that's expected here
});
