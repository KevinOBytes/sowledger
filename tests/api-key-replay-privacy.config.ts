import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import path from "node:path";

// Root-owned browser execution only; no Next server, database or vendor access.
export default defineConfig({
  testDir: ".", testMatch: /api-key-replay-privacy\.spec\.ts/,
  workers: 1, retries: 0, reporter: "line",
  outputDir: path.join(tmpdir(), "sowledger-api-key-replay-results"),
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
