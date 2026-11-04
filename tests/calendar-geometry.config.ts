import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import path from "node:path";

export default defineConfig({
  testDir: ".",
  testMatch: "calendar-geometry.spec.ts",
  workers: 1,
  retries: 0,
  reporter: "line",
  outputDir: path.join(tmpdir(), "sowledger-calendar-geometry-results"),
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], timezoneId: "America/New_York", viewport: { width: 1280, height: 1000 } } },
    { name: "webkit", use: { ...devices["Desktop Safari"], timezoneId: "America/New_York", viewport: { width: 1280, height: 1000 } } },
  ],
});
