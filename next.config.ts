import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  outputFileTracingRoot: process.cwd(),
};

const sentryRuntimeConfigured = Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN);
const sentryUploadConfigured = Boolean(process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT);

export default sentryRuntimeConfigured || sentryUploadConfigured
  ? withSentryConfig(nextConfig, {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    silent: true,
    widenClientFileUpload: sentryUploadConfigured,
    tunnelRoute: sentryRuntimeConfigured ? "/monitoring" : undefined,
    errorHandler: (error) => {
      console.warn("Sentry source map upload skipped", error.message);
    },
    sourcemaps: {
      disable: !sentryUploadConfigured,
    },
  })
  : nextConfig;
