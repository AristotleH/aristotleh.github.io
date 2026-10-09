// Performance tests (perf/perf.spec.mjs): one scenario at a time, so they don't compete for the CPU.
// PERF_BASE_URL measures another copy of the site instead, such as main checked out in a worktree and served on a
// second port (its results go to perf-results.json all the same).
import { defineConfig } from "@playwright/test";
import base from "./playwright.config.mjs";

export default defineConfig({
  ...base,
  testDir: "./perf",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  use: { ...base.use, ...(process.env.PERF_BASE_URL ? { baseURL: process.env.PERF_BASE_URL } : {}) },
});
