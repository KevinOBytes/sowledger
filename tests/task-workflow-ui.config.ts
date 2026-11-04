import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import path from "node:path";

export default defineConfig({
  testDir: ".", testMatch: /task-workflow-ui\.spec\.ts/, workers: 1, retries: 0, reporter: "line",
  outputDir: path.join(tmpdir(), "sowledger-task-workflow-results"),
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
