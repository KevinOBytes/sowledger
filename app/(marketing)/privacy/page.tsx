import Link from "next/link";
import { ArrowRight, Database, Mail, ShieldCheck } from "lucide-react";

const SECTIONS = [
  ["What we collect", "Account email, workspace metadata, clients, projects, time records, schedule records, billing identifiers, API key metadata, and support messages you submit."],
  ["How we use it", "We use workspace data to provide scheduling, timers, completed work logging, analytics, exports, invoices, API access, support, security monitoring, and billing operations."],
  ["What we do not store", "API key secrets are shown once and stored only as hashes. Payment card details are handled by Stripe, not stored directly by SOWLedger."],
  ["Data exports", "Workspace owners and managers can export operational data in CSV or JSON. Exports exclude secrets and include integrity headers where supported."],
  ["Retention", "Operational records stay available until deleted through product workflows or by a verified workspace request, subject to legal, billing, and security obligations."],
  ["Contact", "Privacy questions can be sent through the contact page. Include the workspace name and the email tied to your account."],
];

export const metadata = {
  title: "Privacy - SOWLedger",
  description: "SOWLedger privacy notice covering workspace data, API key handling, Stripe payment boundaries, exports, retention, and support contact guidance.",
};

export default function PrivacyPage() {
  return (
    <div className="bg-background px-4 pb-20 pt-12 text-slate-950 sm:px-6 lg:pt-16">
      <div className="mx-auto max-w-6xl">
        <section className="rounded-2xl border border-border bg-surface p-6 shadow-xl shadow-stone-900/10 sm:p-8">
          <div className="flex flex-wrap items-center gap-3">
            <p className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-4 py-1.5 text-sm font-bold text-cyan-800">
              <ShieldCheck className="h-4 w-4" />
              Trust center
            </p>
            <p className="rounded-full border border-border bg-background px-4 py-1.5 text-sm font-bold text-slate-700">Last updated May 4, 2026</p>
          </div>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-6xl">Privacy notice</h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-700">
            This page explains what SOWLedger needs to operate planning, timers, billing evidence, exports, API access, and support. It is not a request to send secrets or payment data to support.
          </p>
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm shadow-stone-900/5">
            <Database className="h-6 w-6 text-cyan-700" />
            <h2 className="mt-4 text-2xl font-semibold">Summary</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              SOWLedger stores operational workspace data, stores only API key metadata and hashes, uses Stripe for card handling, and provides exports for workspace review.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <span className="rounded-full bg-cyan-50 px-3 py-1.5 text-xs font-bold text-cyan-800">Workspace data</span>
              <span className="rounded-full bg-cyan-50 px-3 py-1.5 text-xs font-bold text-cyan-800">Hashed keys</span>
              <span className="rounded-full bg-cyan-50 px-3 py-1.5 text-xs font-bold text-cyan-800">Stripe payments</span>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {SECTIONS.map(([title, body]) => (
              <section key={title} className="rounded-2xl border border-border bg-surface p-6 shadow-sm shadow-stone-900/5">
                <h2 className="text-xl font-semibold">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
              </section>
            ))}
          </div>
        </section>

        <section className="mt-6 flex flex-col gap-4 rounded-2xl bg-slate-950 p-6 text-white shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <Mail className="mt-1 h-5 w-5 text-cyan-300" />
            <div>
              <h2 className="text-2xl font-semibold">Privacy questions</h2>
              <p className="mt-1 text-sm text-slate-300">Include workspace context and account email. Do not include API keys or card data.</p>
            </div>
          </div>
          <Link href="/contact" className="inline-flex items-center justify-center gap-2 rounded-full bg-cyan-300 px-5 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-200">
            Contact support
            <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      </div>
    </div>
  );
}
