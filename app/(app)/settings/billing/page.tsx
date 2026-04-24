"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Building2, Check, CreditCard, ShieldCheck, Sparkles, Users, Zap } from "lucide-react";
import { toast } from "sonner";

type Plan = {
  planId: "free" | "pro" | "smb" | "enterprise";
  name: string;
  description: string;
  price: number;
  features: string[];
  limits: { members: number; projects: number; storageMB: number; goals: number };
  configured: boolean;
};

type BillingData = {
  plan: "free" | "pro" | "smb" | "enterprise";
  storedPlan?: "free" | "pro" | "smb" | "enterprise";
  planSource?: "stripe" | "internal";
  isOwner: boolean;
  usage: { members: number; projects: number };
  limits: { members: number; projects: number; storageMB: number; goals: number };
  plans: Plan[];
};

const PLAN_ICONS = {
  free: Sparkles,
  pro: Zap,
  smb: Users,
  enterprise: Building2,
};

function limitLabel(value: number) {
  return value >= 9999 ? "Unlimited" : String(value);
}

function planRank(plan: BillingData["plan"]) {
  return ["free", "pro", "smb", "enterprise"].indexOf(plan);
}

export default function BillingPage() {
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/billing")
      .then((res) => res.json())
      .then((result) => {
        if (result.ok) setData(result);
        else toast.error(result.error || "Unable to load billing");
      })
      .catch(() => toast.error("Unable to load billing"))
      .finally(() => setLoading(false));
  }, []);

  async function handleUpgrade(planId: Plan["planId"]) {
    setProcessing(planId);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const resData = await res.json();
      if (resData.url) {
        window.location.assign(resData.url);
      } else {
        toast.error(resData.error || "Failed to start checkout");
        setProcessing(null);
      }
    } catch {
      toast.error("Error starting checkout");
      setProcessing(null);
    }
  }

  async function handlePortal() {
    setProcessing("portal");
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const resData = await res.json();
      if (resData.url) {
        window.location.assign(resData.url);
      } else {
        toast.error(resData.error || "Failed to open portal");
        setProcessing(null);
      }
    } catch {
      toast.error("Error opening portal");
      setProcessing(null);
    }
  }

  const usage = useMemo(() => {
    if (!data) return null;
    const memberPercent = data.limits.members > 1000 ? 0 : Math.min(100, Math.round((data.usage.members / data.limits.members) * 100));
    const projectPercent = data.limits.projects > 1000 ? 0 : Math.min(100, Math.round((data.usage.projects / data.limits.projects) * 100));
    return { memberPercent, projectPercent };
  }, [data]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f6f3ee]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-cyan-600" />
      </main>
    );
  }

  if (!data || !usage) return <div className="min-h-screen bg-[#f6f3ee] p-8 text-slate-950">Error loading billing</div>;

  return (
    <main className="min-h-screen bg-[#f6f3ee] p-4 text-slate-950 sm:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Billing</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Plans and subscription</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-500">Flat workspace pricing keeps the first paid step easy to approve. Stripe checkout is still plan based, so the client never passes raw price IDs.</p>
            </div>
          <div className="flex flex-wrap gap-2">
              {data.planSource === "internal" && (
                <span className="rounded-full bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700">Internal Business access</span>
              )}
              <Link href="/settings" className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:border-cyan-300 hover:text-cyan-700">Settings</Link>
              {data.isOwner && data.plan !== "free" && (
                <button onClick={handlePortal} disabled={processing === "portal"} className="rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50">
                  {processing === "portal" ? "Opening..." : "Manage subscription"}
                </button>
              )}
            </div>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3 text-slate-500"><Users className="h-5 w-5 text-cyan-700" /><span className="text-sm font-bold uppercase tracking-wide">Workspace members</span></div>
            <div className="mt-4 flex items-end justify-between"><span className="text-4xl font-semibold">{data.usage.members}</span><span className="text-sm font-semibold text-slate-500">/ {limitLabel(data.limits.members)}</span></div>
            {data.limits.members <= 1000 && <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-cyan-600" style={{ width: `${usage.memberPercent}%` }} /></div>}
          </div>
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3 text-slate-500"><CreditCard className="h-5 w-5 text-cyan-700" /><span className="text-sm font-bold uppercase tracking-wide">Active projects</span></div>
            <div className="mt-4 flex items-end justify-between"><span className="text-4xl font-semibold">{data.usage.projects}</span><span className="text-sm font-semibold text-slate-500">/ {limitLabel(data.limits.projects)}</span></div>
            {data.limits.projects <= 1000 && <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${usage.projectPercent}%` }} /></div>}
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-4">
          {data.plans.map((plan) => {
            const Icon = PLAN_ICONS[plan.planId];
            const current = data.plan === plan.planId;
            const canUpgrade = data.isOwner && plan.planId !== "free" && planRank(plan.planId) > planRank(data.plan);
            return (
              <article key={plan.planId} className={`relative flex flex-col rounded-[32px] border p-6 shadow-sm transition ${current ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white hover:-translate-y-1 hover:shadow-md"}`}>
                {current && <span className="absolute -top-3 left-6 rounded-full bg-cyan-300 px-3 py-1 text-xs font-bold uppercase tracking-wide text-slate-950">Current</span>}
                <div className="flex items-center justify-between">
                  <div className={`rounded-2xl p-3 ${current ? "bg-white/10 text-cyan-200" : "bg-cyan-50 text-cyan-700"}`}><Icon className="h-6 w-6" /></div>
                  <ShieldCheck className={`h-5 w-5 ${current ? "text-cyan-200" : "text-slate-300"}`} />
                </div>
                <h2 className="mt-5 text-2xl font-semibold">{plan.name}</h2>
                <p className={`mt-2 min-h-[60px] text-sm ${current ? "text-slate-300" : "text-slate-500"}`}>{plan.description}</p>
                <div className="my-6"><span className="text-5xl font-semibold">${plan.price}</span><span className={current ? "text-slate-300" : "text-slate-500"}>/workspace/mo</span></div>
                <ul className={`flex-1 space-y-3 text-sm ${current ? "text-slate-200" : "text-slate-600"}`}>
                  <li className="flex items-center gap-2"><Check className="h-4 w-4 text-cyan-500" />{limitLabel(plan.limits.members)} member{plan.limits.members === 1 ? "" : "s"}</li>
                  <li className="flex items-center gap-2"><Check className="h-4 w-4 text-cyan-500" />{limitLabel(plan.limits.projects)} projects</li>
                  <li className="flex items-center gap-2"><Check className="h-4 w-4 text-cyan-500" />{plan.features.includes("schedule") ? "Planning calendar" : "Core timers"}</li>
                  <li className="flex items-center gap-2"><Check className="h-4 w-4 text-cyan-500" />{plan.features.includes("api") ? "API keys and webhooks" : plan.features.includes("exports") ? "CSV and JSON exports" : "Manual logging"}</li>
                </ul>
                {canUpgrade && (
                  <button onClick={() => handleUpgrade(plan.planId)} disabled={processing !== null || !plan.configured} className="mt-7 w-full rounded-2xl bg-cyan-600 py-3 text-sm font-bold text-white transition hover:bg-cyan-500 disabled:opacity-50">
                    {processing === plan.planId ? "Redirecting..." : plan.configured ? `Move to ${plan.name}` : "Price not configured"}
                  </button>
                )}
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}
