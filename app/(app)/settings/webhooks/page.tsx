"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Webhook, Zap } from "lucide-react";

type WebhookIntegration = {
  id: string;
  url: string;
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

  const loadData = async () => {
    try {
      const res = await fetch("/api/webhooks");
      if (res.ok) {
          const data = await res.json();
          setWebhooks(data.webhooks);
      } else if (res.status === 402) {
          setRequiresUpgrade(true);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { 
    let mounted = true;
    fetch("/api/webhooks").then(res => {
      if (!mounted) return;
      if (res.ok) res.json().then(data => {
        if (mounted) setWebhooks(data.webhooks);
        if (mounted) setLoading(false);
      });
      else if (mounted) setLoading(false);
    }).catch(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  async function createWebhook(e: React.FormEvent) {
    e.preventDefault();
    if (!url) return;
    setStatus("Saving...");
    const res = await fetch("/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        url: url.trim(), 
        events: events.split(",").map(e => e.trim()).filter(Boolean) 
      })
    });
    const data = await res.json();
    if (res.ok) {
       setUrl("");
       loadData();
       setStatus("");
    } else {
       setStatus(data.error || "Failed to create");
    }
  }

  async function deleteWebhook(id: string) {
    if (!confirm("Remove this integration?")) return;
    await fetch(`/api/webhooks?id=${id}`, { method: "DELETE" });
    loadData();
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <Zap className="h-8 w-8 animate-pulse text-cyan-500" />
      </div>
    );
  }

  if (requiresUpgrade) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 mt-20">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-purple-900/30">
            <Webhook className="h-8 w-8 text-purple-400" />
          </div>
          <h2 className="mb-3 text-2xl font-bold text-white">Advanced Integrations</h2>
          <p className="mb-8 text-slate-400">
            Upgrade to the SMB plan to unlock real-time Webhooks and connect your workspace events to external services.
          </p>
          <a
            href="/settings/billing"
            className="inline-flex rounded-xl bg-purple-600 px-6 py-3 text-sm font-bold text-white shadow-lg transition hover:bg-purple-500"
          >
            Upgrade to SMB
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <Webhook className="h-8 w-8 text-cyan-500" />
          <h1 className="text-3xl font-bold tracking-tight">Webhooks</h1>
        </div>
        <p className="mt-2 text-slate-400">
          Subscribe to workspace events in real-time. Dispatches JSON payloads to your HTTPS endpoints.
        </p>
      </div>

      <div className="mb-8 rounded-xl border border-slate-800 bg-slate-900 overflow-hidden shadow-xl">
        <div className="grid grid-cols-12 gap-4 border-b border-slate-800 bg-slate-800/50 p-4 text-sm font-semibold text-slate-300">
          <div className="col-span-6">Endpoint URL</div>
          <div className="col-span-5">Subscribed Events</div>
          <div className="col-span-1 text-right"></div>
        </div>
        
        <div className="divide-y divide-slate-800">
          {webhooks.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              No webhook integrations currently active.
            </div>
          ) : (
            webhooks.map((w) => (
              <div key={w.id} className="grid grid-cols-12 items-center gap-4 p-4 text-sm text-slate-200 hover:bg-slate-800/30">
                <div className="col-span-6 truncate font-mono text-cyan-400">{w.url}</div>
                <div className="col-span-5 flex flex-wrap gap-1">
                  {w.events.map(ev => (
                    <span key={ev} className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">{ev}</span>
                  ))}
                </div>
                <div className="col-span-1 flex justify-end">
                  <button onClick={() => deleteWebhook(w.id)} className="text-slate-500 hover:text-rose-400">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <form onSubmit={createWebhook} className="flex flex-col gap-4 rounded-xl border border-slate-800 bg-slate-900/50 p-5 shadow-inner sm:flex-row sm:items-end">
        <label className="flex flex-[2] flex-col gap-1.5 text-sm font-medium text-slate-300">
          HTTPS Payload URL
          <input 
            type="url"
            required
            placeholder="https://hooks.slack.com/services/..."
            className="rounded-lg border border-slate-700 bg-slate-950 p-2.5 outline-none focus:border-cyan-500"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <label className="flex flex-1 flex-col gap-1.5 text-sm font-medium text-slate-300">
          Events (csv)
          <input 
            type="text"
            className="rounded-lg border border-slate-700 bg-slate-950 p-2.5 outline-none focus:border-cyan-500"
            value={events}
            onChange={(e) => setEvents(e.target.value)}
          />
        </label>
        <button 
          type="submit" 
          disabled={!url}
          className="flex h-[42px] items-center justify-center gap-2 rounded-lg bg-cyan-600 px-6 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-50 sm:w-auto"
        >
          <Plus className="h-4 w-4" /> Subscribe
        </button>
      </form>
      {status && <p className="mt-4 text-sm text-rose-400">{status}</p>}
    </div>
  );
}
