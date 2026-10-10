import { defineConfig, devices } from "@playwright/test";

// Standalone, mocked component checks: no Next server, environment loading, or database fixtures.
export default defineConfig({
  testDir: ".",
  testMatch: "copy-regressions.spec.ts",
  workers: 1,
  reporter: "line",
  outputDir: "../test-results/copy-regressions",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
