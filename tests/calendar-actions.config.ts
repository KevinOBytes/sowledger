import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import path from "node:path";

export default defineConfig({
  testDir: ".",
  testMatch: "calendar-actions.spec.ts",
  workers: 1,
  retries: 0,
  reporter: "line",
  outputDir: path.join(tmpdir(), "sowledger-calendar-action-results"),
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], timezoneId: "UTC" } },
    { name: "webkit", use: { ...devices["Desktop Safari"], timezoneId: "UTC" } },
  ],
});
