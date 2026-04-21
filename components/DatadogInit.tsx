"use client";

import { datadogRum } from '@datadog/browser-rum';
import { useEffect } from 'react';

export default function DatadogInit() {
  useEffect(() => {
    const applicationId = process.env.NEXT_PUBLIC_DATADOG_APPLICATION_ID;
    const clientToken = process.env.NEXT_PUBLIC_DATADOG_CLIENT_TOKEN;
    const site = process.env.NEXT_PUBLIC_DATADOG_SITE;

    if (applicationId && clientToken && site && !datadogRum.getInitConfiguration()) {
      datadogRum.init({
        applicationId,
        clientToken,
        site,
        service: 'billabled-frontend',
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
  }, []);

  return null;
}
