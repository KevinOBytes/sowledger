"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  Check,
  ShieldCheck,
  Sparkles,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRef, useEffect, useState } from "react";

const MARKETING_PLANS = [
  {
    planId: "free",
    name: "Free",
    description: "Try the operational workflow on a small workspace.",
    price: 0,
    features: ["time-tracking", "manual-logging"],
    limits: { members: 1, projects: 2, storageMB: 100, goals: 1 },
  },
  {
    planId: "pro",
    name: "Starter",
    description: "A low-friction paid plan for solo operators who need invoices, exports, and planned work.",
    price: 9,
    features: ["time-tracking", "manual-logging", "schedule", "analytics", "exports", "invoicing"],
    limits: { members: 2, projects: 10, storageMB: 1000, goals: 10 },
  },
  {
    planId: "smb",
    name: "Studio",
    description: "Small-team operations with approvals, API keys, webhooks, and complete exports.",
    price: 29,
    features: ["time-tracking", "manual-logging", "schedule", "analytics", "exports", "api", "webhooks", "invoicing", "approvals"],
    limits: { members: 5, projects: 50, storageMB: 5000, goals: 50 },
  },
  {
    planId: "enterprise",
    name: "Business",
    description: "More seats, audit depth, advanced API usage, and priority support for growing firms.",
    price: 79,
    features: ["time-tracking", "manual-logging", "schedule", "analytics", "exports", "api", "webhooks", "invoicing", "approvals", "saml"],
    limits: { members: 20, projects: 200, storageMB: 25000, goals: 200 },
  },
];

// The constant background animation component
function BackgroundText() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
     
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const phrase = "TIMELY INTELLIGENCE CLOUD PROTOCOL 0x8F92A SEQUENCE INITIATED • ";
  const fullText = phrase.repeat(20);

  return (
    <div className="pointer-events-none fixed inset-0 z-0 flex items-center justify-center overflow-hidden opacity-[0.03] select-none">
      <div className="flex w-[200vw] rotate-[-15deg] flex-col gap-12 font-mono text-[8rem] font-bold leading-none tracking-tighter text-cyan-500">
        <motion.div
          animate={{ x: [0, -2000] }}
          transition={{ repeat: Infinity, duration: 40, ease: "linear" }}
          className="whitespace-nowrap"
        >
          {fullText}
        </motion.div>
        <motion.div
          animate={{ x: [-2000, 0] }}
          transition={{ repeat: Infinity, duration: 50, ease: "linear" }}
          className="whitespace-nowrap"
        >
          {fullText}
        </motion.div>
        <motion.div
          animate={{ x: [0, -2000] }}
          transition={{ repeat: Infinity, duration: 45, ease: "linear" }}
          className="whitespace-nowrap"
        >
          {fullText}
        </motion.div>
        <motion.div
          animate={{ x: [-2000, 0] }}
          transition={{ repeat: Infinity, duration: 35, ease: "linear" }}
          className="whitespace-nowrap"
        >
          {fullText}
        </motion.div>
      </div>
    </div>
  );
}

type FeatureCard = {
  title: string;
  description: string;
  icon: LucideIcon;
  eyebrow: string;
  gradient: string;
};

const FEATURE_CARDS: FeatureCard[] = [
  {
    title: "In-Depth Reporting",
    description:
      "Generate polished, export-ready reports that reveal where your team actually spends time and where profitability leaks.",
    icon: BarChart3,
    eyebrow: "Analytics",
    gradient: "from-cyan-500/20 via-sky-500/10 to-transparent",
  },
  {
    title: "Approvals Flow",
    description:
      "Capture manager approvals before invoicing with immutable audit trails to keep teams aligned and accountable.",
    icon: ShieldCheck,
    eyebrow: "Compliance",
    gradient: "from-emerald-500/20 via-teal-500/10 to-transparent",
  },
  {
    title: "API & Webhooks",
    description:
      "Connect Billabled to your stack with robust webhooks and APIs that sync tasks, projects, and billing data in real-time.",
    icon: Webhook,
    eyebrow: "Integrations",
    gradient: "from-indigo-500/20 via-violet-500/10 to-transparent",
  },
];

export default function MarketingPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: containerRef });

  const heroY = useTransform(scrollYProgress, [0, 0.2], [0, 150]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.15], [1, 0]);

  const feature1Y = useTransform(scrollYProgress, [0.1, 0.3], [100, 0]);
  const feature1Opacity = useTransform(scrollYProgress, [0.1, 0.3], [0, 1]);

  return (
    <div ref={containerRef} className="relative w-full">
      <BackgroundText />

      {/* Ambient gradient orbs */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-cyan-600/10 blur-[100px]" />
        <div className="absolute right-0 top-1/3 h-80 w-80 rounded-full bg-violet-600/5 blur-[100px]" />
      </div>

      <div className="relative z-10">
        {/* Hero Section */}
        <section className="flex min-h-screen flex-col items-center justify-center px-6 pt-20 text-center">
          <motion.div style={{ y: heroY, opacity: heroOpacity }} className="max-w-4xl">
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="mb-6 inline-flex rounded-full border border-cyan-500/30 bg-cyan-500/10 px-4 py-1.5 text-sm font-medium text-cyan-300"
            >
              Flat workspace pricing for operators
            </motion.div>
            <motion.h1
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.1, ease: "easeOut" }}
              className="mb-8 text-5xl font-extrabold tracking-tight sm:text-7xl lg:text-8xl"
            >
              Plan the work. <br />
              <span className="bg-gradient-to-r from-cyan-400 to-indigo-500 bg-clip-text text-transparent">
                Prove every billable hour.
              </span>
            </motion.h1>
            <motion.p
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
              className="mx-auto mb-12 max-w-2xl text-lg text-slate-400 sm:text-xl"
            >
              Billabled turns schedules, live timers, manual time, approvals, invoices, exports, and API access into one operational flow for research and technical service teams.
            </motion.p>
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.3, ease: "easeOut" }}
              className="flex flex-col items-center justify-center gap-4 sm:flex-row"
            >
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-full bg-white px-8 py-4 text-base font-semibold text-black transition-transform hover:scale-105"
              >
                Start free
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="#pricing"
                className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-8 py-4 text-base font-semibold text-white transition-colors hover:border-cyan-400/50 hover:bg-cyan-500/10"
              >
                View pricing
              </Link>
            </motion.div>
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.4, ease: "easeOut" }}
              className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-slate-300"
            >
              <span className="inline-flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-cyan-400" />
                Plan-to-invoice workflow
              </span>
              <span className="inline-flex items-center gap-2">
                <Check className="h-4 w-4 text-cyan-400" />
                Exportable audit records
              </span>
              <span className="inline-flex items-center gap-2">
                <Check className="h-4 w-4 text-cyan-400" />
                Public API and webhooks
              </span>
            </motion.div>
          </motion.div>
        </section>

        {/* Feature Highlights (Parallax) */}
        <section className="min-h-screen py-32 px-6">
          <motion.div
            style={{ y: feature1Y, opacity: feature1Opacity }}
            className="mx-auto max-w-6xl"
          >
            <div className="grid gap-12 md:grid-cols-2 lg:gap-24">
              <div className="flex flex-col justify-center">
                <h2 className="mb-6 text-3xl font-bold tracking-tight sm:text-5xl">
                  One flow, not five disconnected tools.
                </h2>
                <p className="text-lg text-slate-400">
                  Plan work like a calendar event, start timers from the plan, log offline work manually, and keep the result ready for analytics, invoicing, exports, or API sync.
                </p>
              </div>
              <div className="relative aspect-square overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900 to-slate-950 p-8 shadow-2xl">
                {/* Abstract UI representation */}
                <div className="absolute inset-x-8 top-8 bottom-8 rounded-2xl border border-white/5 bg-[#050914] shadow-inner flex flex-col p-6 gap-4">
                  <div className="h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 w-3/4 animate-pulse"></div>
                  <div className="h-8 rounded-xl bg-white/5 border border-white/10 w-full mt-auto"></div>
                  <div className="h-8 rounded-xl bg-white/5 border border-white/10 w-5/6"></div>
                  <div className="h-8 rounded-xl bg-white/5 border border-white/10 w-4/6"></div>
                </div>
              </div>
            </div>
          </motion.div>
        </section>

        {/* Bento Grid */}
        <section className="py-32 px-6">
          <div className="mx-auto max-w-6xl">
            <div className="mb-20 text-center">
              <h2 className="text-4xl font-bold tracking-tight sm:text-6xl">Everything you need.</h2>
              <p className="mx-auto mt-4 max-w-2xl text-base text-slate-400 sm:text-lg">
                Feature blocks now include visual cues so each capability is scannable at a glance.
              </p>
            </div>
            <div className="grid gap-6 md:grid-cols-3">
              {FEATURE_CARDS.map((feature, index) => {
                const Icon = feature.icon;

                return (
                  <motion.div
                    key={feature.title}
                    initial={{ y: 24, opacity: 0 }}
                    whileInView={{ y: 0, opacity: 1 }}
                    viewport={{ once: true, amount: 0.4 }}
                    transition={{ duration: 0.45, delay: index * 0.08 }}
                    className="group col-span-1 flex min-h-[340px] flex-col rounded-3xl border border-white/10 bg-slate-900/50 p-8 shadow-xl backdrop-blur-sm transition-all hover:-translate-y-2 hover:border-cyan-400/40 hover:bg-slate-900/80"
                  >
                    <div className="mb-5 flex items-center justify-between">
                      <span className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-300">
                        {feature.eyebrow}
                      </span>
                      <div className="rounded-xl border border-white/20 bg-white/10 p-2.5 text-cyan-300 transition-colors group-hover:border-cyan-400/50 group-hover:bg-cyan-500/10">
                        <Icon className="h-5 w-5" />
                      </div>
                    </div>
                    <div className="relative mb-6 overflow-hidden rounded-2xl border border-white/10 bg-[#030812] p-4">
                      <div className={`absolute inset-0 bg-gradient-to-br ${feature.gradient}`} />
                      <div className="relative space-y-3">
                        <div className="h-2.5 w-5/6 rounded-full bg-white/25" />
                        <div className="h-2.5 w-3/5 rounded-full bg-white/15" />
                        <div className="flex items-center gap-2 pt-2">
                          <div className="h-9 w-9 rounded-lg border border-white/20 bg-white/10 p-2 text-cyan-300">
                            <Icon className="h-5 w-5" />
                          </div>
                          <div className="h-9 flex-1 rounded-lg border border-white/20 bg-white/10" />
                        </div>
                      </div>
                    </div>
                    <h3 className="mb-2 text-2xl font-bold">{feature.title}</h3>
                    <p className="text-slate-400">{feature.description}</p>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <section id="pricing" className="py-32 px-6 bg-gradient-to-b from-transparent via-[#050914] to-transparent">
          <div className="mx-auto max-w-6xl">
            <div className="mb-20 text-center">
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                whileInView={{ y: 0, opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5 }}
                className="mb-4 inline-flex rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-violet-400"
              >
                Pricing
              </motion.div>
              <h2 className="text-4xl font-bold tracking-tight sm:text-6xl">Easy to approve. Useful on day one.</h2>
              <p className="mt-4 text-lg text-slate-400">Flat monthly workspace pricing keeps the first paid step small while still funding TKOResearch.</p>
            </div>
            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
              {MARKETING_PLANS.map((plan, i) => (
                <motion.div
                  key={plan.planId}
                  initial={{ y: 20, opacity: 0 }}
                  whileInView={{ y: 0, opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                  className="flex flex-col justify-between rounded-3xl border border-white/10 bg-slate-900/50 p-8 shadow-xl backdrop-blur-md transition-transform hover:-translate-y-2 hover:border-cyan-500/50"
                >
                  <div>
                    <h3 className="text-2xl font-bold text-white">{plan.name}</h3>
                    <p className="mt-2 text-sm text-slate-400 min-h-[40px]">{plan.description}</p>
                    <div className="my-6">
                      <span className="text-5xl font-extrabold tracking-tight">${plan.price}</span>
                      <span className="text-slate-500">/workspace/mo</span>
                    </div>
                    <p className="mb-5 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-200">No per-seat surprise at checkout</p>

                    <ul className="mb-8 space-y-4 text-sm text-slate-300">
                      <li className="flex items-center gap-3">
                        <svg className="h-5 w-5 text-cyan-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        {plan.limits.members >= 9999 ? "Unlimited members" : `Up to ${plan.limits.members} member${plan.limits.members === 1 ? "" : "s"}`}
                      </li>
                      <li className="flex items-center gap-3">
                        <svg className="h-5 w-5 text-cyan-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        {plan.limits.projects >= 9999 ? "Unlimited projects" : `Up to ${plan.limits.projects} active projects`}
                      </li>
                      <li className="flex items-center gap-3">
                        <svg className="h-5 w-5 text-cyan-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        {plan.limits.storageMB >= 999999 ? "Unlimited file storage" : `${Math.max(1, Math.round(plan.limits.storageMB / 1000))}GB file storage`}
                      </li>
                      {plan.features.includes("invoicing") && (
                        <li className="flex items-center gap-3">
                          <svg className="h-5 w-5 text-cyan-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                          Professional Invoicing
                        </li>
                      )}
                      {plan.features.includes("api") && (
                        <li className="flex items-center gap-3">
                          <svg className="h-5 w-5 text-cyan-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                          API keys and webhooks
                        </li>
                      )}
                      {plan.features.includes("approvals") && (
                        <li className="flex items-center gap-3">
                          <svg className="h-5 w-5 text-cyan-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                          Manager Approvals Flow
                        </li>
                      )}
                      {plan.features.includes("saml") && (
                        <li className="flex items-center gap-3">
                          <svg className="h-5 w-5 text-cyan-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                          SAML SSO & Audit Logs
                        </li>
                      )}
                    </ul>
                  </div>
                  <Link
                    href="/login"
                    className="block w-full rounded-xl bg-white/5 py-3 text-center text-sm font-semibold text-white transition hover:bg-white/10 focus:ring-2 focus:ring-cyan-500"
                  >
                    Get Started
                  </Link>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="py-32 px-6">
          <div className="mx-auto max-w-4xl text-center">
            <h2 className="mb-8 text-5xl font-extrabold tracking-tight sm:text-7xl">
              Ready to turn work into revenue records?
            </h2>
            <Link
              href="/login"
              className="inline-flex rounded-full bg-cyan-600 px-8 py-4 text-lg font-bold text-white transition-all hover:scale-105 hover:bg-cyan-500 shadow-[0_0_40px_-10px_rgba(6,182,212,0.5)]"
            >
              Start free
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
