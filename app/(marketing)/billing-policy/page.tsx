import Link from "next/link";
import { ArrowRight, CreditCard, ReceiptText, ShieldCheck } from "lucide-react";

const POLICIES = [
  ["Flat workspace pricing", "Free, Starter, Studio, and Business are billed per workspace. The plan shown at checkout should match the workspace plan selected in Billabled."],
  ["Plan changes", "Workspace owners can manage subscriptions through Stripe Checkout and Customer Portal when billing is enabled for the workspace."],
  ["Refunds", "If billing or checkout behaves incorrectly, contact support with the workspace, Stripe receipt, and date so the issue can be reviewed."],
  ["Cancellations", "Cancel through the billing portal. Access usually remains through the paid period unless fraud, abuse, or legal risk requires earlier restriction."],
  ["Invoices and taxes", "Stripe handles payment receipts and tax-related checkout details when configured. Billabled product invoices are operational customer invoices created inside the app."],
  ["Checkout boundary", "Billabled checkout uses workspace plan selections. Do not send Stripe price IDs or payment data through support requests."],
];

export const metadata = {
  title: "Billing Policy - Billabled",
  description: "Billabled billing and refund policy for flat workspace pricing, plan changes, cancellations, receipts, taxes, and checkout boundaries.",
};

export default function BillingPolicyPage() {
  return (
    <div className="bg-background px-4 pb-20 pt-12 text-slate-950 sm:px-6 lg:pt-16">
      <div className="mx-auto max-w-6xl">
        <section className="rounded-2xl border border-border bg-surface p-6 shadow-xl shadow-stone-900/10 sm:p-8">
          <div className="flex flex-wrap items-center gap-3">
            <p className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-4 py-1.5 text-sm font-bold text-cyan-800">
              <CreditCard className="h-4 w-4" />
              Billing
            </p>
            <p className="rounded-full border border-border bg-background px-4 py-1.5 text-sm font-bold text-slate-700">Last updated May 4, 2026</p>
          </div>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-6xl">Billing and refund policy</h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-700">
            Billabled uses flat workspace plans for simple paid workspace access. Billing support should focus on the workspace, selected plan, Stripe receipt, and the date of the issue.
          </p>
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm shadow-stone-900/5">
            <ReceiptText className="h-6 w-6 text-cyan-700" />
            <h2 className="mt-4 text-2xl font-semibold">Summary</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Plans are workspace-based, payment receipts come from Stripe, and support can review incorrect charges when you provide safe billing context.
            </p>
            <div className="mt-5 grid gap-2 text-sm font-semibold text-slate-700">
              <div className="rounded-xl border border-border bg-background/60 p-3">Free: $0/month</div>
              <div className="rounded-xl border border-border bg-background/60 p-3">Starter: $9/month</div>
              <div className="rounded-xl border border-border bg-background/60 p-3">Studio: $29/month</div>
              <div className="rounded-xl border border-border bg-background/60 p-3">Business: $79/month</div>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {POLICIES.map(([title, body]) => (
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
              <h2 className="text-2xl font-semibold">Need billing help?</h2>
              <p className="mt-1 text-sm text-slate-300">Send the workspace, account email, Stripe receipt, and date. Do not send card numbers.</p>
            </div>
          </div>
          <Link href="/contact" className="inline-flex items-center justify-center gap-2 rounded-full bg-cyan-300 px-5 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-200">
            Ask about billing
            <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      </div>
    </div>
  );
}
