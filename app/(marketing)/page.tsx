"use client";

import { motion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  Check,
  Clock3,
  DatabaseZap,
  FileDown,
  ShieldCheck,
  Sparkles,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

const MARKETING_PLANS = [
  {
    planId: "free",
    name: "Free",
    description: "Try the operational workflow on a small workspace.",
    price: 0,
    features: ["Live timers", "Manual logging"],
    limits: { members: 1, projects: 2, storageMB: 100 },
  },
  {
    planId: "pro",
    name: "Starter",
    description: "Solo operators who need invoices, exports, analytics, and planned work.",
    price: 9,
    features: ["Scheduling", "Analytics", "Exports", "Invoicing"],
    limits: { members: 2, projects: 10, storageMB: 1000 },
  },
  {
    planId: "smb",
    name: "Studio",
    description: "Small teams that need approvals, API keys, webhooks, and complete exports.",
    price: 29,
    features: ["Approvals", "API keys", "Webhooks", "Team workflow"],
    limits: { members: 5, projects: 50, storageMB: 5000 },
  },
  {
    planId: "enterprise",
    name: "Business",
    description: "Growing firms that need more capacity, audit depth, and priority support.",
    price: 79,
    features: ["20 members", "Advanced reports", "Audit posture", "Priority support"],
    limits: { members: 20, projects: 200, storageMB: 25000 },
  },
];

type FeatureCard = {
  title: string;
  description: string;
  icon: LucideIcon;
  eyebrow: string;
};

const FEATURE_CARDS: FeatureCard[] = [
  {
    title: "Invoice Proof Packs",
    description: "Attach source mix, linked work, planned vs actual context, approvals, and digest-backed evidence to every invoice.",
    icon: FileDown,
    eyebrow: "Proof",
  },
  {
    title: "Retainer Leak Radar",
    description: "Spot budget pressure, unbilled approved work, missing rates, and projects drifting below target before renewal pain.",
    icon: BarChart3,
    eyebrow: "Protect",
  },
  {
    title: "Client Sign-Off Portal",
    description: "Give clients an approval-ready view of invoice evidence without exposing internal workspace controls.",
    icon: ShieldCheck,
    eyebrow: "Approve",
  },
  {
    title: "Missing Billable Recovery",
    description: "Surface scheduled work without completed time, approved-but-uninvoiced entries, stale drafts, and manual gaps.",
    icon: Clock3,
    eyebrow: "Recover",
  },
  {
    title: "Developer/Agency Integration Layer",
    description: "Use scoped API keys, proof-pack endpoints, revenue intelligence, exports, and webhooks to sync trusted billing data.",
    icon: Webhook,
    eyebrow: "Integrate",
  },
];

const WORKFLOW = ["Plan work", "Track timers", "Log manual/calendar time", "Review revenue risk", "Approve and invoice", "Integrate by API"];

const PROOF_SUMMARY: Array<[label: string, value: string, detail: string]> = [
  ["Recovered billables", "$4,820", "Approved work not yet invoiced"],
  ["Proof digest", "SHA-256", "Evidence packet integrity"],
  ["Sign-off status", "Ready", "Client approval packet prepared"],
];

export default function MarketingPage() {
  return (
    <div className="relative overflow-hidden bg-[#f6f3ee] text-slate-950">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(246,243,238,0)_38%),linear-gradient(90deg,rgba(8,145,178,0.08)_1px,transparent_1px),linear-gradient(180deg,rgba(8,145,178,0.06)_1px,transparent_1px)] bg-[length:100%_100%,72px_72px,72px_72px]" />

      <div className="relative border-b border-stone-200/80 bg-white/60 px-6 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-500 sm:justify-between">
          <span>Billabled</span>
          <span className="text-cyan-800">Proof-backed billing for service teams</span>
        </div>
      </div>

      <section className="relative px-6 pb-20 pt-24 sm:pb-24 sm:pt-32">
        <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <motion.div initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.55 }}>
            <div className="inline-flex rounded-full border border-cyan-200 bg-white/80 px-4 py-1.5 text-sm font-bold text-cyan-800 shadow-sm">
              Competitive proof platform for agencies and operators
            </div>
            <h1 className="mt-6 max-w-4xl text-5xl font-semibold tracking-tight text-slate-950 sm:text-6xl lg:text-7xl">
              Recover revenue. Prove every invoice.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600 sm:text-xl">
              Billabled turns planning, timers, manual work, calendar logs, analytics, invoices, exports, and APIs into one defensible billing system for teams that cannot afford commodity time tracking.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/login" className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-950 px-7 py-4 text-base font-bold text-white shadow-sm transition hover:bg-slate-800">
                Start recovering time
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="#workflow" className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-7 py-4 text-base font-bold text-slate-800 shadow-sm transition hover:border-cyan-200 hover:text-cyan-700">
                See proof workflow
              </Link>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold text-slate-600">
              <span className="inline-flex items-center gap-2"><Sparkles className="h-4 w-4 text-cyan-700" />Flat workspace pricing</span>
              <span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-cyan-700" />Client-ready evidence</span>
              <span className="inline-flex items-center gap-2"><DatabaseZap className="h-4 w-4 text-cyan-700" />Digest-backed exports</span>
            </div>
          </motion.div>

          <motion.div initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.65, delay: 0.1 }} className="rounded-[32px] border border-stone-200 bg-white p-5 shadow-xl shadow-stone-900/10">
            <div className="flex items-start justify-between gap-4 border-b border-stone-100 pb-5">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-cyan-700">Invoice proof pack</p>
                <h2 className="mt-2 text-2xl font-semibold">Acme May delivery</h2>
                <p className="mt-1 text-sm text-slate-500">Evidence packet ready for client sign-off</p>
              </div>
              <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-bold text-cyan-800">Ready</span>
            </div>
            <div className="divide-y divide-stone-100">
              {PROOF_SUMMARY.map(([label, value, detail]) => (
                <div key={label} className="grid gap-3 py-5 sm:grid-cols-[0.9fr_0.55fr_1fr] sm:items-center">
                  <p className="text-sm font-bold text-slate-700">{label}</p>
                  <p className="text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
                  <p className="text-sm leading-6 text-slate-500">{detail}</p>
                </div>
              ))}
            </div>
            <div className="mt-2 rounded-3xl border border-cyan-100 bg-cyan-50/70 p-5">
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-cyan-800">Source mix</p>
                  <p className="mt-2 text-sm text-slate-600">Timer, manual, and calendar logs reconciled.</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-cyan-800">Leak radar</p>
                  <p className="mt-2 text-sm text-slate-600">Retainer risk and missed work called out.</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-cyan-800">Agency API</p>
                  <p className="mt-2 text-sm text-slate-600">Proof and intelligence available by scope.</p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <section id="workflow" className="relative px-6 py-20">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">One revenue recovery flow</p>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight sm:text-6xl">The work path ends in proof, not a timesheet dump.</h2>
            <p className="mt-4 text-lg leading-8 text-slate-600">Dashboard keeps today focused. Calendar captures planned work. Activity corrects the record. Analytics finds leakage. Invoices, exports, sign-off, and APIs make the bill defensible.</p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-3 lg:grid-cols-6">
            {WORKFLOW.map((step, index) => (
              <div key={step} className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-bold text-cyan-700">0{index + 1}</p>
                <p className="mt-3 text-lg font-semibold">{step}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative px-6 py-20">
        <div className="mx-auto max-w-7xl">
          <div className="mb-10 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Competitive capabilities</p>
              <h2 className="mt-3 text-4xl font-semibold tracking-tight sm:text-6xl">Built for proof, recovery, and trust.</h2>
            </div>
            <Link href="/support" className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-5 py-3 text-sm font-bold text-slate-800 shadow-sm hover:border-cyan-200 hover:text-cyan-700">
              Open support guide <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-5">
            {FEATURE_CARDS.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <motion.article
                  key={feature.title}
                  initial={{ y: 18, opacity: 0 }}
                  whileInView={{ y: 0, opacity: 1 }}
                  viewport={{ once: true, amount: 0.25 }}
                  transition={{ duration: 0.4, delay: index * 0.05 }}
                  className="group rounded-3xl border border-stone-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:border-cyan-200 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="rounded-2xl bg-cyan-50 p-3 text-cyan-700"><Icon className="h-6 w-6" /></div>
                    <span className="rounded-full border border-stone-200 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-stone-500">{feature.eyebrow}</span>
                  </div>
                  <h3 className="mt-5 text-xl font-semibold leading-tight">{feature.title}</h3>
                  <p className="mt-2 leading-7 text-slate-600">{feature.description}</p>
                </motion.article>
              );
            })}
          </div>
        </div>
      </section>

      <section id="pricing" className="relative px-6 py-20">
        <div className="mx-auto max-w-7xl">
          <div className="mb-10 text-center">
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Pricing</p>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight sm:text-6xl">Flat workspace pricing for proof-backed billing.</h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">Start free, then move to fixed monthly workspace plans as recovery, sign-off, analytics, and integration needs grow.</p>
          </div>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {MARKETING_PLANS.map((plan, index) => (
              <motion.article
                key={plan.planId}
                initial={{ y: 18, opacity: 0 }}
                whileInView={{ y: 0, opacity: 1 }}
                viewport={{ once: true, amount: 0.25 }}
                transition={{ duration: 0.4, delay: index * 0.05 }}
                className="flex flex-col rounded-[32px] border border-stone-200 bg-white p-6 shadow-sm"
              >
                <h3 className="text-2xl font-semibold">{plan.name}</h3>
                <p className="mt-2 min-h-16 text-sm leading-6 text-slate-600">{plan.description}</p>
                <div className="mt-6">
                  <span className="text-5xl font-semibold tracking-tight">${plan.price}</span>
                  <span className="text-sm font-semibold text-slate-500">/workspace/mo</span>
                </div>
                <p className="mt-4 rounded-full bg-cyan-50 px-3 py-1 text-xs font-bold text-cyan-800">No per-seat surprise at checkout</p>
                <ul className="mt-6 flex-1 space-y-3 text-sm text-slate-700">
                  <li className="flex items-center gap-3"><Check className="h-4 w-4 text-cyan-700" />Up to {plan.limits.members} member{plan.limits.members === 1 ? "" : "s"}</li>
                  <li className="flex items-center gap-3"><Check className="h-4 w-4 text-cyan-700" />Up to {plan.limits.projects} active projects</li>
                  <li className="flex items-center gap-3"><Check className="h-4 w-4 text-cyan-700" />{Math.max(1, Math.round(plan.limits.storageMB / 1000))}GB file storage</li>
                  {plan.features.map((feature) => <li key={feature} className="flex items-center gap-3"><Check className="h-4 w-4 text-cyan-700" />{feature}</li>)}
                </ul>
                <Link href="/login" className="mt-7 rounded-2xl bg-slate-950 px-5 py-3 text-center text-sm font-bold text-white transition hover:bg-slate-800">
                  Get started
                </Link>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      <section className="relative px-6 py-24">
        <div className="mx-auto flex max-w-5xl flex-col gap-5 rounded-[40px] border border-stone-200 bg-white p-8 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.24em] text-cyan-700">Ready to prove the bill?</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-5xl">Replace fragile timesheets with evidence clients can sign.</h2>
            <p className="mt-3 max-w-2xl text-slate-600">Create a workspace, capture planned and completed work, recover missed billables, and turn approved time into proof-backed invoices.</p>
          </div>
          <Link href="/login" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-cyan-600 px-6 py-4 text-sm font-bold text-white transition hover:bg-cyan-500">
            Start free <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
