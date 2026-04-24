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
      else if (res.status === 402) {
        if (mounted) setRequiresUpgrade(true);
        if (mounted) setLoading(false);
      }
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
          <h2 className="mb-3 text-2xl font-bold text-[#17211d]">Advanced integrations</h2>
          <p className="mb-8 text-slate-500">
            Move to Studio for $29/workspace/month to unlock real-time webhooks, API keys, and usage tracking.
          </p>
          <a
            href="/settings/billing"
            className="inline-flex rounded-xl bg-cyan-600 px-6 py-3 text-sm font-bold text-white shadow-lg transition hover:bg-cyan-500"
          >
            Move to Studio
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
          Subscribe to workspace events in real-time. Dispatches JSON payloads to your HTTPS endpoints.
        </p>
      </div>

      <div className="mb-8 overflow-hidden rounded-[28px] border border-stone-200 bg-white shadow-sm">
        <div className="grid grid-cols-12 gap-4 border-b border-stone-100 bg-stone-50 p-4 text-sm font-semibold text-stone-600">
          <div className="col-span-6">Endpoint URL</div>
          <div className="col-span-5">Subscribed Events</div>
          <div className="col-span-1 text-right"></div>
        </div>
        
        <div className="divide-y divide-stone-100">
          {webhooks.length === 0 ? (
            <div className="p-8 text-center text-sm text-stone-500">
              No webhook integrations currently active.
            </div>
          ) : (
            webhooks.map((w) => (
              <div key={w.id} className="grid grid-cols-12 items-center gap-4 p-4 text-sm text-stone-700 hover:bg-stone-50">
                <div className="col-span-6 truncate font-mono text-teal-700">{w.url}</div>
                <div className="col-span-5 flex flex-wrap gap-1">
                  {w.events.map(ev => (
                    <span key={ev} className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{ev}</span>
                  ))}
                </div>
                <div className="col-span-1 flex justify-end">
                  <button onClick={() => deleteWebhook(w.id)} className="text-stone-400 hover:text-rose-500">
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
          HTTPS Payload URL
          <input 
            type="url"
            required
            placeholder="https://hooks.slack.com/services/..."
            className="rounded-2xl border border-stone-200 bg-stone-50 p-2.5 text-[#17211d] outline-none focus:border-teal-500 focus:bg-white"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <label className="flex flex-1 flex-col gap-1.5 text-sm font-medium text-stone-700">
          Events (csv)
          <input 
            type="text"
            className="rounded-2xl border border-stone-200 bg-stone-50 p-2.5 text-[#17211d] outline-none focus:border-teal-500 focus:bg-white"
            value={events}
            onChange={(e) => setEvents(e.target.value)}
          />
        </label>
        <button 
          type="submit" 
          disabled={!url}
          className="flex h-[42px] items-center justify-center gap-2 rounded-2xl bg-[#163c36] px-6 text-sm font-semibold text-white transition hover:bg-[#23544b] disabled:opacity-50 sm:w-auto"
        >
          <Plus className="h-4 w-4" /> Subscribe
        </button>
      </form>
      {status && <p className="mt-4 text-sm text-rose-600">{status}</p>}
    </div>
  );
}
