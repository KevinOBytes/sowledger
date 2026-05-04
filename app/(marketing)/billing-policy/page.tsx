import Link from "next/link";

export const metadata = { title: "Billing Policy - Billabled" };

const POLICIES = [
  ["Flat workspace pricing", "Free, Starter, Studio, and Business are billed per workspace for early launch simplicity. There is no per-seat surprise at checkout."],
  ["Plan changes", "Workspace owners can manage subscriptions through Stripe Checkout and Customer Portal when billing is enabled for the workspace."],
  ["Refunds", "If billing or checkout behaves incorrectly, contact support with the workspace, Stripe receipt, and date. Early customers should receive practical support before strict policy enforcement."],
  ["Cancellations", "Cancel through the billing portal. Access usually remains through the paid period unless fraud, abuse, or legal risk requires earlier restriction."],
  ["Invoices and taxes", "Stripe handles payment receipts and tax-related checkout details when configured. Billabled product invoices are operational customer invoices created inside the app."],
];

export default function BillingPolicyPage() {
  return (
    <main className="bg-[#f6f3ee] px-6 pb-20 pt-32 text-slate-950">
      <div className="mx-auto max-w-4xl">
        <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Billing</p>
        <h1 className="mt-4 text-5xl font-semibold tracking-tight sm:text-7xl">Billing and refund policy</h1>
        <p className="mt-5 text-lg leading-8 text-slate-600">Last updated May 4, 2026. Keep this customer-friendly during controlled beta and tighten language before scaled paid acquisition.</p>
        <div className="mt-10 space-y-4">
          {POLICIES.map(([title, body]) => (
            <section key={title} className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-semibold">{title}</h2>
              <p className="mt-2 leading-7 text-slate-600">{body}</p>
            </section>
          ))}
        </div>
        <Link href="/contact" className="mt-8 inline-flex rounded-full bg-slate-950 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800">Ask about billing</Link>
      </div>
    </main>
  );
}
