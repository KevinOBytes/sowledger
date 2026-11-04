import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import path from "node:path";

export default defineConfig({
  testDir: ".",
  testMatch: "calendar-accessibility.spec.ts",
  workers: 1,
  retries: 0,
  expect: { timeout: 3000 },
  reporter: "line",
  outputDir: path.join(tmpdir(), "sowledger-calendar-accessibility-results"),
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
