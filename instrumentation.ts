import * as Sentry from '@sentry/nextjs';

const sentryConfigured = Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN);

export async function register() {
  if (!sentryConfigured) return;

  try {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
      await import('./sentry.server.config');
    }

    if (process.env.NEXT_RUNTIME === 'edge') {
      await import('./sentry.edge.config');
    }
  } catch (error) {
    console.warn("Sentry instrumentation disabled", error instanceof Error ? error.message : "unknown error");
  }
}

export const onRequestError = (...args: Parameters<typeof Sentry.captureRequestError>) => {
  if (!sentryConfigured) return;
  try {
    return Sentry.captureRequestError(...args);
  } catch (error) {
    console.warn("Sentry request capture failed", error instanceof Error ? error.message : "unknown error");
  }
};
