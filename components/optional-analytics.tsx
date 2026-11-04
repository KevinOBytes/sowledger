"use client";

import { useEffect, useState } from "react";
import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";
import DatadogInit from "@/components/DatadogInit";
import { AnalyticsWrapper } from "@/components/analytics-wrapper";
import { readBrowserConsent, subscribeBrowserConsent } from "@/lib/browser-consent";

// The installed Vercel script survives React unmount. Its retained callback
// must read current consent rather than close over the original render.
const beforeSend = (event: BeforeSendEvent) => readBrowserConsent() ? event : null;

export function OptionalAnalytics({ gaId, vercelEnabled }: { gaId?: string; vercelEnabled: boolean }) {
  const [accepted, setAccepted] = useState(false);
  useEffect(() => {
    const sync = () => setAccepted(readBrowserConsent());
    const unsubscribe = subscribeBrowserConsent(sync);
    sync();
    return unsubscribe;
  }, []);

  if (!accepted) return null;
  return <>
    <DatadogInit />
    {vercelEnabled ? <Analytics beforeSend={beforeSend} /> : null}
    {gaId ? <AnalyticsWrapper gaId={gaId} /> : null}
  </>;
}
