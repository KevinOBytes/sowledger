import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import path from "node:path";

// These component fixtures never start Next or connect to a database.
export default defineConfig({
  testDir: ".",
  testMatch: "dialog-regressions.spec.ts",
  workers: 1,
  retries: 0,
  reporter: "line",
  outputDir: path.join(tmpdir(), "sowledger-dialog-test-results"),
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
