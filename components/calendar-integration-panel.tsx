"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, CheckCircle2, ExternalLink, Plug, RefreshCcw } from "lucide-react";
import { toast } from "sonner";

type Connection = {
  provider: "google_calendar" | "slack" | "quickbooks";
  status: "connected" | "needs_setup" | "error" | "disabled";
  displayName: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
};

type IntegrationsResponse = {
  connections?: Connection[];
  readiness?: { googleCalendarOAuth: boolean };
  error?: string;
};

function formatSync(value: string | null | undefined) {
  if (!value) return "Not synced yet";
  return `Last sync ${new Date(value).toLocaleString()}`;
}

export function CalendarIntegrationPanel() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [oauthReady, setOauthReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const connected = connection?.status === "connected";
  const statusText = useMemo(() => {
    if (connected) return "Google Calendar connected";
    if (connection?.status === "error") return "Google Calendar needs attention";
    return "Connect Google Calendar";
  }, [connected, connection?.status]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/integrations");
      const data = await response.json() as IntegrationsResponse;
      if (!response.ok) throw new Error(data.error || "Unable to load integration status");
      setConnection((data.connections ?? []).find((item) => item.provider === "google_calendar") ?? null);
      setOauthReady(Boolean(data.readiness?.googleCalendarOAuth));
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function syncNow() {
    setSyncing(true);
    try {
      const response = await fetch("/api/integrations/google-calendar/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const data = await response.json() as { error?: string; result?: { exported?: number; imported?: number; updated?: number } };
      if (!response.ok) throw new Error(data.error || "Google Calendar sync failed");
      toast.success("Calendar sync complete", { description: `${data.result?.exported ?? 0} exported, ${data.result?.imported ?? 0} imported, ${data.result?.updated ?? 0} updated.` });
      window.dispatchEvent(new CustomEvent("sowledger:calendar-updated"));
      await load();
    } catch {
      toast.error("Calendar sync failed", { description: "Try again, or open integration settings to check the connection." });
    } finally {
      setSyncing(false);
    }
  }

  if (loading) return <p className="px-4 text-sm text-slate-500" role="status">Checking Google Calendar connection...</p>;
  if (loadError) return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="alert">
      <p>Could not check your Google Calendar connection. Your SOWLedger calendar is still available.</p>
      <button type="button" onClick={() => void load()} className="font-semibold underline">Retry connection check</button>
    </div>
  );

  return (
    <section className="rounded-[28px] border border-cyan-100 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${connected ? "bg-emerald-50 text-emerald-700" : "bg-cyan-50 text-cyan-700"}`}>
            {connected ? <CheckCircle2 className="h-5 w-5" /> : <CalendarDays className="h-5 w-5" />}
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-950">{statusText}</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
              {connected
                ? `${connection?.displayName || "Google Calendar"}. ${formatSync(connection?.lastSyncedAt)}. External busy events appear as unavailable blocks.`
                : "Sync scheduled work and see when you are busy in Google Calendar."}
            </p>
            {connection?.lastError && <p className="mt-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">The last sync failed. Try again or reconnect in integration settings.</p>}
            {!connected && !oauthReady && <p className="mt-2 text-xs font-semibold text-amber-700">Google Calendar connection is not available yet. Ask your workspace owner for help.</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {connected ? (
            <button onClick={() => void syncNow()} disabled={syncing} className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-cyan-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-cyan-500 disabled:opacity-50 sm:flex-none">
              <RefreshCcw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing..." : "Sync now"}
            </button>
          ) : (
            <a href="/api/integrations/google-calendar/oauth/start" aria-disabled={!oauthReady} className={`inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-cyan-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-cyan-500 sm:flex-none ${!oauthReady ? "pointer-events-none opacity-50" : ""}`}>
              <Plug className="h-4 w-4" />Connect calendar
            </a>
          )}
          <Link href="/integrations" className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:border-cyan-200 hover:text-cyan-700 sm:flex-none">
            Integration settings <ExternalLink className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
