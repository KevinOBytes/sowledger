"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bell, Code2, CreditCard, FileDown, Plug, Tag, UserRound, Webhook } from "lucide-react";
import { DataLoadNotice } from "@/components/data-load-notice";
import { normalizeTags } from "@/lib/validators";

type UserData = {
  id: string;
  email: string;
  displayName: string;
  timezone: string;
  preferredTags: string[];
  calendarPreferences: { visibleStartHour?: number; visibleEndHour?: number };
};

function isProfile(value: unknown): value is UserData {
  if (!value || typeof value !== "object") return false;
  const user = value as Record<string, unknown>;
  return typeof user.id === "string" && !!user.id && typeof user.email === "string" && typeof user.displayName === "string" && typeof user.timezone === "string" && Array.isArray(user.preferredTags) && user.preferredTags.every(tag => typeof tag === "string") && !!user.calendarPreferences && typeof user.calendarPreferences === "object" && !Array.isArray(user.calendarPreferences);
}

const SETTINGS_LINKS = [
  { href: "/settings/billing", title: "Billing", description: "View your plan and manage the workspace subscription.", icon: CreditCard },
  { href: "/integrations", title: "Integrations", description: "Connect Google Calendar, Slack, QuickBooks, and your own tools.", icon: Plug },
  { href: "/settings/developers", title: "Developers", description: "Create API keys, review requests, and find documentation.", icon: Code2 },
  { href: "/exports", title: "Exports", description: "Download time-entry spreadsheets or workspace records.", icon: FileDown },
  { href: "/settings/tags", title: "Tags", description: "Manage shared tag names, colors, and reference labels.", icon: Tag },
  { href: "/settings/actions", title: "Work types", description: "Save the work types and rates you use often.", icon: Bell },
  { href: "/settings/webhooks", title: "Webhooks", description: "Connect SOWLedger events to external systems.", icon: Webhook },
];

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserData | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [preferredTags, setPreferredTags] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/user/settings")
      .then((res) => {
        if (!active) return null;
        if (res.status === 401) {
          router.push("/login");
          return null;
        }
        if (!res.ok) throw new Error("Settings request failed");
        return res.json() as Promise<{ ok: boolean; user: UserData }>;
      })
      .then((data) => {
        if (!active || !data) return;
        if (!data.ok || !isProfile(data.user)) throw new Error("Settings response is incomplete");
        setUser(data.user);
        setDisplayName(data.user.displayName ?? "");
        setTimezone(data.user.timezone ?? "UTC");
        setPreferredTags((data.user.preferredTags ?? []).join(", "));
      })
      .catch(() => { if (active) setLoadError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [router]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (savingRef.current || !user) return;
    savingRef.current = true;
    setSaving(true);
    setMessage(null);
    const submitted = { displayName: displayName.trim(), timezone, preferredTags: normalizeTags(preferredTags.split(",")) };

    try {
      const res = await fetch("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submitted),
      });

      const data = await res.json() as { ok?: boolean; user?: UserData; error?: string };
      if (res.ok && data.ok === true && isProfile(data.user) && data.user.id === user.id && data.user.email === user.email && data.user.displayName === submitted.displayName && data.user.timezone === submitted.timezone && JSON.stringify(data.user.preferredTags) === JSON.stringify(submitted.preferredTags)) {
        setUser(data.user);
        setDisplayName(data.user.displayName);
        setTimezone(data.user.timezone);
        setPreferredTags(data.user.preferredTags.join(", "));
        setMessage({ type: "success", text: "Settings saved." });
      } else {
        setMessage({ type: "error", text: "Could not confirm your settings were saved. Your changes are still here; please try again." });
      }
    } catch {
      setMessage({ type: "error", text: "Could not save your settings. Your changes are still here; please try again." });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  useEffect(() => {
    if (message?.type === "error") feedbackRef.current?.focus();
  }, [message]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f6f3ee]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-cyan-600" />
      </main>
    );
  }

  if (loadError || !user) {
    return <main className="min-h-screen bg-[#f6f3ee] p-4 sm:p-8"><h1 className="mb-5 text-3xl font-semibold">Settings</h1><DataLoadNotice message="We couldn't load your settings." /></main>;
  }

  return (
    <main className="min-h-screen bg-[#f6f3ee] p-4 text-slate-950 sm:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Settings</h1>
          {user && <p className="mt-2 text-sm text-slate-500">Signed in as {user.email}</p>}
        </header>

        <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <form onSubmit={handleSave} className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center gap-3"><UserRound className="h-5 w-5 text-cyan-700" /><h2 className="text-xl font-semibold">Your profile</h2></div>
            <fieldset disabled={saving} className="min-w-0 space-y-5">
              <label htmlFor="displayName" className="block text-sm font-bold text-slate-700">Display name<input id="displayName" type="text" autoComplete="name" maxLength={255} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" className="mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" /></label>
              <label htmlFor="timezone" className="block text-sm font-bold text-slate-700">Timezone<input id="timezone" type="text" required maxLength={100} value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="UTC" className="mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" /><span className="mt-1 block text-xs font-normal text-slate-500">Use an IANA timezone, for example America/New_York.</span></label>
              <label htmlFor="preferredTags" className="block text-sm font-bold text-slate-700">Preferred tags<input id="preferredTags" type="text" value={preferredTags} onChange={(e) => setPreferredTags(e.target.value)} placeholder="focus, client-a, deep-work" className="mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" /><span className="mt-1 block text-xs font-normal text-slate-500">Separate your preferred tags with commas. These are saved to your profile.</span></label>
              {message && <div ref={feedbackRef} tabIndex={-1} role={message.type === "error" ? "alert" : "status"} className={`rounded-2xl px-3 py-2 text-sm font-semibold ${message.type === "success" ? "border border-emerald-200 bg-emerald-50 text-emerald-700" : "border border-rose-200 bg-rose-50 text-rose-700"}`}>{message.text}</div>}
              {saving && <p role="status" className="text-sm text-slate-500">Saving your profile…</p>}
              <button type="submit" disabled={saving} className="w-full rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-50">{saving ? "Saving..." : "Save settings"}</button>
            </fieldset>
          </form>

          <nav aria-label="Settings navigation" className="self-start rounded-[28px] border border-slate-200 bg-white p-2 shadow-sm"><ul className="divide-y divide-slate-100">
            {SETTINGS_LINKS.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.href}><Link href={item.href} className="flex items-start gap-3 rounded-2xl p-4 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-cyan-600">
                  <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-cyan-700" />
                  <span className="min-w-0"><span className="block font-semibold">{item.title}</span><span className="mt-1 block text-sm text-slate-500">{item.description}</span></span>
                </Link></li>
              );
            })}
          </ul></nav>
        </section>
      </div>
    </main>
  );
}
