"use client";

import * as Sentry from "@sentry/nextjs";
import Error from "next/error";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
    try {
      Sentry.captureException(error);
    } catch {
      // Error UI should render even if observability is unavailable.
    }
  }, [error]);

  return (
    <html lang="en">
      <body>
        <Error statusCode={500} title="An unexpected error has occurred." />
      </body>
    </html>
  );
}
