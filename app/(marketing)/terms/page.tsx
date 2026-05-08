import Link from "next/link";
import { ArrowRight, FileText, Scale, ShieldCheck } from "lucide-react";

const TERMS = [
  ["Service use", "Billabled provides workspace tools for planning, timers, completed work logs, analytics, invoices, exports, and API integrations. You are responsible for the accuracy of data entered into your workspace."],
  ["Accounts and access", "Use a valid email and keep workspace access limited to authorized users. Owners and managers control higher-risk actions such as billing, approvals, exports, API keys, and webhooks."],
  ["Customer data", "You retain responsibility for customer data in your workspace. Do not upload secrets or regulated data unless your agreement and configuration explicitly allow it."],
  ["Availability", "We aim to keep the service available, but access may include maintenance windows, product changes, and usage limits."],
  ["Acceptable use", "Do not abuse public APIs, bypass rate limits, attempt workspace isolation failures, or use Billabled to process unlawful, harmful, or unauthorized data."],
  ["Changes", "Product functionality, limits, pricing, and these terms may change. Material paid-plan changes should be communicated before they affect active customers."],
];

export const metadata = {
  title: "Terms - Billabled",
  description: "Billabled terms covering service use, account access, customer data, availability, acceptable use, and product changes.",
};

export default function TermsPage() {
  return (
    <div className="bg-background px-4 pb-20 pt-12 text-slate-950 sm:px-6 lg:pt-16">
      <div className="mx-auto max-w-6xl">
        <section className="rounded-2xl border border-border bg-surface p-6 shadow-xl shadow-stone-900/10 sm:p-8">
          <div className="flex flex-wrap items-center gap-3">
            <p className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-4 py-1.5 text-sm font-bold text-cyan-800">
              <Scale className="h-4 w-4" />
              Legal
            </p>
            <p className="rounded-full border border-border bg-background px-4 py-1.5 text-sm font-bold text-slate-700">Last updated May 4, 2026</p>
          </div>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-6xl">Terms of service</h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-700">
            These terms describe how customers may use Billabled for planning, time tracking, billing evidence, exports, and integrations. They do not expand public API access beyond documented scopes.
          </p>
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm shadow-stone-900/5">
            <FileText className="h-6 w-6 text-cyan-700" />
            <h2 className="mt-4 text-2xl font-semibold">Summary</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Use Billabled for authorized workspace operations, keep access limited to the right people, and keep secrets or unsupported regulated data out of routine product and support flows.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {TERMS.map(([title, body]) => (
              <section key={title} className="rounded-2xl border border-border bg-surface p-6 shadow-sm shadow-stone-900/5">
                <h2 className="text-xl font-semibold">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
              </section>
            ))}
          </div>
        </section>

        <section className="mt-6 flex flex-col gap-4 rounded-2xl bg-slate-950 p-6 text-white shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-1 h-5 w-5 text-cyan-300" />
            <div>
              <h2 className="text-2xl font-semibold">Questions about these terms?</h2>
              <p className="mt-1 text-sm text-slate-300">Contact support with the workspace name, account email, and the section you want reviewed.</p>
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
