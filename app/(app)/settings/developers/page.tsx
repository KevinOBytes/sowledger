"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  CheckCircle2,
  Code2,
  Copy,
  ExternalLink,
  KeyRound,
  LockKeyhole,
  RefreshCcw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { AppEmptyState, AppMetricCard, AppPageHeader, AppPageShell, AppWorkflowRail } from "@/components/app-page-shell";

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
  "read:proof-packs",
  "read:revenue-intelligence",
  "export:data",
] as const;

type ApiScope = (typeof API_SCOPES)[number];

const DEFAULT_SCOPES: ApiScope[] = ["read:clients", "read:projects", "read:time", "read:analytics", "export:data"];
const READ_AND_EXPORT_SCOPES = API_SCOPES.filter((scope) => scope.startsWith("read:") || scope === "export:data");

const SCOPE_GROUPS: Array<{ title: string; scopes: ApiScope[] }> = [
  {
    title: "Workspace records",
    scopes: ["read:clients", "write:clients", "read:projects", "write:projects", "read:tags", "write:tags", "read:tasks", "write:tasks"],
  },
  {
    title: "Planning and time",
    scopes: ["read:schedule", "write:schedule", "read:time", "write:time"],
  },
  {
    title: "Proof, analytics, and export",
    scopes: ["read:analytics", "read:invoices", "read:proof-packs", "read:revenue-intelligence", "export:data"],
  },
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

type ApiKeysResponse = {
  error?: string;
  keys?: ApiKey[];
  usage?: Usage[];
  rawKey?: string;
};

function defaultExpiry() {
  const date = new Date();
  date.setMonth(date.getMonth() + 6);
  return toDateInputValue(date);
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toLocalEndOfDayISOString(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return new Date(value).toISOString();

  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), 23, 59, 59, 999).toISOString();
}

function formatDateTime(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function formatDate(value: string | null) {
  if (!value) return "No expiry";
  return new Date(value).toLocaleDateString();
}

function keyExpired(key: ApiKey) {
  return Boolean(key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now());
}

function setScopeOrder(scopes: ApiScope[]) {
  const next = new Set(scopes);
  return API_SCOPES.filter((scope) => next.has(scope));
}

function statusTone(key: ApiKey) {
  if (key.revokedAt) return "bg-rose-50 text-rose-700";
  if (keyExpired(key)) return "bg-amber-50 text-amber-700";
  return "bg-emerald-50 text-emerald-700";
}

function statusLabel(key: ApiKey) {
  if (key.revokedAt) return "Revoked";
  if (keyExpired(key)) return "Expired";
  return "Active";
}

export default function DevelopersPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [usage, setUsage] = useState<Usage[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("Agency billing integration");
  const [expiresAt, setExpiresAt] = useState(defaultExpiry());
  const [selectedScopes, setSelectedScopes] = useState<ApiScope[]>(DEFAULT_SCOPES);
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rotatingKeyIds, setRotatingKeyIds] = useState<Set<string>>(() => new Set());
  const [revokingKeyIds, setRevokingKeyIds] = useState<Set<string>>(() => new Set());
  const rawKeySectionRef = useRef<HTMLElement | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/settings/api-keys");
      const data = (await response.json()) as ApiKeysResponse;
      if (!response.ok) throw new Error(data.error || "Unable to load API keys");
      setKeys(data.keys ?? []);
      setUsage(data.usage ?? []);
    } catch (error) {
      toast.error("Developer settings unavailable", { description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (rawKey) rawKeySectionRef.current?.focus();
  }, [rawKey]);

  const activeKeys = useMemo(() => keys.filter((key) => !key.revokedAt && !keyExpired(key)), [keys]);
  const revokedKeys = useMemo(() => keys.filter((key) => key.revokedAt), [keys]);
  const recentUsage = useMemo(() => usage.slice(0, 25), [usage]);
  const keyLookup = useMemo(() => new Map(keys.map((key) => [key.id, key])), [keys]);
  const selectedScopeSet = useMemo(() => new Set(selectedScopes), [selectedScopes]);
  const createDisabled = submitting || !name.trim() || selectedScopes.length === 0;

  function toggleScope(scope: ApiScope) {
    setSelectedScopes((current) => {
      if (current.includes(scope)) return current.filter((item) => item !== scope);
      return setScopeOrder([...current, scope]);
    });
  }

  function applyScopePreset(scopes: ApiScope[]) {
    setSelectedScopes(setScopeOrder(scopes));
  }

  function updateRotatingState(keyId: string, pending: boolean) {
    setRotatingKeyIds((current) => {
      const next = new Set(current);
      if (pending) next.add(keyId);
      else next.delete(keyId);
      return next;
    });
  }

  function updateRevokingState(keyId: string, pending: boolean) {
    setRevokingKeyIds((current) => {
      const next = new Set(current);
      if (pending) next.add(keyId);
      else next.delete(keyId);
      return next;
    });
  }

  async function createKey() {
    if (submitting) return;
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
        body: JSON.stringify({ name: name.trim(), scopes: selectedScopes, expiresAt: expiresAt ? toLocalEndOfDayISOString(expiresAt) : null }),
      });
      const data = (await response.json()) as ApiKeysResponse;
      if (!response.ok) throw new Error(data.error || "Unable to create key");
      setRawKey(data.rawKey ?? null);
      setName("Agency billing integration");
      await refresh();
      toast.success("API key created");
    } catch (error) {
      toast.error("Could not create API key", { description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setSubmitting(false);
    }
  }

  async function rotateKey(keyId: string) {
    if (rotatingKeyIds.has(keyId) || revokingKeyIds.has(keyId)) return;
    updateRotatingState(keyId, true);
    setRawKey(null);
    try {
      const response = await fetch("/api/settings/api-keys", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyId, rotate: true }),
      });
      const data = (await response.json()) as ApiKeysResponse;
      if (!response.ok) throw new Error(data.error || "Unable to rotate key");
      setRawKey(data.rawKey ?? null);
      await refresh();
      toast.success("API key rotated");
    } catch (error) {
      toast.error("Could not rotate API key", { description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      updateRotatingState(keyId, false);
    }
  }

  async function revokeKey(keyId: string) {
    if (revokingKeyIds.has(keyId) || rotatingKeyIds.has(keyId)) return;
    updateRevokingState(keyId, true);
    try {
      const response = await fetch(`/api/settings/api-keys?keyId=${encodeURIComponent(keyId)}`, { method: "DELETE" });
      const data = (await response.json()) as ApiKeysResponse;
      if (!response.ok) throw new Error(data.error || "Unable to revoke key");
      await refresh();
      toast.success("API key revoked");
    } catch (error) {
      toast.error("Could not revoke API key", { description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      updateRevokingState(keyId, false);
    }
  }

  async function copyRawKey() {
    if (!rawKey) return;
    try {
      await navigator.clipboard.writeText(rawKey);
      toast.success("API key copied");
    } catch {
      toast.error("Could not copy API key");
    }
  }

  return (
    <AppPageShell contentClassName="space-y-5">
      <AppPageHeader
        eyebrow="Developers"
        title="Agency integrations, API keys, usage, and docs"
        description="Create scoped workspace keys for agency systems, then review request-level usage while keeping billing and workspace administration in the app."
        icon={Code2}
        metadata={[
          { label: "Scoped keys", tone: "cyan", icon: KeyRound },
          { label: "Usage tracked per request", tone: "slate", icon: Activity },
        ]}
        primaryAction={(
          <Link href="/support/api" className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-slate-800 sm:w-auto">
            API usage guide
            <ExternalLink className="h-4 w-4" />
          </Link>
        )}
      />

      <AppWorkflowRail current="integrate" />

      {rawKey && (
        <section
          ref={rawKeySectionRef}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          tabIndex={-1}
          className="rounded-[32px] border border-amber-200 bg-amber-50 p-5 text-amber-950 shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="font-bold">New API key. It is shown only once.</p>
              <p className="mt-1 break-all font-mono text-sm">{rawKey}</p>
            </div>
            <button
              onClick={copyRawKey}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-900 px-4 py-2 text-sm font-bold text-white transition hover:bg-amber-800 sm:w-auto"
            >
              <Copy className="h-4 w-4" />
              Copy
            </button>
          </div>
        </section>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AppMetricCard label="Active keys" value={activeKeys.length} detail="Not revoked or expired." accent="cyan" icon={KeyRound} />
        <AppMetricCard label="Revoked keys" value={revokedKeys.length} detail="Retained as workspace key metadata." accent={revokedKeys.length > 0 ? "rose" : "slate"} icon={Trash2} />
        <AppMetricCard label="Recent requests" value={usage.length} detail="Records returned by usage tracking." accent={usage.length > 0 ? "emerald" : "slate"} icon={Activity} />
        <AppMetricCard label="Selected scopes" value={`${selectedScopes.length}/${API_SCOPES.length}`} detail="Applied to the next generated key." accent={selectedScopes.length > 0 ? "cyan" : "amber"} icon={ShieldCheck} />
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="space-y-6">
          <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm" aria-labelledby="create-api-key-heading">
            <div className="mb-5 flex items-center gap-3">
              <KeyRound className="h-5 w-5 text-cyan-700" />
              <div>
                <h2 id="create-api-key-heading" className="text-xl font-semibold">Create API key</h2>
                <p className="mt-1 text-sm text-slate-500">Name the integration, choose scopes, and set an expiry.</p>
              </div>
            </div>
            <form
              className="space-y-5"
              onSubmit={(event) => {
                event.preventDefault();
                void createKey();
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-bold text-slate-700" htmlFor="api-key-name">
                  Name
                  <input
                    id="api-key-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500"
                  />
                </label>
                <label className="block text-sm font-bold text-slate-700" htmlFor="api-key-expires">
                  Expires
                  <input
                    id="api-key-expires"
                    type="date"
                    value={expiresAt}
                    onChange={(event) => setExpiresAt(event.target.value)}
                    className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500"
                  />
                </label>
              </div>

              <div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-bold text-slate-700">Scopes</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">{selectedScopes.length} selected for this key</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                    <button type="button" onClick={() => applyScopePreset(DEFAULT_SCOPES)} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:border-cyan-300 hover:text-cyan-700">
                      Recommended
                    </button>
                    <button type="button" onClick={() => applyScopePreset(READ_AND_EXPORT_SCOPES)} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:border-cyan-300 hover:text-cyan-700">
                      Read + export
                    </button>
                    <button type="button" onClick={() => applyScopePreset([...API_SCOPES])} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:border-cyan-300 hover:text-cyan-700">
                      All
                    </button>
                    <button type="button" onClick={() => setSelectedScopes([])} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:border-rose-200 hover:text-rose-700">
                      Clear
                    </button>
                  </div>
                </div>

                <div className="mt-4 space-y-4">
                  {SCOPE_GROUPS.map((group) => (
                    <div key={group.title}>
                      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{group.title}</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {group.scopes.map((scope) => {
                          const checked = selectedScopeSet.has(scope);
                          return (
                            <label
                              key={scope}
                              className={`flex min-w-0 cursor-pointer items-start gap-3 rounded-2xl border px-3 py-2.5 text-xs font-bold transition ${checked ? "border-cyan-200 bg-cyan-50 text-cyan-900" : "border-slate-200 bg-slate-50 text-slate-700 hover:border-cyan-200 hover:bg-cyan-50"}`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleScope(scope)}
                                className="mt-0.5 h-4 w-4 shrink-0 accent-cyan-700"
                              />
                              <span className="min-w-0 break-all font-mono">{scope}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={createDisabled}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <KeyRound className="h-4 w-4" />
                {submitting ? "Creating..." : "Create API key"}
              </button>
            </form>
          </section>

          <section className="rounded-[32px] border border-cyan-100 bg-cyan-50 p-5 text-cyan-950 shadow-sm" aria-labelledby="developer-security-boundary">
            <div className="flex items-start gap-3">
              <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-cyan-700" />
              <div>
                <h2 id="developer-security-boundary" className="text-base font-semibold">Security boundary</h2>
                <ul className="mt-3 space-y-2 text-sm leading-6">
                  <li className="flex gap-2"><CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-cyan-700" />Secrets are shown once, then stored only as hashes.</li>
                  <li className="flex gap-2"><CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-cyan-700" />Keys stay scoped, revocable, expirable, and usage-tracked.</li>
                  <li className="flex gap-2"><CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-cyan-700" />The API does not expose billing, invite, or workspace administration changes.</li>
                </ul>
              </div>
            </div>
          </section>

          <section className="rounded-[32px] border border-stone-200 bg-stone-50 p-5 text-stone-900 shadow-sm" aria-labelledby="developer-mcp-server">
            <div className="flex items-start gap-3">
              <Code2 className="mt-0.5 h-5 w-5 shrink-0 text-cyan-700" />
              <div className="min-w-0 flex-1">
                <h2 id="developer-mcp-server" className="text-base font-semibold">AI Agents via MCP</h2>
                <p className="mt-2 text-sm leading-6 text-stone-600">Connect Claude Desktop, Cursor, or other AI agents natively using our Model Context Protocol (MCP) server. Provide the key above to authenticate.</p>
                <pre className="mt-3 min-w-0 max-w-full overflow-x-auto rounded-xl bg-slate-950 p-3 text-xs text-cyan-100 font-mono"><code>{`{
  "mcpServers": {
    "sowledger": {
      "command": "npx",
      "args": ["-y", "@sowledger/mcp"],
      "env": {
        "SOWLEDGER_API_KEY": "YOUR_API_KEY"
      }
    }
  }
}`}</code></pre>
              </div>
            </div>
          </section>
        </div>

        <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm" aria-labelledby="workspace-keys-heading">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-cyan-700" />
              <h2 id="workspace-keys-heading" className="text-xl font-semibold">Workspace keys</h2>
            </div>
            <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500">{activeKeys.length} active</span>
          </div>

          {loading ? (
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-8 text-center text-sm font-semibold text-slate-500">Loading keys...</div>
          ) : keys.length === 0 ? (
            <AppEmptyState
              icon={KeyRound}
              title="No API keys created yet."
              description="Create a scoped key for a reporting integration, agency data sync, or trusted automation."
              className="border-slate-200 bg-slate-50 shadow-none"
            />
          ) : (
            <div className="space-y-3">
              {keys.map((key) => {
                const rotating = rotatingKeyIds.has(key.id);
                const revoking = revokingKeyIds.has(key.id);
                const actionPending = rotating || revoking;
                return (
                  <article key={key.id} className={`rounded-3xl border p-4 ${key.revokedAt ? "border-slate-200 bg-slate-50 opacity-75" : "border-slate-200 bg-white"}`}>
                    <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="min-w-0 break-words font-bold text-slate-950">{key.name}</p>
                          <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${statusTone(key)}`}>{statusLabel(key)}</span>
                        </div>
                        <p className="mt-1 break-all font-mono text-xs text-slate-500">{key.keyPrefix}...</p>
                        <dl className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                          <div><dt className="font-bold text-slate-600">Last used</dt><dd>{formatDateTime(key.lastUsedAt)}</dd></div>
                          <div><dt className="font-bold text-slate-600">Expires</dt><dd>{formatDate(key.expiresAt)}</dd></div>
                        </dl>
                      </div>
                      {!key.revokedAt && (
                        <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
                          <button
                            onClick={() => void rotateKey(key.id)}
                            disabled={actionPending}
                            className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-cyan-300 hover:text-cyan-700 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
                          >
                            <RefreshCcw className="h-3.5 w-3.5" />
                            {rotating ? "Rotating..." : "Rotate"}
                          </button>
                          <button
                            onClick={() => void revokeKey(key.id)}
                            disabled={actionPending}
                            className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {revoking ? "Revoking..." : "Revoke"}
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {key.scopes.map((scope) => (
                        <span key={`${key.id}-${scope}`} className="max-w-full break-all rounded-full bg-cyan-50 px-2 py-1 font-mono text-[11px] font-bold text-cyan-700">{scope}</span>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </section>

      <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm" aria-labelledby="recent-api-requests-heading">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="recent-api-requests-heading" className="flex items-center gap-2 text-xl font-semibold">
            <Code2 className="h-5 w-5 text-cyan-700" />
            Recent API requests
          </h2>
          <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Most recent 25 shown</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[820px] w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-6 py-3">Time</th>
                <th scope="col" className="px-6 py-3">Key</th>
                <th scope="col" className="px-6 py-3">Method</th>
                <th scope="col" className="px-6 py-3">Path</th>
                <th scope="col" className="px-6 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-slate-500">Loading API requests...</td>
                </tr>
              ) : recentUsage.map((request) => {
                const key = keyLookup.get(request.apiKeyId);
                return (
                  <tr key={request.id}>
                    <td className="whitespace-nowrap px-6 py-3 text-slate-500">{formatDateTime(request.createdAt)}</td>
                    <td className="max-w-[220px] truncate px-6 py-3 text-slate-600">{key ? key.name : request.apiKeyId}</td>
                    <td className="px-6 py-3 font-mono font-bold">{request.method}</td>
                    <td className="max-w-[520px] truncate px-6 py-3 font-mono text-xs text-slate-600">{request.path}</td>
                    <td className="px-6 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-bold ${request.status < 400 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{request.status}</span>
                    </td>
                  </tr>
                );
              })}
              {!loading && usage.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-slate-500">No public API traffic recorded yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AppPageShell>
  );
}
