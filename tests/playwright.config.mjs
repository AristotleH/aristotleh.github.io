// Integration tests: the real page in headless Chromium, served from the repository root by server.mjs.
import { defineConfig } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  testDir: "./integration",
  // The globe draws with SwiftShader (software WebGL), which is slow; give loads room.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    browserName: "chromium",
    launchOptions: { args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `node server.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
  },
});
