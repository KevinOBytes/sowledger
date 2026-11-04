import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: "dashboard-calendar.spec.ts", workers: 1, reporter: "line",
  outputDir: "/private/tmp/sowledger-dashboard-calendar",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }, { name: "webkit", use: { ...devices["Desktop Safari"] } }],
});
