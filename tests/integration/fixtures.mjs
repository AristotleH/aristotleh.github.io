// Shared setup for the integration tests.
// - three.js comes from the pinned npm copy instead of cdnjs, with the CORS header the integrity check needs, so the
//   tests don't depend on the network (the integrity hash itself is checked in unit/three-integrity.test.mjs).
// - Any uncaught error on the page fails the test.
import { test as base, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PNG } from "./png.mjs";

const THREE = await readFile(new URL("../node_modules/three/build/three.min.js", import.meta.url));
export const THREE_URL = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
export const PHONE = { viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true };
export const PHONE_LANDSCAPE = { viewport: { width: 852, height: 393 }, hasTouch: true, isMobile: true };
export const DESKTOP = { viewport: { width: 1280, height: 800 } };

export const test = base.extend({
  pageErrors: async ({}, use) => { await use([]); },
  page: async ({ page, pageErrors }, use) => {
    await page.route(THREE_URL, route => route.fulfill({
      body: THREE, contentType: "text/javascript", headers: { "access-control-allow-origin": "*" },
    }));
    page.on("pageerror", e => pageErrors.push(e.message));
    await use(page);
    expect(pageErrors, "uncaught errors on the page").toEqual([]);
  },
});
export { expect };

// Opens the page in a view and waits until that view is showing (the loading state is over).
export async function open(page, hash = "") {
  await page.goto(hash ? `/#${hash}` : "/");
  await expect(page.locator("html")).not.toHaveAttribute("data-startup", "pending");
  await page.waitForFunction(() => document.documentElement.dataset.mode);
}

// Waits until the 3D globe has drawn: the canvas shows many colours, not a flat background.
export async function globeDrawn(page) {
  await expect.poll(async () => colours(await page.locator("#globe").screenshot()), { timeout: 30_000 }).toBeGreaterThan(200);
}

// Distinct colours in a PNG screenshot, sampling every seventh pixel. A WebGL canvas can't be read back from the page
// (its drawing buffer isn't preserved), so the tests look at screenshots.
export async function colours(png) {
  const img = PNG.decode(png), seen = new Set();
  for (let i = 0; i < img.data.length; i += 4 * 7) seen.add((img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2]);
  return seen.size;
}

// The state the stop bar shows: the current stop's name and whether each arrow is enabled.
export const hud = page => page.evaluate(() => ({
  name: document.getElementById("hud-name").textContent,
  prev: !document.getElementById("prev").disabled,
  next: !document.getElementById("next").disabled,
}));

// The site's data, as the page sees it.
export const siteData = async () => JSON.parse(await readFile(new URL("../../data/site.json", import.meta.url), "utf8"));
