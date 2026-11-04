import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import path from "node:path";
export default defineConfig({ testDir: ".", testMatch: /tag-settings-ui\.spec\.ts/, workers: 1, retries: 0, reporter: "line", timeout: 15_000, outputDir: path.join(tmpdir(), "sowledger-tag-settings-results"), projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }, { name: "webkit", use: { ...devices["Desktop Safari"] } }] });
