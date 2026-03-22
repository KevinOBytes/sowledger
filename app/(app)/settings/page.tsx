"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type UserData = {
  id: string;
  email: string;
  displayName: string;
  timezone: string;
  preferredTags: string[];
};

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserData | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [preferredTags, setPreferredTags] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/user/settings")
      .then((res) => {
        if (res.status === 401) { router.push("/login"); return null; }
        return res.json() as Promise<{ ok: boolean; user: UserData }>;
      })
      .then((data) => {
        if (!data) return;
        setUser(data.user);
        setDisplayName(data.user.displayName ?? "");
        setTimezone(data.user.timezone ?? "UTC");
        setPreferredTags((data.user.preferredTags ?? []).join(", "));
      })
      .finally(() => setLoading(false));
  }, [router]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    const res = await fetch("/api/user/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: displayName.trim() || undefined,
        timezone,
        preferredTags: preferredTags.split(",").map((t) => t.trim()).filter(Boolean),
      }),
    });

    const data = await res.json() as { ok?: boolean; user?: UserData; error?: string };
    if (res.ok && data.user) {
      setUser(data.user);
      setMessage({ type: "success", text: "Settings saved successfully." });
    } else {
      setMessage({ type: "error", text: data.error ?? "Failed to save settings." });
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-cyan-500" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-lg space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">User Settings</h1>
            {user && <p className="mt-1 text-sm text-slate-400">{user.email}</p>}
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/settings/billing"
              className="rounded-lg border border-cyan-700 bg-cyan-900/30 px-4 py-2 text-sm font-medium text-cyan-300 transition hover:bg-cyan-800/40 hover:text-white shadow-sm"
            >
              Billing & Plans
            </Link>
            <Link
              href="/"
              className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-700 hover:text-white shadow-sm"
            >
              ← Back
            </Link>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSave} className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <div>
            <label htmlFor="displayName" className="mb-1 block text-sm font-medium text-slate-300">
              Display Name
            </label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
          </div>

          <div>
            <label htmlFor="timezone" className="mb-1 block text-sm font-medium text-slate-300">
              Timezone
            </label>
            <input
              id="timezone"
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="UTC"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
            <p className="mt-1 text-xs text-slate-500">
              Enter an IANA timezone, e.g. <code className="text-slate-400">America/New_York</code>
            </p>
          </div>

          <div>
            <label htmlFor="preferredTags" className="mb-1 block text-sm font-medium text-slate-300">
              Preferred Tags
            </label>
            <input
              id="preferredTags"
              type="text"
              value={preferredTags}
              onChange={(e) => setPreferredTags(e.target.value)}
              placeholder="focus, client-a, deep-work"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
            <p className="mt-1 text-xs text-slate-500">Comma-separated list of your default timer tags.</p>
          </div>

          {message && (
            <div className={`rounded-lg px-3 py-2 text-sm ${
              message.type === "success"
                ? "border border-emerald-700/40 bg-emerald-900/20 text-emerald-400"
                : "border border-rose-700/40 bg-rose-900/20 text-rose-400"
            }`}>
              {message.text}
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg bg-cyan-600 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save settings"}
          </button>
        </form>
      </div>
    </main>
  );
}
