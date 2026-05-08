import { notifySlack } from "@/lib/integrations/slack";

export type IntegrationNotification = {
  title: string;
  body?: string;
  url?: string;
};

export async function dispatchIntegrationNotification(workspaceId: string, eventType: string, payload: IntegrationNotification) {
  await Promise.allSettled([
    notifySlack(workspaceId, eventType, payload),
  ]);
}
