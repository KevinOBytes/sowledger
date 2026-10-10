"use client";

import { motion } from "framer-motion";
import { ArrowRight, FileText, Workflow } from "lucide-react";
import Link from "next/link";

const EXAMPLE_ENTRIES = [
  { work: "Discovery call", time: "45m", amount: "$90" },
  { work: "Website updates", time: "2h 30m", amount: "$300" },
  { work: "Review changes", time: "1h", amount: "$120" },
];

interface HeroSectionProps {
  label?: string;
  headline: string;
  subhead: string;
  primaryCtaLabel?: string;
}

export function HeroSection({
  label = "Time tracking and invoicing for client work",
  headline,
  subhead,
  primaryCtaLabel = "Start free",
}: HeroSectionProps) {
  return (
    <div className="grid gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
      <motion.div
        initial={{ y: 18, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="max-w-3xl"
      >
        <p className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-surface/90 px-4 py-1.5 text-sm font-bold text-cyan-800 shadow-sm">
          <Workflow className="h-4 w-4" />
          {label}
        </p>
        <h1 className="mt-6 max-w-4xl text-5xl font-semibold tracking-tight text-slate-950 sm:text-6xl lg:text-7xl">
          {headline}
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-700 sm:text-xl">
          {subhead}
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href="/login" className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-950 px-7 py-4 text-base font-bold text-white shadow-sm transition hover:bg-slate-800">
            {primaryCtaLabel}
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href="#proof-packs" className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-surface px-7 py-4 text-base font-bold text-slate-800 shadow-sm transition hover:border-cyan-300 hover:text-cyan-700">
            See how invoicing works
          </Link>
        </div>
      </motion.div>

      <motion.figure
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.08 }}
        className="overflow-hidden rounded-2xl border border-border bg-surface shadow-xl shadow-stone-900/10"
      >
        <div className="p-6 sm:p-8">
          <div className="flex items-center justify-between gap-4 border-b border-border pb-6">
            <div>
              <p className="text-sm font-semibold text-cyan-800">Example invoice</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950">Website refresh</h2>
            </div>
            <FileText className="h-8 w-8 text-cyan-700" aria-hidden="true" />
          </div>
          <table className="mt-5 w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr><th className="pb-3 font-medium">Work</th><th className="pb-3 pr-4 text-right font-medium">Time</th><th className="pb-3 text-right font-medium">Amount</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {EXAMPLE_ENTRIES.map((entry) => (
                <tr key={entry.work}>
                  <td className="py-5 pr-3 font-medium text-slate-800">{entry.work}</td>
                  <td className="whitespace-nowrap py-5 pr-4 text-right text-slate-600">{entry.time}</td>
                  <td className="py-5 text-right font-semibold text-slate-900">{entry.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 flex items-end justify-between gap-4 rounded-xl bg-cyan-50 p-5">
            <div><p className="font-semibold text-slate-900">4h 15m of work</p><p className="mt-1 text-sm text-slate-600">Billed at $120 per hour</p></div>
            <p className="text-3xl font-semibold tracking-tight text-slate-950">$510</p>
          </div>
          <p className="mt-5 text-sm leading-6 text-slate-600">An invoice with the time and work details behind the total.</p>
        </div>
        <figcaption className="border-t border-border px-6 py-3 text-xs text-slate-500 sm:px-8">
          Illustrative example, not customer data or an app screenshot.
        </figcaption>
      </motion.figure>
    </div>
  );
}
