"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  MessageSquare,
  Plug,
  Receipt,
  RefreshCcw,
  Settings2,
  ShieldCheck,
  Unplug,
  Webhook,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";

import { AppEmptyState, AppMetricCard, AppPageHeader, AppPageShell, AppWorkflowRail } from "@/components/app-page-shell";

type Provider = "google_calendar" | "slack" | "quickbooks";
type ConnectionStatus = "connected" | "needs_setup" | "error" | "disabled";

type Connection = {
  id: string;
  provider: Provider;
  status: ConnectionStatus;
  displayName: string | null;
  externalAccountId: string | null;
  config: Record<string, unknown>;
  tokenExpiresAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type IntegrationsResponse = {
  connections?: Connection[];
  readiness?: {
    googleCalendarOAuth: boolean;
    slackOAuth: boolean;
    slackManualWebhook: boolean;
    quickBooksOAuth: boolean;
  };
  error?: string;
};

const PROVIDER_META: Record<Provider, { title: string; subtitle: string; icon: typeof Plug; authPath: string; readinessKey: keyof NonNullable<IntegrationsResponse["readiness"]> }> = {
  google_calendar: {
    title: "Google Calendar",
    subtitle: "Two-way planning sync: SOWLedger scheduled blocks out, external busy time in.",
    icon: CalendarDays,
    authPath: "/api/integrations/google-calendar/oauth/start",
    readinessKey: "googleCalendarOAuth",
  },
  slack: {
    title: "Slack alerts",
    subtitle: "Send reminders, missed-block recovery prompts, timer notices, and invoice updates.",
    icon: MessageSquare,
    authPath: "/api/integrations/slack/oauth/start",
    readinessKey: "slackOAuth",
  },
  quickbooks: {
    title: "QuickBooks Online",
    subtitle: "Push approved SOWLedger invoices with proof-pack digest metadata into accounting.",
    icon: Receipt,
    authPath: "/api/integrations/quickbooks/oauth/start",
    readinessKey: "quickBooksOAuth",
  },
};

function statusTone(status?: ConnectionStatus) {
  if (status === "connected") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "error") return "bg-rose-50 text-rose-700 border-rose-200";
  if (status === "disabled") return "bg-slate-100 text-slate-600 border-slate-200";
  return "bg-amber-50 text-amber-700 border-amber-200";
}

function statusLabel(status?: ConnectionStatus) {
  if (status === "connected") return "Connected";
  if (status === "error") return "Needs attention";
  if (status === "disabled") return "Disconnected";
  return "Not connected";
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function configString(config: Record<string, unknown>, key: string, fallback = "") {
  const value = config[key];
  return typeof value === "string" ? value : fallback;
}

function configBoolean(config: Record<string, unknown>, key: string, fallback: boolean) {
  return typeof config[key] === "boolean" ? Boolean(config[key]) : fallback;
}

export function IntegrationCenterClient() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [readiness, setReadiness] = useState<NonNullable<IntegrationsResponse["readiness"]> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [slackWebhookUrl, setSlackWebhookUrl] = useState("");
  const [slackChannelLabel, setSlackChannelLabel] = useState("");
  const [quickBooksCustomerRefId, setQuickBooksCustomerRefId] = useState("");
  const [quickBooksServiceItemRefId, setQuickBooksServiceItemRefId] = useState("");
  const [googleCalendarId, setGoogleCalendarId] = useState("primary");
  const [googleImportBusy, setGoogleImportBusy] = useState(true);
  const [googleSyncScheduled, setGoogleSyncScheduled] = useState(true);

  const connectionByProvider = useMemo(() => new Map(connections.map((connection) => [connection.provider, connection])), [connections]);
  const connectedCount = connections.filter((connection) => connection.status === "connected").length;
  const errorCount = connections.filter((connection) => connection.status === "error").length;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/integrations");
      const data = await response.json() as IntegrationsResponse;
      if (!response.ok) throw new Error(data.error || "Unable to load integrations");
      const nextConnections = data.connections ?? [];
      setConnections(nextConnections);
      setReadiness(data.readiness ?? null);
      const quickBooks = nextConnections.find((connection) => connection.provider === "quickbooks");
      if (quickBooks) {
        setQuickBooksCustomerRefId(configString(quickBooks.config, "customerRefId"));
        setQuickBooksServiceItemRefId(configString(quickBooks.config, "serviceItemRefId"));
      }
      const google = nextConnections.find((connection) => connection.provider === "google_calendar");
      if (google) {
        setGoogleCalendarId(configString(google.config, "calendarId", "primary"));
        setGoogleImportBusy(configBoolean(google.config, "importBusy", true));
        setGoogleSyncScheduled(configBoolean(google.config, "syncScheduled", true));
      }
    } catch (error) {
      toast.error("Integrations unavailable", { description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function postAction(path: string, success: string, body?: unknown) {
    setBusy(path);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json().catch(() => ({})) as { error?: string; result?: { imported?: number; exported?: number; updated?: number } };
      if (!response.ok) throw new Error(data.error || "Request failed");
      const detail = data.result ? `${data.result.exported ?? 0} exported, ${data.result.imported ?? 0} imported, ${data.result.updated ?? 0} updated.` : undefined;
      toast.success(success, { description: detail });
      await refresh();
    } catch (error) {
      toast.error("Integration action failed", { description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setBusy(null);
    }
  }

  async function patchConfig(provider: Provider, body: Record<string, unknown>) {
    setBusy(`${provider}:config`);
    try {
      const response = await fetch(`/api/integrations/${provider}/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not save integration settings");
      toast.success("Integration settings saved");
      await refresh();
    } catch (error) {
      toast.error("Could not save settings", { description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setBusy(null);
    }
  }

  function connect(provider: Provider) {
    const meta = PROVIDER_META[provider];
    const configured = readiness?.[meta.readinessKey];
    if (!configured) {
      toast.error(`${meta.title} OAuth is not configured`, { description: "Add the provider client ID/secret and redirect URI in production env first." });
      return;
    }
    window.location.href = meta.authPath;
  }

  return (
    <AppPageShell contentClassName="space-y-5">
      <AppPageHeader
        eyebrow="Integrations"
        title="Connect the systems around SOWLedger"
        description="Calendar is the priority: sync planned SOWLedger blocks to Google Calendar, import external busy time as unavailable blocks, then route alerts and invoice proof into Slack and QuickBooks."
        icon={Plug}
        metadata={[
          { label: "Calendar-first operations", tone: "cyan", icon: CalendarDays },
          { label: "Workspace-scoped credentials", tone: "slate", icon: ShieldCheck },
          { label: "API and webhook fallback", tone: "emerald", icon: Webhook },
        ]}
        primaryAction={(
          <button onClick={() => void refresh()} className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-slate-800 sm:w-auto">
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
        )}
      />

      <AppWorkflowRail current="integrate" />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AppMetricCard label="Connected" value={loading ? "..." : connectedCount} detail="Active provider connections." accent="emerald" icon={CheckCircle2} />
        <AppMetricCard label="Needs attention" value={loading ? "..." : errorCount} detail="Provider errors to fix." accent={errorCount ? "rose" : "slate"} icon={AlertTriangle} />
        <AppMetricCard label="Calendar sync" value={connectionByProvider.get("google_calendar")?.status === "connected" ? "Ready" : "Setup"} detail="Must-have operational integration." accent="cyan" icon={CalendarDays} />
        <AppMetricCard label="Fallbacks" value="API + webhooks" detail="Zapier, Make, and custom agency systems." accent="slate" icon={KeyRound} />
      </section>

      <section className="grid gap-5 xl:grid-cols-3">
        {(Object.keys(PROVIDER_META) as Provider[]).map((provider) => {
          const meta = PROVIDER_META[provider];
          const connection = connectionByProvider.get(provider);
          const Icon = meta.icon;
          const configured = readiness?.[meta.readinessKey] ?? false;
          return (
            <article key={provider} className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-700"><Icon className="h-5 w-5" /></span>
                  <div className="min-w-0">
                    <h2 className="text-xl font-semibold text-slate-950">{meta.title}</h2>
                    <p className="mt-1 text-sm leading-6 text-slate-500">{meta.subtitle}</p>
                  </div>
                </div>
                <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-bold ${statusTone(connection?.status)}`}>{statusLabel(connection?.status)}</span>
              </div>

              <dl className="mt-5 grid gap-3 text-sm text-slate-500">
                <div><dt className="font-bold text-slate-700">Connected account</dt><dd>{connection?.displayName || connection?.externalAccountId || "Not connected"}</dd></div>
                <div><dt className="font-bold text-slate-700">Last sync</dt><dd>{formatDateTime(connection?.lastSyncedAt)}</dd></div>
                {connection?.lastError && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-rose-700"><dt className="font-bold">Last error</dt><dd className="mt-1 break-words text-xs">{connection.lastError}</dd></div>}
                {!configured && provider !== "slack" && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-amber-800"><dt className="font-bold">Environment needed</dt><dd className="mt-1 text-xs">Add OAuth client ID, secret, and redirect URI before connecting.</dd></div>}
              </dl>

              <div className="mt-5 flex flex-wrap gap-2">
                <button onClick={() => connect(provider)} disabled={busy !== null || (!configured && provider !== "slack")} className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-[#163c36] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#23544b] disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none">
                  <Plug className="h-4 w-4" />
                  {connection?.status === "connected" ? "Reconnect" : "Connect"}
                </button>
                {connection && connection.status !== "disabled" && (
                  <>
                    <button onClick={() => void postAction(`/api/integrations/${provider}/test`, "Connection test succeeded")} disabled={busy !== null} className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-cyan-200 hover:text-cyan-700 disabled:opacity-50 sm:flex-none">Test</button>
                    <button onClick={() => void postAction(`/api/integrations/${provider}/disconnect`, "Integration disconnected")} disabled={busy !== null} className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-bold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50 sm:flex-none"><Unplug className="h-4 w-4" />Disconnect</button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <article className="rounded-[32px] border border-cyan-100 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <CalendarDays className="mt-1 h-6 w-6 text-cyan-700" />
            <div>
              <h2 className="text-2xl font-semibold">Calendar sync controls</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">Use Google Calendar as the external planning mirror. SOWLedger remains source-of-truth for planned work; imported external events become unavailable blocks.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="text-sm font-bold text-slate-700">Google calendar ID
              <input value={googleCalendarId} onChange={(event) => setGoogleCalendarId(event.target.value)} placeholder="primary" className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-cyan-500" />
            </label>
            <button onClick={() => void patchConfig("google_calendar", { calendarId: googleCalendarId, importBusy: googleImportBusy, syncScheduled: googleSyncScheduled })} disabled={!connectionByProvider.get("google_calendar") || busy !== null} className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:border-cyan-200 hover:text-cyan-700 disabled:opacity-50"><Settings2 className="h-4 w-4" />Save</button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700"><input type="checkbox" checked={googleSyncScheduled} onChange={(event) => setGoogleSyncScheduled(event.target.checked)} className="mt-1 accent-cyan-700" />Push SOWLedger planned blocks to Google Calendar</label>
            <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700"><input type="checkbox" checked={googleImportBusy} onChange={(event) => setGoogleImportBusy(event.target.checked)} className="mt-1 accent-cyan-700" />Import external busy events as unavailable blocks</label>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <button onClick={() => void postAction("/api/integrations/google-calendar/sync", "Google Calendar sync complete")} disabled={connectionByProvider.get("google_calendar")?.status !== "connected" || busy !== null} className="inline-flex items-center gap-2 rounded-2xl bg-cyan-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"><RefreshCcw className="h-4 w-4" />Sync now</button>
            <Link href="/calendar" className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:border-cyan-200 hover:text-cyan-700">Open calendar <ArrowRight className="h-4 w-4" /></Link>
          </div>
        </article>

        <article className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <MessageSquare className="mt-1 h-6 w-6 text-cyan-700" />
            <div>
              <h2 className="text-2xl font-semibold">Slack manual setup</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">If Slack OAuth is not configured yet, paste an incoming webhook URL to make alerts work immediately.</p>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            <label className="text-sm font-bold text-slate-700">Incoming webhook URL
              <input type="password" value={slackWebhookUrl} onChange={(event) => setSlackWebhookUrl(event.target.value)} placeholder="https://hooks.slack.com/services/..." className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-cyan-500" />
            </label>
            <label className="text-sm font-bold text-slate-700">Channel label
              <input value={slackChannelLabel} onChange={(event) => setSlackChannelLabel(event.target.value)} placeholder="#ops" className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-cyan-500" />
            </label>
            <button onClick={() => void postAction("/api/integrations/slack/manual", "Slack connected", { webhookUrl: slackWebhookUrl, channelLabel: slackChannelLabel })} disabled={!slackWebhookUrl || busy !== null} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50"><MessageSquare className="h-4 w-4" />Save Slack webhook</button>
          </div>
        </article>
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <article className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <Receipt className="mt-1 h-6 w-6 text-cyan-700" />
            <div>
              <h2 className="text-2xl font-semibold">QuickBooks invoice defaults</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">QuickBooks needs a customer reference and service item reference before SOWLedger can push invoices safely.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-bold text-slate-700">CustomerRef ID<input value={quickBooksCustomerRefId} onChange={(event) => setQuickBooksCustomerRefId(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-cyan-500" /></label>
            <label className="text-sm font-bold text-slate-700">Service ItemRef ID<input value={quickBooksServiceItemRefId} onChange={(event) => setQuickBooksServiceItemRefId(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-cyan-500" /></label>
          </div>
          <button onClick={() => void patchConfig("quickbooks", { customerRefId: quickBooksCustomerRefId, serviceItemRefId: quickBooksServiceItemRefId })} disabled={!connectionByProvider.get("quickbooks") || busy !== null} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50"><Settings2 className="h-4 w-4" />Save QuickBooks defaults</button>
        </article>

        <article className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <Workflow className="mt-1 h-6 w-6 text-cyan-700" />
            <div>
              <h2 className="text-2xl font-semibold">Zapier, Make, and custom systems</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">Use API keys and webhooks for long-tail automation while native integrations stay focused on calendar, alerts, and accounting.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Link href="/settings/developers" className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-bold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50 hover:text-cyan-800"><KeyRound className="mb-3 h-5 w-5 text-cyan-700" />Create scoped API keys</Link>
            <Link href="/settings/webhooks" className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-bold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50 hover:text-cyan-800"><Webhook className="mb-3 h-5 w-5 text-cyan-700" />Configure event webhooks</Link>
            <Link href="/support/api" className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-bold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50 hover:text-cyan-800 sm:col-span-2"><ExternalLink className="mb-3 h-5 w-5 text-cyan-700" />Open API usage guide and endpoint list</Link>
          </div>
        </article>
      </section>

      {!loading && connectedCount === 0 && (
        <AppEmptyState
          icon={Plug}
          title="Start with calendar sync."
          description="Connect Google Calendar first so planned SOWLedger work appears where users already live. Slack and QuickBooks can follow once schedule behavior is proven."
          action={<button onClick={() => connect("google_calendar")} className="rounded-full bg-slate-950 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800">Connect Google Calendar</button>}
        />
      )}
    </AppPageShell>
  );
}
