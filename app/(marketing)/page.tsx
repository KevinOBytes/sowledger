"use client";

import { motion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  CalendarClock,
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
    title: "Calendar-style planning",
    description: "Schedule work like an event, then start a timer, reschedule, skip, or log the completed time later.",
    icon: CalendarClock,
    eyebrow: "Plan",
  },
  {
    title: "Focused live timers",
    description: "Keep one timer visually primary while concurrent timers stay visible and easy to stop.",
    icon: Clock3,
    eyebrow: "Track",
  },
  {
    title: "Completed work logging",
    description: "Add non-timer work from Dashboard, Calendar, Activity, and empty states without hunting for a form.",
    icon: Check,
    eyebrow: "Log",
  },
  {
    title: "Operational analytics",
    description: "See planned vs actual, timer vs completed work, billable output, utilization, and project distribution.",
    icon: BarChart3,
    eyebrow: "Review",
  },
  {
    title: "Exports and invoices",
    description: "Download CSV or complete JSON with digest headers, then turn approved time into invoice-ready records.",
    icon: FileDown,
    eyebrow: "Output",
  },
  {
    title: "API and webhooks",
    description: "Use scoped API keys and webhooks to sync clients, projects, tags, schedule, time, analytics, and exports.",
    icon: Webhook,
    eyebrow: "Integrate",
  },
];

const WORKFLOW = ["Schedule work", "Track timers", "Log completed work", "Review analytics", "Invoice or export", "Sync by API"];

export default function MarketingPage() {
  return (
    <div className="relative overflow-hidden bg-[#f6f3ee] text-slate-950">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-10%] top-0 h-96 w-96 rounded-full bg-cyan-200/50 blur-[90px]" />
        <div className="absolute right-[-12%] top-[18rem] h-[30rem] w-[30rem] rounded-full bg-amber-100/70 blur-[110px]" />
        <div className="absolute inset-x-0 top-0 h-[42rem] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.85),transparent_62%)]" />
      </div>

      <section className="relative px-6 pb-20 pt-32 sm:pt-40">
        <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <motion.div initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.55 }}>
            <div className="inline-flex rounded-full border border-cyan-200 bg-white/80 px-4 py-1.5 text-sm font-bold text-cyan-800 shadow-sm">
              Flat workspace pricing for operators
            </div>
            <h1 className="mt-6 max-w-4xl text-5xl font-semibold tracking-tight text-slate-950 sm:text-7xl lg:text-8xl">
              Plan the work. Prove every billable hour.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600 sm:text-xl">
              Billabled gives service teams one clean path from scheduled work to live timers, completed work logs, analytics, invoices, exports, and API integrations.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/login" className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-950 px-7 py-4 text-base font-bold text-white shadow-sm transition hover:bg-slate-800">
                Start free
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="#workflow" className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-7 py-4 text-base font-bold text-slate-800 shadow-sm transition hover:border-cyan-200 hover:text-cyan-700">
                See workflow
              </Link>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold text-slate-600">
              <span className="inline-flex items-center gap-2"><Sparkles className="h-4 w-4 text-cyan-700" />No per-seat surprise</span>
              <span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-cyan-700" />Scoped API keys</span>
              <span className="inline-flex items-center gap-2"><DatabaseZap className="h-4 w-4 text-cyan-700" />Complete exports</span>
            </div>
          </motion.div>

          <motion.div initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.65, delay: 0.1 }} className="rounded-[40px] border border-stone-200 bg-white/90 p-5 shadow-2xl shadow-stone-900/10 backdrop-blur">
            <div className="rounded-[32px] bg-slate-950 p-5 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.24em] text-cyan-300">Today</p>
                  <h2 className="mt-2 text-2xl font-semibold">Client delivery sprint</h2>
                </div>
                <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-bold text-emerald-200">Timer running</span>
              </div>
              <div className="mt-7 rounded-[28px] bg-white/10 p-5">
                <p className="text-sm text-slate-300">Focused timer</p>
                <p className="mt-2 font-mono text-5xl font-semibold">01:24:18</p>
                <p className="mt-3 text-sm text-slate-300">Proposal review · Acme onboarding</p>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {WORKFLOW.slice(0, 4).map((item, index) => (
                  <div key={item} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <p className="text-xs font-bold text-cyan-200">0{index + 1}</p>
                    <p className="mt-1 text-sm font-semibold">{item}</p>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <section id="workflow" className="relative px-6 py-20">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">One connected flow</p>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight sm:text-6xl">Users should always know where they are.</h2>
            <p className="mt-4 text-lg text-slate-600">Dashboard is for today. Calendar is for scheduling. Activity is for corrections. Analytics explains performance. Exports and invoices turn time into proof.</p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-3 lg:grid-cols-6">
            {WORKFLOW.map((step, index) => (
              <div key={step} className="rounded-[28px] border border-stone-200 bg-white p-5 shadow-sm">
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
              <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Product surfaces</p>
              <h2 className="mt-3 text-4xl font-semibold tracking-tight sm:text-6xl">Clear jobs, visible next actions.</h2>
            </div>
            <Link href="/support" className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-5 py-3 text-sm font-bold text-slate-800 shadow-sm hover:border-cyan-200 hover:text-cyan-700">
              Open support guide <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {FEATURE_CARDS.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <motion.article
                  key={feature.title}
                  initial={{ y: 18, opacity: 0 }}
                  whileInView={{ y: 0, opacity: 1 }}
                  viewport={{ once: true, amount: 0.25 }}
                  transition={{ duration: 0.4, delay: index * 0.05 }}
                  className="group rounded-[32px] border border-stone-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-cyan-200 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="rounded-2xl bg-cyan-50 p-3 text-cyan-700"><Icon className="h-6 w-6" /></div>
                    <span className="rounded-full border border-stone-200 px-3 py-1 text-xs font-bold uppercase tracking-wide text-stone-500">{feature.eyebrow}</span>
                  </div>
                  <h3 className="mt-5 text-2xl font-semibold">{feature.title}</h3>
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
            <h2 className="mt-4 text-4xl font-semibold tracking-tight sm:text-6xl">Easy to approve. Useful on day one.</h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">Flat monthly workspace pricing keeps the first paid step small while still creating revenue for TKOResearch.</p>
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
            <p className="text-sm font-bold uppercase tracking-[0.24em] text-cyan-700">Ready for a workspace?</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-5xl">Start with the first guided setup path.</h2>
            <p className="mt-3 max-w-2xl text-slate-600">Create or join a workspace, schedule the first block, capture time, and export proof without needing a separate walkthrough.</p>
          </div>
          <Link href="/login" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-cyan-600 px-6 py-4 text-sm font-bold text-white transition hover:bg-cyan-500">
            Start free <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
