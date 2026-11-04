import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import path from "node:path";

// Isolated real-component fixtures: no Next server, database or providers.
export default defineConfig({
  testDir: ".",
  testMatch: /(?:profile-client-forms|dialog-regressions)\.spec\.ts/,
  workers: 1, retries: 0, reporter: "line",
  outputDir: path.join(tmpdir(), "sowledger-profile-client-results"),
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
