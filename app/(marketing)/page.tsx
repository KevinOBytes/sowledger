"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import Link from "next/link";
import { useRef, useEffect, useState } from "react";

// The constant background animation component
function BackgroundText() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/rules-of-hooks, react-hooks/set-state-in-effect
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
              Introducing Timely Pro
            </motion.div>
            <motion.h1
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.1, ease: "easeOut" }}
              className="mb-8 text-5xl font-extrabold tracking-tight sm:text-7xl lg:text-8xl"
            >
              Master your time. <br />
              <span className="bg-gradient-to-r from-cyan-400 to-indigo-500 bg-clip-text text-transparent">
                Elevate your work.
              </span>
            </motion.h1>
            <motion.p
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
              className="mx-auto mb-12 max-w-2xl text-lg text-slate-400 sm:text-xl"
            >
              The most advanced, beautifully designed time tracking and workforce intelligence platform. Built for professionals who demand excellence.
            </motion.p>
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.3, ease: "easeOut" }}
              className="flex justify-center gap-4"
            >
              <Link
                href="/login"
                className="rounded-full bg-white px-8 py-4 text-base font-semibold text-black transition-transform hover:scale-105"
              >
                Get Started Free
              </Link>
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
                  Seamless tracking.
                </h2>
                <p className="text-lg text-slate-400">
                  Track every second with precision. No clunky interfaces, just a beautifully smooth widget that stays out of your way until you need it. Intelligent categorization and automatic pause/resume flows.
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
            </div>
            <div className="grid gap-6 md:grid-cols-3">
              <div className="col-span-1 flex min-h-[300px] flex-col justify-end rounded-3xl border border-white/10 bg-slate-900/50 p-8 shadow-xl backdrop-blur-sm transition-transform hover:-translate-y-2 hover:bg-slate-900/80">
                <h3 className="mb-2 text-2xl font-bold">In-Depth Reporting</h3>
                <p className="text-slate-400">Generate stunning, exportable reports to understand exactly where yours and your team&apos;s time is going.</p>
              </div>
              <div className="col-span-1 flex min-h-[300px] flex-col justify-end rounded-3xl border border-white/10 bg-slate-900/50 p-8 shadow-xl backdrop-blur-sm transition-transform hover:-translate-y-2 hover:bg-slate-900/80">
                <h3 className="mb-2 text-2xl font-bold">Approvals Flow</h3>
                <p className="text-slate-400">Ensure timesheets are manager-approved before invoicing. Built-in auditing guarantees accountability.</p>
              </div>
              <div className="col-span-1 flex min-h-[300px] flex-col justify-end rounded-3xl border border-white/10 bg-slate-900/50 p-8 shadow-xl backdrop-blur-sm transition-transform hover:-translate-y-2 hover:bg-slate-900/80">
                <h3 className="mb-2 text-2xl font-bold">API & Webhooks</h3>
                <p className="text-slate-400">Integrate deeply into your existing ecosystem. We seamlessly sync with Slack, Discord, and internal tools.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="py-32 px-6">
          <div className="mx-auto max-w-4xl text-center">
            <h2 className="mb-8 text-5xl font-extrabold tracking-tight sm:text-7xl">
              Ready to take control?
            </h2>
            <Link
              href="/login"
              className="inline-flex rounded-full bg-cyan-600 px-8 py-4 text-lg font-bold text-white transition-all hover:scale-105 hover:bg-cyan-500 shadow-[0_0_40px_-10px_rgba(6,182,212,0.5)]"
            >
              Start tracking for free
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
