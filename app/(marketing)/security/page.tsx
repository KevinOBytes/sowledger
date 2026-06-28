import Link from "next/link";
import {
  ArrowRight,
  CreditCard,
  Database,
  FileCheck2,
  KeyRound,
  LockKeyhole,
  Route,
  ShieldCheck,
  Siren,
} from "lucide-react";

const TRUST_CONTROLS = [
  {
    title: "Workspace isolation",
    body: "Workspace data access is treated as scoped by workspaceId unless a proven global resource is being accessed.",
    icon: Database,
  },
  {
    title: "API key lifecycle",
    body: "Keys are scoped, revocable, expirable, usage-tracked, shown once, and stored as hashes rather than full secret values.",
    icon: KeyRound,
  },
  {
    title: "Billing boundary",
    body: "Stripe checkout accepts Billabled workspace plans only. The API does not expose billing changes or subscription management.",
    icon: CreditCard,
  },
  {
    title: "Export integrity",
    body: "Exports avoid secrets and include x-billabled-export-sha256 integrity headers where supported.",
    icon: FileCheck2,
  },
  {
    title: "Public-route checks",
    body: "API and Stripe webhook routes are internet-facing by design, with authentication or signature checks on every protected request.",
    icon: Route,
  },
  {
    title: "Migration safety",
    body: "Database changes are handled through a reviewed migration workflow instead of one-off production edits.",
    icon: LockKeyhole,
  },
];

export const metadata = {
  title: "Security - Billabled",
  description: "Billabled trust center for workspace isolation, API key lifecycle, billing boundaries, export integrity, public-route checks, and security reporting.",
};

export default function SecurityPage() {
  return (
    <div className="bg-background text-slate-950">
      <section className="border-b border-border px-4 pb-12 pt-12 sm:px-6 lg:pt-16">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-end">
          <div className="max-w-3xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-surface px-4 py-1.5 text-sm font-bold text-cyan-800 shadow-sm">
              <ShieldCheck className="h-4 w-4" />
              Trust center
            </p>
            <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-6xl">Security posture for proof-backed billing.</h1>
            <p className="mt-5 text-lg leading-8 text-slate-700">
              Billabled handles operational time, billing evidence, exports, and API access. This page states practical controls without implying formal certifications or compliance programs.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-6 shadow-xl shadow-stone-900/10">
            <h2 className="text-2xl font-semibold">Report a security concern</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Send the affected workspace, endpoint, timestamp, expected behavior, observed behavior, and safe reproduction details. Do not include passwords, API keys, bearer tokens, or payment data.
            </p>
            <Link href="/contact" className="mt-5 inline-flex items-center justify-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-slate-800">
              Contact security
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <section className="px-4 py-12 sm:px-6">
        <div className="mx-auto grid max-w-7xl gap-4 md:grid-cols-2 xl:grid-cols-3">
          {TRUST_CONTROLS.map((control) => {
            const Icon = control.icon;
            return (
              <section key={control.title} className="rounded-2xl border border-border bg-surface p-6 shadow-sm shadow-stone-900/5">
                <Icon className="h-6 w-6 text-cyan-700" />
                <h2 className="mt-4 text-xl font-semibold">{control.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{control.body}</p>
              </section>
            );
          })}
        </div>
      </section>

      <section className="px-4 pb-20 pt-4 sm:px-6">
        <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[0.75fr_1.25fr]">
          <div className="rounded-2xl bg-slate-950 p-7 text-white shadow-sm">
            <Siren className="h-6 w-6 text-cyan-300" />
            <h2 className="mt-4 text-3xl font-semibold">Boundaries that stay inside Billabled</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              The API is for scoped operational integrations. Billing changes, invites, subscription management, and workspace administration remain inside authenticated app workflows.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm shadow-stone-900/5">
            <h2 className="text-2xl font-semibold">How to send a useful report</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {[
                "Workspace name or identifier",
                "Affected route or endpoint",
                "Approximate timestamp and timezone",
                "Safe reproduction steps",
                "Observed response code or error text",
                "No secrets, tokens, or card data",
              ].map((item) => (
                <div key={item} className="rounded-xl border border-border bg-background/60 p-4 text-sm font-semibold text-slate-700">
                  {item}
                </div>
              ))}
            </div>
            <Link href="/support/api" className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-cyan-800 transition hover:text-cyan-600">
              Review API support details
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
