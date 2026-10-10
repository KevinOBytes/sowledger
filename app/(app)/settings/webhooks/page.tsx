"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Webhook, Zap } from "lucide-react";
import { DataLoadNotice } from "@/components/data-load-notice";

type WebhookIntegration = {
  id: string;
  maskedUrl: string;
  events: string[];
  createdAt: string;
};

export default function WebhooksPage() {
  const [webhooks, setWebhooks] = useState<WebhookIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState("time_entry.created, time_entry.updated");
  const [status, setStatus] = useState("");
  const [requiresUpgrade, setRequiresUpgrade] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/webhooks");
      if (res.ok) {
        const data = await res.json();
        setWebhooks(data.webhooks ?? []);
        setRequiresUpgrade(false);
      } else if (res.status === 402) {
        setRequiresUpgrade(true);
      } else {
        throw new Error("Webhooks unavailable");
      }
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, [loadData]);

  async function createWebhook(e: React.FormEvent) {
    e.preventDefault();
    if (!url) return;
    setSaving(true);
    setStatus("Saving...");
    try {
      const res = await fetch("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          events: events.split(",").map(e => e.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not add the webhook. Please try again.");
      setUrl("");
      await loadData();
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not add the webhook. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteWebhook(id: string) {
    if (!confirm("Remove this webhook? It will no longer receive workspace events.")) return;
    try {
      const response = await fetch(`/api/webhooks?id=${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Request failed");
      await loadData();
      setStatus("");
    } catch {
      setStatus("Could not remove the webhook. Please try again.");
    }
  }

  if (loadError) {
    return <main className="mx-auto max-w-4xl p-6"><h1 className="mb-5 text-3xl font-semibold">Webhooks</h1><DataLoadNotice message="We couldn't load your webhooks." onRetry={() => void loadData()} /></main>;
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f6f3ee]">
        <Zap className="h-8 w-8 animate-pulse text-cyan-500" />
      </div>
    );
  }

  if (requiresUpgrade) {
    return (
      <div className="mt-20 flex h-full flex-col items-center justify-center bg-[#f6f3ee] p-8">
        <div className="max-w-md rounded-[32px] border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-cyan-50">
            <Webhook className="h-8 w-8 text-cyan-700" />
          </div>
          <h1 className="mb-3 text-2xl font-bold text-[#17211d]">Webhooks</h1>
          <p className="mb-8 text-slate-500">
            Webhooks are available on Studio and Business. Choose a plan to send workspace events to your own tools.
          </p>
          <a
            href="/settings/billing"
            className="inline-flex rounded-xl bg-cyan-600 px-6 py-3 text-sm font-bold text-white shadow-lg transition hover:bg-cyan-500"
          >
            View plans
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-8 rounded-[32px] border border-stone-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-50 text-teal-700">
            <Webhook className="h-6 w-6" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Webhooks</h1>
        </div>
        <p className="mt-3 max-w-2xl text-stone-500">
          Send workspace events to your own tools as JSON. Add an HTTPS endpoint and choose which events it should receive.
        </p>
      </div>

      <div className="mb-8 overflow-hidden rounded-[28px] border border-stone-200 bg-white shadow-sm">
        <div className="grid grid-cols-12 gap-4 border-b border-stone-100 bg-stone-50 p-4 text-sm font-semibold text-stone-600">
          <div className="col-span-6">Endpoint</div>
          <div className="col-span-5">Events</div>
          <div className="col-span-1 text-right"></div>
        </div>
        
        <div className="divide-y divide-stone-100">
          {webhooks.length === 0 ? (
            <div className="p-8 text-center text-sm text-stone-500">
              No webhooks yet. Add an endpoint below to receive workspace events.
            </div>
          ) : (
            webhooks.map((w) => (
              <div key={w.id} className="grid grid-cols-12 items-center gap-4 p-4 text-sm text-stone-700 hover:bg-stone-50">
                <div className="col-span-6 truncate font-mono text-teal-700">{w.maskedUrl}</div>
                <div className="col-span-5 flex flex-wrap gap-1">
                  {w.events.map(ev => (
                    <span key={ev} className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{ev}</span>
                  ))}
                </div>
                <div className="col-span-1 flex justify-end">
                  <button onClick={() => deleteWebhook(w.id)} aria-label="Remove webhook" className="text-stone-400 hover:text-rose-500">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <form onSubmit={createWebhook} className="flex flex-col gap-4 rounded-[28px] border border-stone-200 bg-white p-5 shadow-sm sm:flex-row sm:items-end">
        <label className="flex flex-[2] flex-col gap-1.5 text-sm font-medium text-stone-700">
          Webhook URL (HTTPS)
          <input 
            type="url"
            required
            placeholder="https://example.com/webhooks/sowledger"
            className="rounded-2xl border border-stone-200 bg-stone-50 p-2.5 text-[#17211d] outline-none focus:border-teal-500 focus:bg-white"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <label className="flex flex-1 flex-col gap-1.5 text-sm font-medium text-stone-700">
          Events (comma-separated)
          <input 
            type="text"
            className="rounded-2xl border border-stone-200 bg-stone-50 p-2.5 text-[#17211d] outline-none focus:border-teal-500 focus:bg-white"
            value={events}
            onChange={(e) => setEvents(e.target.value)}
          />
        </label>
        <button 
          type="submit" 
          disabled={!url || saving}
          className="flex h-[42px] items-center justify-center gap-2 rounded-2xl bg-[#163c36] px-6 text-sm font-semibold text-white transition hover:bg-[#23544b] disabled:opacity-50 sm:w-auto"
        >
          <Plus className="h-4 w-4" /> {saving ? "Adding..." : "Add webhook"}
        </button>
      </form>
      {status && <p role="status" className="mt-4 text-sm text-rose-600">{status}</p>}
    </div>
  );
}
