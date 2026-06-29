"use client";

import { motion } from "framer-motion";
import { ArrowRight, BarChart3, FileCheck2, ShieldCheck, TimerReset, Webhook } from "lucide-react";
import { HeroSection } from "@/components/marketing/hero-section";
import { WorkflowSection } from "@/components/marketing/workflow-section";
import { MarketingContent } from "@/components/marketing/marketing-content";

const CAPABILITIES = [
  {
    title: "Invoice Proof Packs",
    shortTitle: "Proof packs",
    description: "Source mix, planned vs actual work, approvals, issued invoices, and digest evidence travel together.",
    metric: "SHA-256",
    icon: FileCheck2,
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
    description: "Clients approve focused proof packets without seeing team planning, timers, or workspace settings.",
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
    description: "Scoped keys, exports, proof endpoints, revenue intelligence, and webhooks sync billing evidence.",
    metric: "API",
    icon: Webhook,
    href: "#integrations",
  },
];

export default function MarketingPage() {
  return (
    <div className="bg-background text-slate-950">
      <section className="relative overflow-hidden border-b border-border px-4 pb-10 pt-10 sm:px-6 lg:pt-12">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(15,159,154,0.08)_1px,transparent_1px),linear-gradient(180deg,rgba(22,60,54,0.06)_1px,transparent_1px)] bg-[length:88px_88px]" />
        <div className="relative mx-auto grid min-h-[calc(100vh-64px)] max-w-7xl grid-rows-[1fr_auto] gap-8">
          
          <HeroSection 
            headline="Recover revenue. Prove every invoice."
            subhead="SOWLedger connects planning, timers, manual work, calendar logs, analytics, invoices, exports, sign-off, and APIs into one defensible billing system."
          />

          <motion.nav
            initial={{ y: 18, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.16 }}
            className="grid overflow-hidden rounded-2xl border border-border bg-border shadow-sm md:grid-cols-5"
            aria-label="SOWLedger capability navigation"
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

      <WorkflowSection 
        headline="The work path ends in proof, not a timesheet dump."
        subhead="Plan work, capture what happened, find leakage, approve the record, then export or integrate the evidence clients need to trust the bill."
      />

      <MarketingContent />

    </div>
  );
}
