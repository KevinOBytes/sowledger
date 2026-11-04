"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CalendarDays, CheckCircle2, ExternalLink, Plug, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { calendarSyncFailure, calendarSyncFeedback, type CalendarSyncFeedback } from "@/lib/calendar-sync-feedback";

type Connection = {
  provider: "google_calendar" | "slack" | "quickbooks";
  status: "connected" | "needs_setup" | "error" | "disabled";
  displayName: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
};

type IntegrationsResponse = {
  canManage?: boolean;
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
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<CalendarSyncFeedback | null>(null);
  const loadGeneration = useRef(0);

  const connected = connection?.status === "connected";
  const statusText = useMemo(() => {
    if (connected) return "Google Calendar connected";
    if (connection?.status === "error") return "Google Calendar needs attention";
    return canManage ? "Connect Google Calendar" : "Google Calendar is not connected";
  }, [canManage, connected, connection?.status]);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setCanManage(false);
    try {
      const response = await fetch("/api/integrations");
      const data = await response.json() as IntegrationsResponse;
      if (generation !== loadGeneration.current) return;
      if (!response.ok) throw new Error(data.error || "Unable to load integration status");
      setConnection((data.connections ?? []).find((item) => item.provider === "google_calendar") ?? null);
      setOauthReady(data.readiness?.googleCalendarOAuth === true);
      setCanManage(data.canManage === true);
      setLoadError(false);
    } catch {
      if (generation !== loadGeneration.current) return;
      setLoadError(true);
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const generation = loadGeneration;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => { generation.current++; };
  }, [load]);

  async function syncNow() {
    if (!canManage || loading || syncing) return;
    setSyncing(true);
    setSyncFeedback(null);
    try {
      const response = await fetch("/api/integrations/google-calendar/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const data = await response.json() as { error?: string; result?: unknown };
      if (!response.ok) throw new Error(data.error || "Google Calendar sync failed");
      const feedback = calendarSyncFeedback(data.result);
      setSyncFeedback(feedback);
      toast[feedback.tone](feedback.title, { description: feedback.description });
      window.dispatchEvent(new CustomEvent("sowledger:calendar-updated"));
      await load();
    } catch {
      setSyncFeedback(calendarSyncFailure);
      toast.error(calendarSyncFailure.title, { description: calendarSyncFailure.description });
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
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">Sync covers the past 14 days and the next 60 days, not the dates currently shown.</p>
            {connection?.lastError && <p className="mt-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">The last sync failed. Try again or reconnect in integration settings.</p>}
            {!connected && !oauthReady && <p className="mt-2 text-xs font-semibold text-amber-700">Google Calendar connection is not available yet. Ask your workspace owner for help.</p>}
            {!canManage && <p className="mt-2 text-sm text-slate-600">An owner or manager can connect or sync this calendar.</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && (connected ? (
            <button onClick={() => void syncNow()} disabled={syncing} className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-cyan-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-cyan-500 disabled:opacity-50 sm:flex-none">
              <RefreshCcw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing..." : "Sync now"}
            </button>
          ) : oauthReady ? (
            <a href="/api/integrations/google-calendar/oauth/start" className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-cyan-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-cyan-500 sm:flex-none">
              <Plug className="h-4 w-4" />Connect calendar
            </a>
          ) : (
            <button type="button" disabled className="inline-flex flex-1 cursor-not-allowed items-center justify-center gap-2 rounded-2xl bg-cyan-600 px-4 py-2.5 text-sm font-bold text-white opacity-50 sm:flex-none">
              <Plug className="h-4 w-4" />Connect calendar
            </button>
          ))}
          <Link href="/integrations" className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:border-cyan-200 hover:text-cyan-700 sm:flex-none">
            Integration settings <ExternalLink className="h-4 w-4" />
          </Link>
        </div>
      </div>
      {syncFeedback && (
        <div role={syncFeedback.tone === "success" ? "status" : "alert"} className={`mt-3 rounded-xl border p-3 text-sm ${syncFeedback.tone === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : syncFeedback.tone === "warning" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
          <p className="font-semibold">{syncFeedback.title}</p>
          <p className="mt-1">{syncFeedback.description}</p>
        </div>
      )}
    </section>
  );
}
