import Link from "next/link";
import { ArrowRight, FileText, Scale, ShieldCheck } from "lucide-react";

const TERMS: [string, string][] = [
  [
    "Service use",
    "SOWLedger provides workspace tools for planning, timers, completed work logs, analytics, invoices, exports, and API integrations. You are responsible for the accuracy of data entered into your workspace.",
  ],
  [
    "Accounts and access",
    "Use a valid email and keep workspace access limited to authorized users. Owners and managers control higher-risk actions such as billing, approvals, exports, API keys, webhooks, and third-party integration connections.",
  ],
  [
    "Customer data",
    "You retain ownership of and responsibility for all data in your workspace. SOWLedger processes your data solely to operate the service. Do not upload secrets or regulated data unless your agreement and configuration explicitly allow it.",
  ],
  [
    "Third-party integrations",
    "SOWLedger offers optional integrations with Google Calendar, Slack, and QuickBooks. When you connect an integration, you authorize SOWLedger to access your account on that service within the scopes you grant. You can disconnect any integration at any time, which revokes SOWLedger's access. SOWLedger is not responsible for third-party service availability, terms, or data practices.",
  ],
  [
    "Google Calendar",
    "SOWLedger's use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements. Calendar data is used exclusively to sync scheduled work blocks and import busy events. SOWLedger does not use Google data for advertising, does not share it with third parties, and does not allow humans to read it except to provide support you request.",
  ],
  [
    "Availability",
    "We aim to keep the service available, but access may include maintenance windows, product changes, and usage limits. We are not liable for downtime or data loss beyond commercially reasonable efforts to maintain backups and redundancy.",
  ],
  [
    "Acceptable use",
    "Do not abuse public APIs, bypass rate limits, attempt workspace isolation failures, reverse-engineer the service, or use SOWLedger to process unlawful, harmful, or unauthorized data.",
  ],
  [
    "Intellectual property",
    "SOWLedger retains all rights to the service, software, and documentation. You retain all rights to data you input. Neither party acquires rights to the other's intellectual property except as needed to operate under these terms.",
  ],
  [
    "Termination",
    "Either party may terminate at any time. You can delete your workspace from settings. Upon termination, we will delete your data within 30 days, subject to legal and billing obligations. Pre-paid subscription fees are non-refundable after the current billing period.",
  ],
  [
    "Limitation of liability",
    "To the maximum extent permitted by law, SOWLedger's total liability is limited to fees paid in the 12 months preceding the claim. SOWLedger is not liable for indirect, incidental, special, consequential, or punitive damages.",
  ],
  [
    "Changes",
    "Product functionality, limits, pricing, and these terms may change. Material changes to paid plans will be communicated via email to workspace owners at least 30 days before they take effect. Continued use after notice constitutes acceptance.",
  ],
];

export const metadata = {
  title: "Terms of Service - SOWLedger",
  description:
    "SOWLedger terms of service covering service use, account access, customer data, third-party integrations including Google Calendar and QuickBooks, availability, acceptable use, and product changes.",
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
            <p className="rounded-full border border-border bg-background px-4 py-1.5 text-sm font-bold text-slate-700">
              Last updated August 15, 2026
            </p>
          </div>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-6xl">
            Terms of service
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-700">
            These terms describe how customers may use SOWLedger for planning,
            time tracking, billing evidence, exports, and integrations. They
            cover your rights, our responsibilities, and how we handle
            third-party services like Google Calendar and QuickBooks.
          </p>
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm shadow-stone-900/5">
            <FileText className="h-6 w-6 text-cyan-700" />
            <h2 className="mt-4 text-2xl font-semibold">Summary</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Use SOWLedger for authorized workspace operations. You own your
              data. Third-party integrations are optional and revocable.
              SOWLedger adheres to the Google API Services User Data Policy. Keep
              secrets out of routine support flows.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {TERMS.map(([title, body]) => (
              <section
                key={title}
                className="rounded-2xl border border-border bg-surface p-6 shadow-sm shadow-stone-900/5"
              >
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
              <h2 className="text-2xl font-semibold">
                Questions about these terms?
              </h2>
              <p className="mt-1 text-sm text-slate-300">
                Contact support with the workspace name, account email, and the
                section you want reviewed.
              </p>
            </div>
          </div>
          <Link
            href="/contact"
            className="inline-flex items-center justify-center gap-2 rounded-full bg-cyan-300 px-5 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-200"
          >
            Contact support
            <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      </div>
    </div>
  );
}
