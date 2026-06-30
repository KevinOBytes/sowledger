"use client";

import { useEffect, useState } from "react";
import { GoogleAnalytics } from "@next/third-parties/google";

export function AnalyticsWrapper({ gaId }: { gaId: string }) {
  const [hasConsent, setHasConsent] = useState(false);

  useEffect(() => {
    // Check for consent on mount and setup an interval or listen to storage/cookie changes
    // But since setting the cookie refreshes the router or we can just rely on the router refresh
    const checkConsent = () => {
      setHasConsent(document.cookie.includes("sowledger-cookie-consent=true"));
    };
    
    checkConsent();
    
    // Periodically check in case it's accepted in another tab or just accepted now
    const interval = setInterval(checkConsent, 1000);
    return () => clearInterval(interval);
  }, []);

  if (!hasConsent) return null;

  return <GoogleAnalytics gaId={gaId} />;
}
