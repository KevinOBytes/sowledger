"use client";

import { useEffect } from 'react';
import { readBrowserConsent, subscribeBrowserConsent } from '@/lib/browser-consent';

type Rum = typeof import('@datadog/browser-rum')['datadogRum'];
let sdk: Rum | undefined;
let sdkPromise: Promise<Rum | undefined> | undefined;
let initialized = false;
let running = false;
let unavailable = false;

function stop() {
  running = false;
  // Consent revocation is separate from React unmount: the loaded SDK remains.
  try { sdk?.setTrackingConsent('not-granted'); } catch { /* Optional provider. */ }
  try { sdk?.stopSessionReplayRecording(); } catch { /* Optional provider. */ }
}

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

    if (!applicationId || !clientToken || !site) return;
    let mounted = true;
    let requested = false;

    const enable = () => {
      if (!mounted || !readBrowserConsent() || !sdk || unavailable || running) return;
      try {
        if (!initialized) {
          if (!sdk.getInitConfiguration()) {
            sdk.init({
              applicationId, clientToken, site,
              service: 'sowledger-frontend', env: process.env.NODE_ENV, version: '1.0.0',
              sessionSampleRate: 100, sessionReplaySampleRate: 20,
              trackUserInteractions: true, trackResources: true, trackLongTasks: true,
              defaultPrivacyLevel: 'mask-user-input',
              trackingConsent: 'granted',
              beforeSend: () => readBrowserConsent(),
            });
          }
          initialized = true;
          window.__sowledgerDatadogInitialized = true;
        }
        sdk.setTrackingConsent('granted');
        // No force option: retain the SDK's configured replay sampling.
        sdk.startSessionReplayRecording();
        running = true;
      } catch {
        unavailable = true;
        stop();
      }
    };
    const sync = () => {
      if (!readBrowserConsent()) { stop(); return; }
      if (sdk) { enable(); return; }
      if (requested || unavailable) return;
      requested = true;
      // One shared import survives StrictMode effect replay. Both continuations
      // must still check mount/current consent after asynchronous loading.
      sdkPromise ??= import('@datadog/browser-rum').then(module => module.datadogRum).catch(() => {
        unavailable = true;
        return undefined;
      });
      void sdkPromise.then(loaded => { sdk = loaded; enable(); });
    };
    const unsubscribe = subscribeBrowserConsent(sync);
    sync();
    return () => {
      mounted = false;
      unsubscribe();
      stop();
    };
  }, []);

  return null;
}
