"use client";

import { motion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  Check,
  Clock3,
  Code2,
  DatabaseZap,
  FileCheck2,
  FileDown,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  TimerReset,
  TrendingUp,
  Webhook,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";

const MARKETING_PLANS = [
  {
    planId: "free",
    name: "Free",
    description: "Try the connected workflow on one small workspace.",
    price: 0,
    outcome: "Start tracking and correcting the work record.",
    features: ["Live timers", "Manual logging", "Basic planning"],
    limits: { members: 1, projects: 2, storageMB: 100 },
  },
  {
    planId: "pro",
    name: "Starter",
    description: "Solo operators who need invoices, exports, analytics, and planned work.",
    price: 9,
    outcome: "Turn approved time into proof-backed invoices.",
    features: ["Invoice proof packs", "Scheduling", "Analytics", "Exports"],
    limits: { members: 2, projects: 10, storageMB: 1000 },
  },
  {
    planId: "smb",
    name: "Studio",
    description: "Small teams that need approvals, API keys, webhooks, and revenue recovery.",
    price: 29,
    outcome: "Run sign-off, recovery, and agency integrations together.",
    features: ["Client sign-off", "API keys", "Webhooks", "Revenue intelligence"],
    limits: { members: 5, projects: 50, storageMB: 5000 },
    recommended: true,
  },
  {
    planId: "enterprise",
    name: "Business",
    description: "Growing firms that need more capacity, audit depth, and priority support.",
    price: 79,
    outcome: "Scale proof-backed billing across larger operating teams.",
    features: ["20 members", "Advanced reports", "Audit posture", "Priority support"],
    limits: { members: 20, projects: 200, storageMB: 25000 },
  },
];

type Capability = {
  title: string;
  shortTitle: string;
  description: string;
  icon: LucideIcon;
  href: string;
};

const CAPABILITIES: Capability[] = [
  {
    title: "Invoice Proof Packs",
    shortTitle: "Proof packs",
    description: "Attach source mix, linked work, planned vs actual context, approvals, and digest-backed evidence to every invoice.",
    icon: FileDown,
    href: "#proof-packs",
  },
  {
    title: "Retainer Leak Radar",
    shortTitle: "Leak radar",
    description: "Spot budget pressure, unbilled approved work, missing rates, and projects drifting below target before renewal pain.",
    icon: BarChart3,
    href: "#recovery",
  },
  {
    title: "Client Sign-Off Portal",
    shortTitle: "Sign-off",
    description: "Give clients an approval-ready view of invoice evidence without exposing internal workspace controls.",
    icon: ShieldCheck,
    href: "#signoff",
  },
  {
    title: "Missing Billable Recovery",
    shortTitle: "Recovery",
    description: "Surface scheduled work without completed time, approved-but-uninvoiced entries, stale drafts, and manual gaps.",
    icon: Clock3,
    href: "#recovery",
  },
  {
    title: "Developer/Agency Integration Layer",
    shortTitle: "Integrations",
    description: "Use scoped API keys, proof-pack endpoints, revenue intelligence, exports, and webhooks to sync trusted billing data.",
    icon: Webhook,
    href: "#integrations",
  },
];

const WORKFLOW = [
  { step: "Plan work", detail: "Put intended work on the calendar before the day gets noisy." },
  { step: "Track live timers", detail: "Capture active work without losing concurrent context." },
  { step: "Log manual/calendar time", detail: "Backfill completed work and import planned blocks." },
  { step: "Review analytics", detail: "Compare plan, timer, manual, utilization, and billable output." },
  { step: "Approve/invoice/export", detail: "Move corrected work into proof packs and digest-backed exports." },
  { step: "Integrate by API", detail: "Sync scoped proof data into agency, finance, and reporting systems." },
];

const PROOF_ITEMS = [
  "Invoice totals and issued status",
  "Planned vs actual hours",
  "Timer, manual, and calendar source mix",
  "Approvals, audit events, and digest integrity",
];

const RECOVERY_QUEUES = [
  {
    title: "Retainer Leak Radar",
    metric: "$4.8k",
    label: "at-risk work",
    description: "Budget burn, approved unbilled time, and missing rates are grouped before they become a tense client conversation.",
    icon: TrendingUp,
  },
  {
    title: "Missing Billable Recovery",
    metric: "18.5h",
    label: "recoverable time",
    description: "Scheduled work without completed entries, stale drafts, and manual gaps become an operator queue instead of lost revenue.",
    icon: TimerReset,
  },
];

const INTEGRATION_ROWS = [
  { label: "read:proof-packs", value: "Client-ready invoice evidence" },
  { label: "read:revenue-intelligence", value: "Retainer leak and recovery signals" },
  { label: "export:data", value: "Digest-backed CSV and JSON exports" },
  { label: "webhooks", value: "Project, time, invoice, and approval events" },
];

const PRODUCT_SCREENSHOTS = [
  {
    title: "Invoice proof pack",
    description: "Invoice evidence ties source mix, planned vs actual work, digest integrity, and issued invoices together.",
    src: "/images/marketing/invoice-proof-pack.png",
    alt: "Billabled invoice proof pack screenshot showing issued invoices, digest, source mix, and planned vs actual hours.",
    width: 1152,
    height: 1000,
  },
  {
    title: "Revenue recovery radar",
    description: "Analytics surfaces approved work not invoiced, missing rates, and scheduled work that never reached billing.",
    src: "/images/marketing/revenue-radar.png",
    alt: "Billabled analytics screenshot showing Retainer Leak Radar and Missing Billable Recovery cards.",
    width: 1152,
    height: 1623,
  },
  {
    title: "Client sign-off portal",
    description: "Clients get a focused proof packet view with project progress, amount, digest, and approval controls.",
    src: "/images/marketing/client-signoff-portal.png",
    alt: "Billabled client sign-off portal screenshot showing active projects and approval-ready proof packets.",
    width: 1440,
    height: 936,
  },
];

export default function MarketingPage() {
  return (
    <div className="relative overflow-hidden bg-[#f6f3ee] text-slate-950">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[linear-gradient(90deg,rgba(8,145,178,0.08)_1px,transparent_1px),linear-gradient(180deg,rgba(8,145,178,0.05)_1px,transparent_1px)] bg-[length:76px_76px]" />

      <header className="relative z-20 border-b border-stone-200/80 bg-white/70 px-5 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <Link href="/" className="text-sm font-black uppercase tracking-[0.22em] text-slate-950">
            Billabled
          </Link>
          <nav className="hidden items-center gap-5 text-sm font-bold text-slate-600 md:flex">
            <a href="#proof-packs" className="hover:text-cyan-700">Proof</a>
            <a href="#recovery" className="hover:text-cyan-700">Recovery</a>
            <a href="#integrations" className="hover:text-cyan-700">API</a>
            <a href="#pricing" className="hover:text-cyan-700">Pricing</a>
          </nav>
          <Link href="/login" className="inline-flex items-center justify-center rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800">
            Open app
          </Link>
        </div>
      </header>

      <section className="relative isolate min-h-[calc(100vh-64px)] px-5 py-16 sm:py-20">
        <div className="absolute inset-0 -z-10">
          <Image
            src="/images/marketing/invoice-proof-pack.png"
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover object-top opacity-30"
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(246,243,238,0.98)_0%,rgba(246,243,238,0.86)_42%,rgba(246,243,238,0.48)_100%),linear-gradient(180deg,rgba(246,243,238,0.46)_0%,rgba(246,243,238,0.95)_100%)]" />
        </div>

        <div className="mx-auto flex min-h-[calc(100vh-220px)] max-w-7xl flex-col justify-between gap-12">
          <motion.div
            initial={{ y: 18, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.55 }}
            className="max-w-4xl pt-8"
          >
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-white/80 px-4 py-1.5 text-sm font-bold text-cyan-800 shadow-sm backdrop-blur">
              <Sparkles className="h-4 w-4" />
              Proof-backed billing for agencies and operators
            </div>
            <h1 className="mt-6 max-w-4xl text-5xl font-semibold tracking-tight text-slate-950 sm:text-6xl lg:text-7xl">
              Recover revenue. Prove every invoice.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-700 sm:text-xl">
              Billabled connects planning, timers, manual work, calendar logs, analytics, invoices, exports, sign-off, and APIs into one defensible billing system.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/login" className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-950 px-7 py-4 text-base font-bold text-white shadow-sm transition hover:bg-slate-800">
                Start recovering time
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="#proof-packs" className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white/90 px-7 py-4 text-base font-bold text-slate-800 shadow-sm transition hover:border-cyan-200 hover:text-cyan-700">
                See invoice proof
              </Link>
            </div>
          </motion.div>

          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.55, delay: 0.12 }}
            className="grid gap-3 md:grid-cols-5"
            aria-label="Billabled capability navigation"
          >
            {CAPABILITIES.map((capability) => {
              const Icon = capability.icon;
              return (
                <a key={capability.title} href={capability.href} className="group flex min-h-28 flex-col justify-between rounded-[24px] border border-stone-200 bg-white/88 p-4 shadow-sm backdrop-blur transition hover:-translate-y-1 hover:border-cyan-200 hover:bg-white">
                  <div className="flex items-center justify-between gap-3">
                    <Icon className="h-5 w-5 text-cyan-700" />
                    <ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:text-cyan-700" />
                  </div>
                  <div>
                    <p className="mt-5 text-sm font-bold text-slate-950">{capability.shortTitle}</p>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{capability.description}</p>
                  </div>
                </a>
              );
            })}
          </motion.div>
        </div>
      </section>

      <section id="workflow" className="relative border-y border-stone-200 bg-white px-5 py-12">
        <div className="mx-auto max-w-7xl">
          <div className="mb-7 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Operating system</p>
              <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl">
                The work path ends in proof, not a timesheet dump.
              </h2>
            </div>
            <p className="max-w-2xl text-base leading-7 text-slate-600">
              Plan work, capture what happened, find leakage, approve the record, then export or integrate the evidence clients need to trust the bill.
            </p>
          </div>
          <div className="grid gap-px overflow-hidden rounded-[28px] border border-stone-200 bg-stone-200 md:grid-cols-3 lg:grid-cols-6">
            {WORKFLOW.map((item, index) => (
              <div key={item.step} className="bg-[#fffdf8] p-5">
                <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-700">0{index + 1}</p>
                <h3 className="mt-4 text-lg font-semibold">{item.step}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="proof-packs" className="relative px-5 py-20 sm:py-24">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <motion.div
            initial={{ y: 18, opacity: 0 }}
            whileInView={{ y: 0, opacity: 1 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.42 }}
          >
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Invoice evidence</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight sm:text-6xl">Invoice Proof Packs</h2>
            <p className="mt-5 text-lg leading-8 text-slate-600">
              Every invoice can carry the billing story behind it: the planned work, completed work, source mix, approvals, and digest-backed evidence that makes the number easier to defend.
            </p>
            <ul className="mt-7 grid gap-3 sm:grid-cols-2">
              {PROOF_ITEMS.map((item) => (
                <li key={item} className="flex items-start gap-3 rounded-2xl border border-stone-200 bg-white p-4 text-sm font-semibold text-slate-700 shadow-sm">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-cyan-700" />
                  {item}
                </li>
              ))}
            </ul>
          </motion.div>

          <motion.figure
            initial={{ y: 18, opacity: 0 }}
            whileInView={{ y: 0, opacity: 1 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: 0.42, delay: 0.08 }}
            className="overflow-hidden rounded-[32px] border border-stone-200 bg-white shadow-xl shadow-stone-900/10"
          >
            <Image
              src="/images/marketing/invoice-proof-pack.png"
              alt="Billabled invoice proof pack screenshot showing issued invoices, digest, source mix, and planned vs actual hours."
              width={1152}
              height={1000}
              priority
              sizes="(min-width: 1024px) 52vw, 100vw"
              className="aspect-[1.12/1] w-full object-cover object-top"
            />
            <figcaption className="border-t border-stone-100 p-5">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-cyan-700">Real product screen</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">Digest, issued invoices, source mix, and planned vs actual proof in one packet.</p>
            </figcaption>
          </motion.figure>
        </div>
      </section>

      <section id="recovery" className="relative bg-white px-5 py-20 sm:py-24">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
            <motion.figure
              initial={{ y: 18, opacity: 0 }}
              whileInView={{ y: 0, opacity: 1 }}
              viewport={{ once: true, amount: 0.25 }}
              transition={{ duration: 0.42 }}
              className="overflow-hidden rounded-[32px] border border-stone-200 bg-[#fffdf8] shadow-sm"
            >
              <Image
                src="/images/marketing/revenue-radar.png"
                alt="Billabled analytics screenshot showing Retainer Leak Radar and Missing Billable Recovery cards."
                width={1152}
                height={1623}
                sizes="(min-width: 1024px) 47vw, 100vw"
                className="aspect-[4/3] w-full object-cover object-top"
              />
            </motion.figure>

            <div>
              <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Revenue intelligence</p>
              <h2 className="mt-3 text-4xl font-semibold tracking-tight sm:text-6xl">
                Find leakage before the retainer meeting.
              </h2>
              <p className="mt-5 text-lg leading-8 text-slate-600">
                Billabled turns analytics into operator queues for work that should be protected, corrected, invoiced, or explained with evidence.
              </p>
              <div className="mt-7 grid gap-4 sm:grid-cols-2">
                {RECOVERY_QUEUES.map((queue) => {
                  const Icon = queue.icon;
                  return (
                    <motion.article
                      key={queue.title}
                      initial={{ y: 14, opacity: 0 }}
                      whileInView={{ y: 0, opacity: 1 }}
                      viewport={{ once: true, amount: 0.25 }}
                      transition={{ duration: 0.35 }}
                      className="rounded-[28px] border border-stone-200 bg-[#f6f3ee] p-5"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <Icon className="h-6 w-6 text-cyan-700" />
                        <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-500">{queue.label}</span>
                      </div>
                      <h3 className="mt-6 text-2xl font-semibold">{queue.title}</h3>
                      <p className="mt-3 text-4xl font-semibold tracking-tight text-cyan-800">{queue.metric}</p>
                      <p className="mt-3 text-sm leading-6 text-slate-600">{queue.description}</p>
                    </motion.article>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="signoff" className="relative px-5 py-20 sm:py-24">
        <div className="mx-auto max-w-7xl">
          <div className="mb-10 max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Client approval</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight sm:text-6xl">Client Sign-Off Portal</h2>
            <p className="mt-5 text-lg leading-8 text-slate-600">
              Clients can review proof packets, approve the work, and see the billing context without gaining access to internal planning, timers, API keys, or workspace controls.
            </p>
          </div>

          <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
            <motion.figure
              initial={{ y: 18, opacity: 0 }}
              whileInView={{ y: 0, opacity: 1 }}
              viewport={{ once: true, amount: 0.25 }}
              transition={{ duration: 0.42 }}
              className="overflow-hidden rounded-[32px] border border-stone-200 bg-white shadow-sm"
            >
              <Image
                src="/images/marketing/client-signoff-portal.png"
                alt="Billabled client sign-off portal screenshot showing active projects and approval-ready proof packets."
                width={1440}
                height={936}
                sizes="(min-width: 1024px) 58vw, 100vw"
                className="aspect-[16/10] w-full object-cover object-top"
              />
            </motion.figure>

            <div className="grid gap-4">
              {[
                { title: "Approval-ready packets", copy: "Amounts, project progress, evidence, and digest context stay together." },
                { title: "Client-safe access", copy: "The portal separates approval from workspace administration and team internals." },
                { title: "Faster resolution", copy: "Questions start from the proof packet instead of a loose spreadsheet export." },
              ].map((item) => (
                <article key={item.title} className="rounded-[28px] border border-stone-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 inline-flex rounded-2xl bg-cyan-50 p-3 text-cyan-700">
                    <FileCheck2 className="h-5 w-5" />
                  </div>
                  <h3 className="text-xl font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{item.copy}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="integrations" className="relative bg-slate-950 px-5 py-20 text-white sm:py-24">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-300">API layer</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight sm:text-6xl">Developer/Agency Integration Layer</h2>
            <p className="mt-5 text-lg leading-8 text-slate-300">
              Agency systems can fetch invoice proof, revenue intelligence, exports, and event updates through scoped keys while billing changes, invites, subscription management, and destructive admin actions stay out of public API v1.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/support/api" className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-50">
                Read API docs <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/login" className="inline-flex items-center justify-center gap-2 rounded-full border border-white/15 px-6 py-3 text-sm font-bold text-white transition hover:border-cyan-300 hover:text-cyan-100">
                Create workspace
              </Link>
            </div>
          </div>

          <motion.div
            initial={{ y: 18, opacity: 0 }}
            whileInView={{ y: 0, opacity: 1 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: 0.42 }}
            className="rounded-[32px] border border-white/10 bg-white/[0.06] p-5 shadow-2xl shadow-black/20"
          >
            <div className="flex items-center gap-3 border-b border-white/10 pb-4">
              <div className="rounded-2xl bg-cyan-400/15 p-3 text-cyan-200">
                <Code2 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-bold">Scoped integration contract</p>
                <p className="text-xs text-slate-400">Keys are hashed, expirable, revocable, and usage-tracked.</p>
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {INTEGRATION_ROWS.map((row) => (
                <div key={row.label} className="flex flex-col gap-1 rounded-2xl border border-white/10 bg-black/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <span className="font-mono text-sm text-cyan-200">{row.label}</span>
                  <span className="text-sm text-slate-300">{row.value}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {[
                { icon: KeyRound, label: "Show once" },
                { icon: LockKeyhole, label: "Hashed storage" },
                { icon: DatabaseZap, label: "Usage tracked" },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <Icon className="h-5 w-5 text-cyan-200" />
                    <p className="mt-3 text-sm font-bold">{item.label}</p>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </div>
      </section>

      <section className="relative px-5 py-20 sm:py-24">
        <div className="mx-auto max-w-7xl">
          <div className="mb-10 max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Product proof</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight sm:text-6xl">Real screens for the work customers pay for.</h2>
            <p className="mt-4 text-lg leading-8 text-slate-600">
              The marketing page now sells the actual proof, recovery, sign-off, and integration surfaces a paying customer will use.
            </p>
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            {PRODUCT_SCREENSHOTS.map((screenshot, index) => (
              <motion.figure
                key={screenshot.src}
                initial={{ y: 18, opacity: 0 }}
                whileInView={{ y: 0, opacity: 1 }}
                viewport={{ once: true, amount: 0.25 }}
                transition={{ duration: 0.4, delay: index * 0.05 }}
                className="overflow-hidden rounded-[32px] border border-stone-200 bg-white shadow-sm"
              >
                <Image
                  src={screenshot.src}
                  alt={screenshot.alt}
                  width={screenshot.width}
                  height={screenshot.height}
                  loading={index === 0 ? "eager" : undefined}
                  fetchPriority={index === 0 ? "high" : undefined}
                  sizes="(min-width: 1024px) 31vw, 100vw"
                  className="aspect-[16/11] w-full border-b border-stone-100 object-cover object-top"
                />
                <figcaption className="p-5">
                  <h3 className="text-xl font-semibold">{screenshot.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{screenshot.description}</p>
                </figcaption>
              </motion.figure>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="relative bg-white px-5 py-20 sm:py-24">
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
                className={`flex flex-col rounded-[32px] border p-6 shadow-sm ${plan.recommended ? "border-cyan-300 bg-cyan-50/50" : "border-stone-200 bg-white"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-2xl font-semibold">{plan.name}</h3>
                    <p className="mt-2 min-h-16 text-sm leading-6 text-slate-600">{plan.description}</p>
                  </div>
                  {plan.recommended && <span className="rounded-full bg-cyan-700 px-3 py-1 text-xs font-bold text-white">Studio</span>}
                </div>
                <div className="mt-6">
                  <span className="text-5xl font-semibold tracking-tight">${plan.price}</span>
                  <span className="text-sm font-semibold text-slate-500">/workspace/mo</span>
                </div>
                <p className="mt-4 rounded-2xl bg-white px-3 py-3 text-sm font-bold text-slate-700">{plan.outcome}</p>
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

      <section className="relative px-5 py-20 sm:py-24">
        <div className="mx-auto grid max-w-7xl gap-6 rounded-[36px] border border-stone-200 bg-white p-7 shadow-sm lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-cyan-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-cyan-800">
              <Workflow className="h-4 w-4" />
              Ready to charge for proof
            </div>
            <h2 className="mt-4 max-w-4xl text-3xl font-semibold tracking-tight sm:text-5xl">Replace fragile timesheets with evidence clients can sign.</h2>
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
