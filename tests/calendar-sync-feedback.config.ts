import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import path from "node:path";

// Controlled component fixtures only: no Next server, database, or provider calls.
export default defineConfig({
  testDir: ".",
  testMatch: "calendar-sync-feedback.spec.ts",
  workers: 1,
  retries: 0,
  reporter: "line",
  outputDir: path.join(tmpdir(), "sowledger-calendar-sync-feedback-results"),
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
