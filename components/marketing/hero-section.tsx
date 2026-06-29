"use client";

import { motion } from "framer-motion";
import { ArrowRight, Workflow } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

const PROOF_ROWS = [
  { label: "Invoice record", value: "Issued invoices, totals, client, project, and status" },
  { label: "Work basis", value: "Planned vs actual hours with timer, manual, and calendar source mix" },
  { label: "Approval trail", value: "Sign-off state, audit events, and client-facing context" },
  { label: "Integrity", value: "CSV/JSON exports with x-sowledger-export-sha256 digest headers" },
];

interface HeroSectionProps {
  label?: string;
  headline: string;
  subhead: string;
}

export function HeroSection({
  label = "Proof-backed billing for agencies and service teams",
  headline,
  subhead,
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
          alt="SOWLedger invoice proof pack screenshot showing issued invoices, digest, source mix, and planned vs actual hours."
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
  );
}
