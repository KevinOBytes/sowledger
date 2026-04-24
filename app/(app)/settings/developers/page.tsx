"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Code2, Copy, ExternalLink, KeyRound, RefreshCcw, Shield, Trash2 } from "lucide-react";
import { toast } from "sonner";

const API_SCOPES = [
  "read:clients",
  "write:clients",
  "read:projects",
  "write:projects",
  "read:tags",
  "write:tags",
  "read:tasks",
  "write:tasks",
  "read:schedule",
  "write:schedule",
  "read:time",
  "write:time",
  "read:analytics",
  "read:invoices",
  "export:data",
];

type ApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdByUserId: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

type Usage = {
  id: string;
  apiKeyId: string;
  method: string;
  path: string;
  status: number;
  createdAt: string;
  userAgent: string | null;
};

function defaultExpiry() {
  const date = new Date();
  date.setMonth(date.getMonth() + 6);
  return date.toISOString().slice(0, 10);
}

export default function DevelopersPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [usage, setUsage] = useState<Usage[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("Production integration");
  const [expiresAt, setExpiresAt] = useState(defaultExpiry());
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["read:clients", "read:projects", "read:time", "read:analytics", "export:data"]);
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const response = await fetch("/api/settings/api-keys");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load API keys");
      setKeys(data.keys ?? []);
      setUsage(data.usage ?? []);
    } catch (error) {
      toast.error("Developer settings unavailable", { description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const activeKeys = useMemo(() => keys.filter((key) => !key.revokedAt), [keys]);

  function toggleScope(scope: string) {
    setSelectedScopes((current) => current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope]);
  }

  async function createKey() {
    if (!name.trim()) {
      toast.error("API key name is required");
      return;
    }
    if (selectedScopes.length === 0) {
      toast.error("Select at least one scope");
      return;
    }
    setSubmitting(true);
    setRawKey(null);
    try {
      const response = await fetch("/api/settings/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), scopes: selectedScopes, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to create key");
      setRawKey(data.rawKey);
      setName("Production integration");
      await refresh();
      toast.success("API key created");
    } catch (error) {
      toast.error("Could not create API key", { description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setSubmitting(false);
    }
  }

  async function rotateKey(keyId: string) {
    setRawKey(null);
    try {
      const response = await fetch("/api/settings/api-keys", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyId, rotate: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to rotate key");
      setRawKey(data.rawKey);
      await refresh();
      toast.success("API key rotated");
    } catch (error) {
      toast.error("Could not rotate API key", { description: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  async function revokeKey(keyId: string) {
    try {
      const response = await fetch(`/api/settings/api-keys?keyId=${encodeURIComponent(keyId)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to revoke key");
      await refresh();
      toast.success("API key revoked");
    } catch (error) {
      toast.error("Could not revoke API key", { description: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  async function copyRawKey() {
    if (!rawKey) return;
    await navigator.clipboard.writeText(rawKey);
    toast.success("API key copied");
  }

  return (
    <main className="min-h-screen bg-[#f6f3ee] p-4 text-slate-950 sm:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Developers</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">API keys, usage, and docs</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-500">Workspace managers can create scoped API keys for core Billabled data. Secrets are shown once, stored hashed, and usage is tracked per request.</p>
            </div>
            <Link href="/support/api" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:border-cyan-300 hover:text-cyan-700">
              API usage guide <ExternalLink className="h-4 w-4" />
            </Link>
          </div>
        </header>

        {rawKey && (
          <section className="rounded-[32px] border border-amber-200 bg-amber-50 p-5 text-amber-950 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="font-bold">New API key. It is shown only once.</p>
                <p className="mt-1 break-all font-mono text-sm">{rawKey}</p>
              </div>
              <button onClick={copyRawKey} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-900 px-4 py-2 text-sm font-bold text-white"><Copy className="h-4 w-4" />Copy</button>
            </div>
          </section>
        )}

        <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center gap-3"><KeyRound className="h-5 w-5 text-cyan-700" /><h2 className="text-xl font-semibold">Create key</h2></div>
            <div className="space-y-4">
              <label className="block text-sm font-bold text-slate-700">Name<input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-cyan-500" /></label>
              <label className="block text-sm font-bold text-slate-700">Expires<input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-cyan-500" /></label>
              <div>
                <p className="mb-2 text-sm font-bold text-slate-700">Scopes</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {API_SCOPES.map((scope) => (
                    <label key={scope} className="flex cursor-pointer items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50">
                      <input type="checkbox" checked={selectedScopes.includes(scope)} onChange={() => toggleScope(scope)} className="h-4 w-4 accent-cyan-700" />
                      {scope}
                    </label>
                  ))}
                </div>
              </div>
              <button onClick={createKey} disabled={submitting} className="w-full rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-50">
                {submitting ? "Creating..." : "Create API key"}
              </button>
            </div>
          </div>

          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-3"><Shield className="h-5 w-5 text-cyan-700" /><h2 className="text-xl font-semibold">Workspace keys</h2></div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500">{activeKeys.length} active</span>
            </div>
            {loading ? <div className="p-8 text-center text-slate-500">Loading keys...</div> : keys.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-slate-500">No API keys created yet.</div>
            ) : (
              <div className="space-y-3">
                {keys.map((key) => (
                  <article key={key.id} className={`rounded-3xl border p-4 ${key.revokedAt ? "border-slate-200 bg-slate-50 opacity-70" : "border-slate-200 bg-white"}`}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-bold text-slate-950">{key.name}</p>
                        <p className="mt-1 font-mono text-xs text-slate-500">{key.keyPrefix}...</p>
                        <p className="mt-2 text-xs text-slate-500">Last used: {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : "Never"}</p>
                      </div>
                      <div className="flex gap-2">
                        {!key.revokedAt && <button onClick={() => rotateKey(key.id)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:border-cyan-300 hover:text-cyan-700"><RefreshCcw className="mr-1 inline h-3 w-3" />Rotate</button>}
                        {!key.revokedAt && <button onClick={() => revokeKey(key.id)} className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100"><Trash2 className="mr-1 inline h-3 w-3" />Revoke</button>}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {key.scopes.map((scope) => <span key={`${key.id}-${scope}`} className="rounded-full bg-cyan-50 px-2 py-1 text-[11px] font-bold text-cyan-700">{scope}</span>)}
                      {key.revokedAt && <span className="rounded-full bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700">revoked</span>}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-4"><h2 className="flex items-center gap-2 text-xl font-semibold"><Code2 className="h-5 w-5 text-cyan-700" />Recent API requests</h2></div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500"><tr><th className="px-6 py-3">Time</th><th className="px-6 py-3">Method</th><th className="px-6 py-3">Path</th><th className="px-6 py-3">Status</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {usage.slice(0, 25).map((request) => (
                  <tr key={request.id}><td className="whitespace-nowrap px-6 py-3 text-slate-500">{new Date(request.createdAt).toLocaleString()}</td><td className="px-6 py-3 font-mono font-bold">{request.method}</td><td className="max-w-[520px] truncate px-6 py-3 font-mono text-xs text-slate-600">{request.path}</td><td className="px-6 py-3"><span className={`rounded-full px-2 py-1 text-xs font-bold ${request.status < 400 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{request.status}</span></td></tr>
                ))}
                {usage.length === 0 && <tr><td colSpan={4} className="px-6 py-10 text-center text-slate-500">No public API traffic recorded yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
