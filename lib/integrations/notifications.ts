import { notifySlack } from "@/lib/integrations/slack";

export type IntegrationNotification = {
  title: string;
  body?: string;
  url?: string;
};

export async function dispatchIntegrationNotification(workspaceId: string, eventType: string, payload: IntegrationNotification, options: { signal?: AbortSignal } = {}) {
  const results = await Promise.allSettled([
    notifySlack(workspaceId, eventType, payload, options.signal),
  ]);
  // Keep ordinary background notifications nonblocking while allowing jobs to
  // distinguish provider acceptance from failure or no configured channel.
  const summary = { sent: 0, failed: 0, skipped: 0 };
  for (const result of results) {
    if (result.status === "rejected" || result.value.status === "failed") summary.failed++;
    else if (result.value.status === "sent") summary.sent++;
    else summary.skipped++;
  }
  return summary;
}
