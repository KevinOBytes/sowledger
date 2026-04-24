"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bell, Code2, CreditCard, FileDown, Settings, Tag, UserRound, Webhook } from "lucide-react";

type UserData = {
  id: string;
  email: string;
  displayName: string;
  timezone: string;
  preferredTags: string[];
};

const SETTINGS_LINKS = [
  { href: "/settings/billing", title: "Billing", description: "Manage plans, Stripe checkout, and subscription portal.", icon: CreditCard },
  { href: "/settings/developers", title: "Developers", description: "Create API keys, inspect usage, and open API docs.", icon: Code2 },
  { href: "/exports", title: "Exports", description: "Download complete or filtered workspace data.", icon: FileDown },
  { href: "/settings/tags", title: "Tags", description: "Maintain workspace tag metadata and billing defaults.", icon: Tag },
  { href: "/settings/actions", title: "Actions", description: "Configure action rates for timer and manual entries.", icon: Bell },
  { href: "/settings/webhooks", title: "Webhooks", description: "Connect Billabled events to external systems.", icon: Webhook },
];

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
        if (res.status === 401) {
          router.push("/login");
          return null;
        }
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
      <main className="flex min-h-screen items-center justify-center bg-[#f6f3ee]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-cyan-600" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f6f3ee] p-4 text-slate-950 sm:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Settings</p>
          <h1 className="mt-2 flex items-center gap-3 text-3xl font-semibold tracking-tight sm:text-4xl"><Settings className="h-7 w-7 text-cyan-700" />Workspace and profile controls</h1>
          {user && <p className="mt-2 text-sm text-slate-500">Signed in as {user.email}</p>}
        </header>

        <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <form onSubmit={handleSave} className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center gap-3"><UserRound className="h-5 w-5 text-cyan-700" /><h2 className="text-xl font-semibold">Profile defaults</h2></div>
            <div className="space-y-5">
              <label htmlFor="displayName" className="block text-sm font-bold text-slate-700">Display name<input id="displayName" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" className="mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" /></label>
              <label htmlFor="timezone" className="block text-sm font-bold text-slate-700">Timezone<input id="timezone" type="text" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="UTC" className="mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" /><span className="mt-1 block text-xs font-normal text-slate-500">Use an IANA timezone, for example America/New_York.</span></label>
              <label htmlFor="preferredTags" className="block text-sm font-bold text-slate-700">Preferred tags<input id="preferredTags" type="text" value={preferredTags} onChange={(e) => setPreferredTags(e.target.value)} placeholder="focus, client-a, deep-work" className="mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" /><span className="mt-1 block text-xs font-normal text-slate-500">Comma-separated default timer tags.</span></label>
              {message && <div className={`rounded-2xl px-3 py-2 text-sm font-semibold ${message.type === "success" ? "border border-emerald-200 bg-emerald-50 text-emerald-700" : "border border-rose-200 bg-rose-50 text-rose-700"}`}>{message.text}</div>}
              <button type="submit" disabled={saving} className="w-full rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-50">{saving ? "Saving..." : "Save settings"}</button>
            </div>
          </form>

          <div className="grid gap-4 sm:grid-cols-2">
            {SETTINGS_LINKS.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} className="group rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:border-cyan-200 hover:shadow-md">
                  <div className="rounded-2xl bg-cyan-50 p-3 text-cyan-700 w-fit"><Icon className="h-5 w-5" /></div>
                  <h2 className="mt-4 text-xl font-semibold">{item.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500">{item.description}</p>
                </Link>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
