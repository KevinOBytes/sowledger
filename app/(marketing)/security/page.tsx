import Link from "next/link";
import { publicPageMetadata } from "@/lib/marketing-metadata";
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
    title: "Workspace access",
    body: "Workspace membership and role determine which records and actions a person can access. API keys belong to one workspace and have their own permissions.",
    icon: Database,
  },
  {
    title: "API keys",
    body: "Full keys are shown only when created or rotated. SOWLedger stores a hash, supports expiry and revocation, and records recent key usage.",
    icon: KeyRound,
  },
  {
    title: "Subscription billing",
    body: "Workspace owners manage subscriptions through Stripe checkout and the billing portal. Public API keys cannot change a workspace subscription.",
    icon: CreditCard,
  },
  {
    title: "Export checksums",
    body: "CSV and JSON downloads include a SHA-256 checksum so you can check whether a file has changed. Review exports before sharing them; they contain workspace data.",
    icon: FileCheck2,
  },
  {
    title: "Request authentication",
    body: "API v1 requests require a valid key and the required permissions. Stripe webhook requests are checked against their signature before processing.",
    icon: Route,
  },
  {
    title: "Connected services",
    body: "Stored integration credentials are encrypted. Owners and managers control the workspace's provider connections; raw provider tokens are not shown in the app.",
    icon: LockKeyhole,
  },
];

export const metadata = publicPageMetadata(
  "/security",
  "Security - SOWLedger",
  "How SOWLedger handles workspace access, API keys, connected services, and exports, and how to report a security concern.",
);

export default function SecurityPage() {
  return (
    <div className="bg-background text-slate-950">
      <section className="border-b border-border px-4 pb-12 pt-12 sm:px-6 lg:pt-16">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-end">
          <div className="max-w-3xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-surface px-4 py-1.5 text-sm font-bold text-cyan-800 shadow-sm">
              <ShieldCheck className="h-4 w-4" />
              Security
            </p>
            <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-6xl">How access and data are handled.</h1>
            <p className="mt-5 text-lg leading-8 text-slate-700">
              Your workspace holds project, time, and invoice records. Here is how SOWLedger handles access to those records and connections to other services. These controls are not a claim of formal security certification.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-6 shadow-xl shadow-stone-900/10">
            <h2 className="text-2xl font-semibold">Report a security concern</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Tell us what you found, where it happened, and how to reproduce it safely. Remove passwords, API keys, tokens, payment details, and private customer data from your report.
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
            <h2 className="mt-4 text-3xl font-semibold">Keep sensitive actions in the app</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Manage subscriptions, invitations, and workspace settings while signed in with the required role. These actions are not available through public API keys.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm shadow-stone-900/5">
            <h2 className="text-2xl font-semibold">How to send a useful report</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {[
                "Workspace name or identifier",
                "Affected route or endpoint",
                "Approximate timestamp and timezone",
                "Steps to reproduce without exposing private data",
                "Observed response code or error text",
                "No secrets, tokens, or card data",
              ].map((item) => (
                <div key={item} className="rounded-xl border border-border bg-background/60 p-4 text-sm font-semibold text-slate-700">
                  {item}
                </div>
              ))}
            </div>
            <Link href="/support/api" className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-cyan-800 transition hover:text-cyan-600">
              Read API documentation
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
