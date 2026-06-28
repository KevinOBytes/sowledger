"use client";

import { useEffect } from 'react';

declare global {
  interface Window {
    __sowledgerDatadogInitialized?: boolean;
  }
}

export default function DatadogInit() {
  useEffect(() => {
    const applicationId = process.env.NEXT_PUBLIC_DATADOG_APPLICATION_ID;
    const clientToken = process.env.NEXT_PUBLIC_DATADOG_CLIENT_TOKEN;
    const site = process.env.NEXT_PUBLIC_DATADOG_SITE;

    if (!applicationId || !clientToken || !site || window.__sowledgerDatadogInitialized) return;

    let cancelled = false;

    void import('@datadog/browser-rum').then(({ datadogRum }) => {
      if (cancelled || window.__sowledgerDatadogInitialized) return;

      if (!datadogRum.getInitConfiguration()) {
        datadogRum.init({
          applicationId,
          clientToken,
          site,
          service: 'sowledger-frontend',
          env: process.env.NODE_ENV,
          version: '1.0.0',
          sessionSampleRate: 100,
          sessionReplaySampleRate: 20,
          trackUserInteractions: true,
          trackResources: true,
          trackLongTasks: true,
          defaultPrivacyLevel: 'mask-user-input',
        });
        datadogRum.startSessionReplayRecording();
      }

      window.__sowledgerDatadogInitialized = true;
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
