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
    description: "Small teams that need approvals, API keys, webhooks, and recovery queues.",
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
  metric: string;
  icon: LucideIcon;
  href: string;
};

const CAPABILITIES: Capability[] = [
  {
    title: "Invoice Proof Packs",
    shortTitle: "Proof packs",
    description: "Source mix, planned vs actual work, approvals, issued invoices, and digest evidence travel together.",
    metric: "SHA-256",
    icon: FileDown,
    href: "#proof-packs",
  },
  {
    title: "Retainer Leak Radar",
    shortTitle: "Leak radar",
    description: "Budget pressure, approved unbilled time, and missing rates surface before the retainer meeting.",
    metric: "Risk queue",
    icon: BarChart3,
    href: "#recovery",
  },
  {
    title: "Client Sign-Off Portal",
    shortTitle: "Sign-off",
    description: "Clients approve focused proof packets without entering workspace admin or internal timer views.",
    metric: "Approve",
    icon: ShieldCheck,
    href: "#signoff",
  },
  {
    title: "Missing Billable Recovery",
    shortTitle: "Recovery",
    description: "Scheduled work without completed time, stale drafts, and manual gaps become a recovery queue.",
    metric: "Gap queue",
    icon: TimerReset,
    href: "#recovery",
  },
  {
    title: "Developer/Agency Integration Layer",
    shortTitle: "Integrations",
    description: "Scoped keys, exports, proof-pack endpoints, revenue intelligence, and webhooks sync billing evidence.",
    metric: "API v1",
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

const PROOF_ROWS = [
  { label: "Invoice record", value: "Issued invoices, totals, client, project, and status" },
  { label: "Work basis", value: "Planned vs actual hours with timer, manual, and calendar source mix" },
  { label: "Approval trail", value: "Sign-off state, audit events, and client-facing context" },
  { label: "Integrity", value: "CSV/JSON exports with x-billabled-export-sha256 digest headers" },
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
    src: "/images/marketing/invoice-proof-pack.png",
    alt: "Billabled invoice proof pack screenshot showing issued invoices, digest, source mix, and planned vs actual hours.",
    width: 1152,
    height: 1000,
  },
  {
    title: "Revenue recovery radar",
    src: "/images/marketing/revenue-radar.png",
    alt: "Billabled analytics screenshot showing Retainer Leak Radar and Missing Billable Recovery cards.",
    width: 1152,
    height: 1623,
  },
  {
    title: "Client sign-off portal",
    src: "/images/marketing/client-signoff-portal.png",
    alt: "Billabled client sign-off portal screenshot showing active projects and approval-ready proof packets.",
    width: 1440,
    height: 936,
  },
];

export default function MarketingPage() {
  return (
    <div className="bg-background text-slate-950">
      <section className="relative overflow-hidden border-b border-border px-4 pb-10 pt-10 sm:px-6 lg:pt-12">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(15,159,154,0.08)_1px,transparent_1px),linear-gradient(180deg,rgba(22,60,54,0.06)_1px,transparent_1px)] bg-[length:88px_88px]" />
        <div className="relative mx-auto grid min-h-[calc(100vh-64px)] max-w-7xl grid-rows-[1fr_auto] gap-8">
          <div className="grid gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
            <motion.div
              initial={{ y: 18, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.5 }}
              className="max-w-3xl"
            >
              <p className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-surface/90 px-4 py-1.5 text-sm font-bold text-cyan-800 shadow-sm">
                <Workflow className="h-4 w-4" />
                Proof-backed billing for agencies and operators
              </p>
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
                <Link href="#proof-packs" className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-surface px-7 py-4 text-base font-bold text-slate-800 shadow-sm transition hover:border-cyan-300 hover:text-cyan-700">
                  See invoice proof
                </Link>
              </div>
            </motion.div>

            <motion.figure
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.08 }}
              className="overflow-hidden rounded-2xl border border-border bg-surface shadow-xl shadow-stone-900/10"
            >
              <Image
                src="/images/marketing/invoice-proof-pack.png"
                alt="Billabled invoice proof pack screenshot showing issued invoices, digest, source mix, and planned vs actual hours."
                width={1152}
                height={1000}
                priority
                sizes="(min-width: 1024px) 52vw, 100vw"
                className="aspect-[1.2/1] w-full object-cover object-top"
              />
              <figcaption className="grid gap-px border-t border-border bg-border text-sm sm:grid-cols-4">
                {PROOF_ROWS.map((row) => (
                  <div key={row.label} className="bg-surface px-4 py-3">
                    <p className="font-bold text-slate-950">{row.label}</p>
                    <p className="mt-1 leading-5 text-slate-600">{row.value}</p>
                  </div>
                ))}
              </figcaption>
            </motion.figure>
          </div>

          <motion.nav
            initial={{ y: 18, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.16 }}
            className="grid overflow-hidden rounded-2xl border border-border bg-border shadow-sm md:grid-cols-5"
            aria-label="Billabled capability navigation"
          >
            {CAPABILITIES.map((capability) => {
              const Icon = capability.icon;
              return (
                <a key={capability.title} href={capability.href} className="group min-h-36 bg-surface p-4 transition hover:bg-white">
                  <div className="flex items-center justify-between gap-3">
                    <Icon className="h-5 w-5 text-cyan-700" />
                    <span className="font-mono text-xs font-bold text-slate-500">{capability.metric}</span>
                  </div>
                  <p className="mt-5 text-sm font-bold text-slate-950">{capability.shortTitle}</p>
                  <p className="mt-2 text-xs leading-5 text-slate-600">{capability.description}</p>
                  <ArrowRight className="mt-4 h-4 w-4 text-slate-300 transition group-hover:translate-x-1 group-hover:text-cyan-700" />
                </a>
              );
            })}
          </motion.nav>
        </div>
      </section>

      <section id="workflow" className="border-b border-border bg-surface px-4 py-14 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-5 lg:grid-cols-[0.75fr_1fr] lg:items-end">
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
          <div className="mt-8 divide-y divide-border border-y border-border">
            {WORKFLOW.map((item, index) => (
              <div key={item.step} className="grid gap-3 py-5 md:grid-cols-[6rem_18rem_1fr] md:items-center">
                <p className="font-mono text-xs font-black uppercase tracking-[0.22em] text-cyan-700">0{index + 1}</p>
                <h3 className="text-xl font-semibold">{item.step}</h3>
                <p className="text-sm leading-6 text-slate-600">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="proof-packs" className="px-4 py-20 sm:px-6 sm:py-24">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Invoice evidence</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight sm:text-6xl">Invoice Proof Packs</h2>
            <p className="mt-5 text-lg leading-8 text-slate-600">
              Every invoice can carry the billing story behind it: the planned work, completed work, source mix, approvals, and digest-backed evidence that makes the number easier to defend.
            </p>
            <div className="mt-8 overflow-hidden rounded-2xl border border-border bg-border">
              {PROOF_ROWS.map((row) => (
                <div key={row.label} className="grid gap-2 border-b border-border bg-surface p-4 last:border-b-0 sm:grid-cols-[12rem_1fr]">
                  <p className="text-sm font-bold text-slate-950">{row.label}</p>
                  <p className="text-sm leading-6 text-slate-600">{row.value}</p>
                </div>
              ))}
            </div>
          </div>

          <motion.figure
            initial={{ y: 18, opacity: 0 }}
            whileInView={{ y: 0, opacity: 1 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: 0.42 }}
            className="overflow-hidden rounded-2xl border border-border bg-surface shadow-lg shadow-stone-900/10"
          >
            <Image
              src="/images/marketing/invoice-proof-pack.png"
              alt="Billabled invoice proof pack screenshot showing issued invoices, digest, source mix, and planned vs actual hours."
              width={1152}
              height={1000}
              sizes="(min-width: 1024px) 52vw, 100vw"
              className="aspect-[1.12/1] w-full object-cover object-top"
            />
          </motion.figure>
        </div>
      </section>

      <section id="recovery" className="border-y border-border bg-surface px-4 py-20 sm:px-6 sm:py-24">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <motion.figure
            initial={{ y: 18, opacity: 0 }}
            whileInView={{ y: 0, opacity: 1 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: 0.42 }}
            className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm"
          >
            <Image
              src="/images/marketing/revenue-radar.png"
              alt="Billabled analytics screenshot showing Retainer Leak Radar and Missing Billable Recovery cards."
              width={1152}
              height={1623}
              sizes="(min-width: 1024px) 52vw, 100vw"
              className="aspect-[4/3] w-full object-cover object-top"
            />
          </motion.figure>

          <div>
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Revenue intelligence</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight sm:text-6xl">Find leakage before the retainer meeting.</h2>
            <p className="mt-5 text-lg leading-8 text-slate-600">
              Billabled turns analytics into operator queues for work that should be protected, corrected, invoiced, or explained with evidence.
            </p>
            <div className="mt-8 divide-y divide-border border-y border-border">
              {[
                {
                  title: "Retainer Leak Radar",
                  metric: "Risk queue",
                  label: "retainer signals",
                  description: "Budget burn, approved unbilled time, and missing rates are grouped before they become a tense client conversation.",
                  icon: TrendingUp,
                },
                {
                  title: "Missing Billable Recovery",
                  metric: "Gap queue",
                  label: "time capture",
                  description: "Scheduled work without completed entries, stale drafts, and manual gaps become an operator queue instead of lost revenue.",
                  icon: Clock3,
                },
              ].map((queue) => {
                const Icon = queue.icon;
                return (
                  <div key={queue.title} className="grid gap-4 py-5 sm:grid-cols-[2.5rem_1fr_auto] sm:items-center">
                    <Icon className="h-6 w-6 text-cyan-700" />
                    <div>
                      <h3 className="text-2xl font-semibold">{queue.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{queue.description}</p>
                    </div>
                    <div className="sm:text-right">
                      <p className="text-3xl font-semibold tracking-tight text-cyan-800">{queue.metric}</p>
                      <p className="mt-1 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{queue.label}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section id="signoff" className="px-4 py-20 sm:px-6 sm:py-24">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Client approval</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight sm:text-6xl">Client Sign-Off Portal</h2>
            <p className="mt-5 text-lg leading-8 text-slate-600">
              Clients can review proof packets, approve the work, and see billing context without gaining access to internal planning, timers, API keys, or workspace controls.
            </p>
            <div className="mt-8 divide-y divide-border border-y border-border">
              {["Approval-ready packets", "Client-safe access", "Faster resolution"].map((item) => (
                <div key={item} className="flex items-center gap-3 py-4 text-sm font-semibold text-slate-700">
                  <FileCheck2 className="h-5 w-5 text-cyan-700" />
                  {item}
                </div>
              ))}
            </div>
          </div>

          <motion.figure
            initial={{ y: 18, opacity: 0 }}
            whileInView={{ y: 0, opacity: 1 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: 0.42 }}
            className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm"
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
        </div>
      </section>

      <section id="integrations" className="bg-slate-950 px-4 py-20 text-white sm:px-6 sm:py-24">
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
            className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] shadow-2xl shadow-black/20"
          >
            <div className="flex items-center gap-3 border-b border-white/10 p-5">
              <div className="rounded-lg bg-cyan-400/15 p-3 text-cyan-200">
                <Code2 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-bold">Scoped integration contract</p>
                <p className="text-xs text-slate-400">Keys are hashed, expirable, revocable, and usage-tracked.</p>
              </div>
            </div>
            <div className="divide-y divide-white/10">
              {INTEGRATION_ROWS.map((row) => (
                <div key={row.label} className="grid gap-2 p-4 sm:grid-cols-[16rem_1fr] sm:items-center">
                  <span className="font-mono text-sm text-cyan-200">{row.label}</span>
                  <span className="text-sm text-slate-300">{row.value}</span>
                </div>
              ))}
            </div>
            <div className="grid border-t border-white/10 sm:grid-cols-3">
              {[
                { icon: KeyRound, label: "Show once" },
                { icon: LockKeyhole, label: "Hashed storage" },
                { icon: DatabaseZap, label: "Usage tracked" },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="border-b border-white/10 p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
                    <Icon className="h-5 w-5 text-cyan-200" />
                    <p className="mt-3 text-sm font-bold">{item.label}</p>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </div>
      </section>

      <section className="px-4 py-20 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-7xl">
          <div className="mb-10 max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Product proof</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight sm:text-6xl">Real screens for the work customers pay for.</h2>
            <p className="mt-4 text-lg leading-8 text-slate-600">
              The page sells the actual proof, recovery, sign-off, and integration surfaces a paying customer will use.
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
                className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm"
              >
                <Image
                  src={screenshot.src}
                  alt={screenshot.alt}
                  width={screenshot.width}
                  height={screenshot.height}
                  sizes="(min-width: 1024px) 31vw, 100vw"
                  className="aspect-[16/11] w-full border-b border-border object-cover object-top"
                />
                <figcaption className="p-5">
                  <h3 className="text-xl font-semibold">{screenshot.title}</h3>
                </figcaption>
              </motion.figure>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="border-y border-border bg-surface px-4 py-20 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-7xl">
          <div className="mb-10 max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Pricing</p>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight sm:text-6xl">Flat workspace pricing for proof-backed billing.</h2>
            <p className="mt-4 max-w-2xl text-lg text-slate-600">Start free, then move to fixed monthly workspace plans as recovery, sign-off, analytics, and integration needs grow.</p>
          </div>
          <div className="overflow-hidden rounded-2xl border border-border bg-border">
            {MARKETING_PLANS.map((plan) => (
              <div key={plan.planId} className={`grid gap-5 border-b border-border p-5 last:border-b-0 lg:grid-cols-[13rem_1fr_11rem_9rem] lg:items-center ${plan.recommended ? "bg-cyan-50/70" : "bg-surface"}`}>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-2xl font-semibold">{plan.name}</h3>
                    {plan.recommended && <span className="rounded-full bg-cyan-700 px-3 py-1 text-xs font-bold text-white">Studio</span>}
                  </div>
                  <p className="mt-1 text-sm text-slate-500">{plan.planId}</p>
                </div>
                <div>
                  <p className="text-sm leading-6 text-slate-600">{plan.description}</p>
                  <p className="mt-2 text-sm font-bold text-slate-800">{plan.outcome}</p>
                  <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-600">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2"><Check className="h-4 w-4 text-cyan-700" />{feature}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <span className="text-4xl font-semibold tracking-tight">${plan.price}</span>
                  <span className="text-sm font-semibold text-slate-500">/workspace/mo</span>
                  <p className="mt-1 text-xs text-slate-500">{plan.limits.members} member{plan.limits.members === 1 ? "" : "s"} · {plan.limits.projects} projects</p>
                </div>
                <Link href="/login" className="inline-flex items-center justify-center rounded-full bg-slate-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-slate-800">
                  Get started
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-20 sm:px-6 sm:py-24">
        <div className="mx-auto grid max-w-7xl gap-6 border-y border-border py-10 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-cyan-800">
              <Workflow className="h-4 w-4" />
              Ready to charge for proof
            </p>
            <h2 className="mt-4 max-w-4xl text-3xl font-semibold tracking-tight sm:text-5xl">Replace fragile timesheets with evidence clients can sign.</h2>
            <p className="mt-3 max-w-2xl text-slate-600">Create a workspace, capture planned and completed work, recover missed billables, and turn approved time into proof-backed invoices.</p>
          </div>
          <Link href="/login" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-cyan-700 px-6 py-4 text-sm font-bold text-white transition hover:bg-cyan-600">
            Start free <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
