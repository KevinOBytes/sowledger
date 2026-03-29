"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Zap, Building, Building2 } from "lucide-react";

type BillingData = {
  plan: "free" | "pro" | "smb" | "enterprise";
  isOwner: boolean;
  usage: { members: number; projects: number; };
  limits: { maxMembers: number; maxProjects: number; canUseInvoices: boolean; canUseWebhooks: boolean; };
  prices: { pro?: string; smb?: string; };
};

export default function BillingPage() {
  // const router = useRouter();
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/billing")
      .then((res) => res.json())
      .then((d) => {
        if (d.ok) setData(d);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleUpgrade(priceId?: string, actionId?: string) {
    if (!priceId || !actionId) return;
    setProcessing(actionId);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId }),
      });
      const resData = await res.json();
      if (resData.url) {
        window.location.href = resData.url;
      } else {
        alert(resData.error || "Failed to start checkout");
        setProcessing(null);
      }
    } catch {
      alert("Error starting checkout");
      setProcessing(null);
    }
  }

  async function handlePortal() {
    setProcessing("portal");
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const resData = await res.json();
      if (resData.url) {
        window.location.href = resData.url;
      } else {
        alert(resData.error || "Failed to open portal");
        setProcessing(null);
      }
    } catch {
      alert("Error opening portal");
      setProcessing(null);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-cyan-500" />
      </main>
    );
  }

  if (!data) return <div className="p-8 text-white">Error loading billing</div>;

  const mPercent = data.limits.maxMembers > 1000 ? 0 : Math.min(100, Math.round((data.usage.members / data.limits.maxMembers) * 100));
  const pPercent = data.limits.maxProjects > 1000 ? 0 : Math.min(100, Math.round((data.usage.projects / data.limits.maxProjects) * 100));

  return (
    <main className="min-h-screen bg-slate-950 p-6 sm:p-12 text-slate-100">
      <div className="mx-auto max-w-4xl space-y-12">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight">Billing & Plans</h1>
            <p className="mt-2 text-slate-400">Manage your subscription and track workspace usage.</p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/settings"
              className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-700 hover:text-white"
            >
              ← Back to Settings
            </Link>
            {data.isOwner && data.plan !== "free" && (
              <button
                onClick={handlePortal}
                disabled={processing === "portal"}
                className="rounded-lg bg-slate-800 border border-slate-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
              >
                {processing === "portal" ? "Opening..." : "Manage Subscription"}
              </button>
            )}
          </div>
        </div>

        {/* Current Usage Tracker */}
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 backdrop-blur-sm shadow-xl">
            <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-4">Workspace Members</h3>
            <div className="flex items-end justify-between mb-2">
              <span className="text-3xl font-bold text-white">{data.usage.members}</span>
              <span className="text-sm text-slate-500 mb-1">/ {data.limits.maxMembers > 1000 ? "Unlimited" : data.limits.maxMembers}</span>
            </div>
            {data.limits.maxMembers <= 1000 && (
              <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                <div className={`h-full ${mPercent >= 100 ? "bg-red-500" : "bg-cyan-500"} transition-all duration-500`} style={{ width: `${mPercent}%` }} />
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 backdrop-blur-sm shadow-xl">
            <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-4">Active Projects</h3>
            <div className="flex items-end justify-between mb-2">
              <span className="text-3xl font-bold text-white">{data.usage.projects}</span>
              <span className="text-sm text-slate-500 mb-1">/ {data.limits.maxProjects > 1000 ? "Unlimited" : data.limits.maxProjects}</span>
            </div>
            {data.limits.maxProjects <= 1000 && (
              <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                <div className={`h-full ${pPercent >= 100 ? "bg-red-500" : "bg-cyan-500"} transition-all duration-500`} style={{ width: `${pPercent}%` }} />
              </div>
            )}
          </div>
        </div>

        {/* Plans Grid */}
        <div className="grid gap-6 lg:grid-cols-3">
          
          {/* Pro Plan */}
          <div className={`relative flex flex-col rounded-3xl border p-8 shadow-2xl transition-all duration-300 ${data.plan === "pro" ? "border-cyan-500 bg-slate-900 shadow-cyan-900/20 scale-105 z-10" : "border-slate-800 bg-slate-900/50 hover:border-slate-700"}`}>
            {data.plan === "pro" && <div className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-cyan-500 px-3 py-1 text-xs font-bold text-slate-950">CURRENT PLAN</div>}
            <div className="mb-6 flex items-center gap-3">
              <div className={`rounded-xl p-2 ${data.plan === "pro" ? "bg-cyan-500/10 text-cyan-400" : "bg-slate-800 text-slate-400"}`}>
                <Zap className="h-6 w-6" />
              </div>
              <h2 className="text-xl font-bold text-white">Pro</h2>
            </div>
            <div className="mb-6">
              <span className="text-4xl font-extrabold text-white">$9</span>
              <span className="text-slate-500 font-medium">/mo</span>
            </div>
            <ul className="mb-8 flex-1 space-y-4">
              <li className="flex items-start gap-3 text-sm text-slate-300">
                <Check className="h-5 w-5 shrink-0 text-cyan-500" />
                <span>Unlimited Projects</span>
              </li>
              <li className="flex items-start gap-3 text-sm text-slate-300">
                <Check className="h-5 w-5 shrink-0 text-cyan-500" />
                <span>Client Invoicing</span>
              </li>
              <li className="flex items-start gap-3 text-sm text-slate-300">
                <Check className="h-5 w-5 shrink-0 text-cyan-500" />
                <span>1 Member included</span>
              </li>
            </ul>
            {data.isOwner && data.plan === "free" && data.prices.pro && (
              <button
                onClick={() => handleUpgrade(data.prices.pro, "pro")}
                disabled={processing !== null}
                className="w-full rounded-xl bg-cyan-600 py-3 text-sm font-bold text-white shadow-lg transition hover:bg-cyan-500 disabled:opacity-50"
              >
                {processing === "pro" ? "Redirecting..." : "Upgrade to Pro"}
              </button>
            )}
          </div>

          {/* SMB Plan */}
          <div className={`relative flex flex-col rounded-3xl border p-8 shadow-2xl transition-all duration-300 ${data.plan === "smb" ? "border-purple-500 bg-slate-900 shadow-purple-900/20 scale-105 z-10" : "border-slate-800 bg-slate-900/50 hover:border-slate-700"}`}>
            {data.plan === "smb" && <div className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-purple-500 px-3 py-1 text-xs font-bold text-slate-950">CURRENT PLAN</div>}
            <div className="mb-6 flex items-center gap-3">
              <div className={`rounded-xl p-2 ${data.plan === "smb" ? "bg-purple-500/10 text-purple-400" : "bg-slate-800 text-slate-400"}`}>
                <Building className="h-6 w-6" />
              </div>
              <h2 className="text-xl font-bold text-white">SMB</h2>
            </div>
            <div className="mb-6">
              <span className="text-4xl font-extrabold text-white">$49</span>
              <span className="text-slate-500 font-medium">/mo</span>
            </div>
            <ul className="mb-8 flex-1 space-y-4">
              <li className="flex items-start gap-3 text-sm text-slate-300">
                <Check className="h-5 w-5 shrink-0 text-purple-500" />
                <span>Everything in Pro</span>
              </li>
              <li className="flex items-start gap-3 text-sm text-slate-300">
                <Check className="h-5 w-5 shrink-0 text-purple-500" />
                <span>Up to 10 Members</span>
              </li>
              <li className="flex items-start gap-3 text-sm text-slate-300">
                <Check className="h-5 w-5 shrink-0 text-purple-500" />
                <span>Webhooks & Integrations</span>
              </li>
            </ul>
            {data.isOwner && (data.plan === "free" || data.plan === "pro") && data.prices.smb && (
              <button
                onClick={() => handleUpgrade(data.prices.smb, "smb")}
                disabled={processing !== null}
                className="w-full rounded-xl bg-purple-600 py-3 text-sm font-bold text-white shadow-lg transition hover:bg-purple-500 disabled:opacity-50"
              >
                {processing === "smb" ? "Redirecting..." : "Upgrade to SMB"}
              </button>
            )}
          </div>

          {/* Enterprise */}
          <div className="relative flex flex-col rounded-3xl border border-slate-800 bg-slate-900/50 p-8 shadow-xl transition hover:border-slate-700">
            <div className="mb-6 flex items-center gap-3">
              <div className="rounded-xl bg-slate-800 p-2 text-slate-400">
                <Building2 className="h-6 w-6" />
              </div>
              <h2 className="text-xl font-bold text-white">Enterprise</h2>
            </div>
            <div className="mb-6">
              <span className="text-3xl font-extrabold text-white tracking-tight">Custom</span>
            </div>
            <ul className="mb-8 flex-1 space-y-4">
              <li className="flex items-start gap-3 text-sm text-slate-300">
                <Check className="h-5 w-5 shrink-0 text-slate-500" />
                <span>Unlimited Members</span>
              </li>
              <li className="flex items-start gap-3 text-sm text-slate-300">
                <Check className="h-5 w-5 shrink-0 text-slate-500" />
                <span>Custom SLAs</span>
              </li>
              <li className="flex items-start gap-3 text-sm text-slate-300">
                <Check className="h-5 w-5 shrink-0 text-slate-500" />
                <span>Dedicated Support</span>
              </li>
            </ul>
            <a
              href="mailto:kevin@kevinbytes.com"
              className="text-center w-full rounded-xl border border-slate-700 bg-transparent py-3 text-sm font-bold text-white transition hover:bg-slate-800"
            >
              Contact Sales
            </a>
          </div>

        </div>
      </div>
    </main>
  );
}
