import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import path from "node:path";

// Real component, shared modal, and CSS; every request is intercepted locally.
export default defineConfig({
  testDir: ".", testMatch: "manual-time-dialog.spec.ts", workers: 1, retries: 0, reporter: "line",
  outputDir: path.join(tmpdir(), "sowledger-manual-time-dialog-results"),
  use: { timezoneId: "America/New_York" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
