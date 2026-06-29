"use client";

import { motion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  Code2,
  DatabaseZap,
  FileCheck2,
  KeyRound,
  LockKeyhole,
  TrendingUp,
  Clock3,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";

const PROOF_ROWS = [
  { label: "Invoice record", value: "Issued invoices, totals, client, project, and status" },
  { label: "Work basis", value: "Planned vs actual hours with timer, manual, and calendar source mix" },
  { label: "Approval trail", value: "Sign-off state, audit events, and client-facing context" },
  { label: "Integrity", value: "CSV/JSON exports with x-sowledger-export-sha256 digest headers" },
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
    alt: "SOWLedger invoice proof pack screenshot showing issued invoices, digest, source mix, and planned vs actual hours.",
    width: 1152,
    height: 1000,
  },
  {
    title: "Revenue recovery radar",
    src: "/images/marketing/revenue-radar.png",
    alt: "SOWLedger analytics screenshot showing Retainer Leak Radar and Missing Billable Recovery cards.",
    width: 1152,
    height: 1623,
  },
  {
    title: "Client sign-off portal",
    src: "/images/marketing/client-signoff-portal.png",
    alt: "SOWLedger client sign-off portal screenshot showing active projects and approval-ready proof packets.",
    width: 1440,
    height: 936,
  },
];

export function MarketingContent() {
  return (
    <>
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
              alt="SOWLedger invoice proof pack screenshot showing issued invoices, digest, source mix, and planned vs actual hours."
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
              alt="SOWLedger analytics screenshot showing Retainer Leak Radar and Missing Billable Recovery cards."
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
              SOWLedger turns analytics into review queues for work that should be protected, corrected, invoiced, or explained with evidence.
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
                  description: "Scheduled work without completed entries, stale drafts, and manual gaps become a review queue instead of lost revenue.",
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
              Clients can review proof packets, approve the work, and see billing context without gaining access to team planning, timers, API keys, or workspace controls.
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
              alt="SOWLedger client sign-off portal screenshot showing active projects and approval-ready proof packets."
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
              Agency systems can fetch invoice proof, revenue intelligence, exports, and event updates through scoped keys while billing changes, invites, subscription management, and workspace administration stay inside SOWLedger.
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
    </>
  );
}
