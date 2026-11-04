import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".", testMatch: "calendar-date-ui.spec.ts", workers: 1,
  reporter: "line", outputDir: "/private/tmp/sowledger-calendar-date-ui",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
