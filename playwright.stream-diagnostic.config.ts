import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";
import rootConfig from "./playwright.config";

process.env.SOWLEDGER_STREAM_DIAGNOSTICS = "1";

export default defineConfig(rootConfig, {
  testMatch: ["e2e-professional.spec.ts", "project-history.spec.ts", "workflow-interface.spec.ts"],
  workers: 1,
  retries: 0,
  reporter: "line",
  outputDir: join(tmpdir(), `sowledger-stream-diagnostic-${randomUUID()}`),
  preserveOutput: "always",
  use: { ...rootConfig.use, trace: "off", video: "off", screenshot: "off" },
  projects: rootConfig.projects?.filter((project) => project.name === "chromium").map((project) => ({
    ...project, use: { ...project.use, trace: "off", video: "off", screenshot: "off" },
  })),
});
