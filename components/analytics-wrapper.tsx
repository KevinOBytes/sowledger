"use client";

import { useEffect, useState } from "react";
import { GoogleAnalytics } from "@next/third-parties/google";
import { readBrowserConsent, subscribeBrowserConsent } from "@/lib/browser-consent";

export function AnalyticsWrapper({ gaId }: { gaId: string }) {
  const [hasConsent, setHasConsent] = useState(false);

  useEffect(() => {
    const flag = `ga-disable-${gaId}`;
    const browser = window as Window & Record<string, unknown>;
    const sync = () => {
      const accepted = readBrowserConsent();
      browser[flag] = !accepted;
      setHasConsent(accepted);
    };
    const unsubscribe = subscribeBrowserConsent(sync);
    sync();
    return () => {
      browser[flag] = true;
      unsubscribe();
    };
  }, [gaId]);

  if (!hasConsent) return null;

  return <GoogleAnalytics gaId={gaId} />;
}
