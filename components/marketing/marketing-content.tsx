"use client";

import { ArrowRight, BarChart3, Check, Code2, FileCheck2, KeyRound, LockKeyhole, Workflow } from "lucide-react";
import Link from "next/link";
import { RoiCalculator } from "@/components/marketing/roi-calculator";
import type { MarketingPlan } from "@/lib/content/marketing-plans";

const INVOICE_DETAILS = [
  { label: "The work", value: "Project, time entries, and descriptions of what was done" },
  { label: "The amount", value: "Logged hours, billing rates, and the invoice total" },
  { label: "The review", value: "Entry status and the history of changes and approvals" },
  { label: "The handoff", value: "Invoice details and CSV or JSON exports for your records" },
];

const INTEGRATIONS = [
  { label: "Calendar", value: "Plan around your availability with Google Calendar sync." },
  { label: "Notifications", value: "Send work updates to Slack when connected." },
  { label: "Accounting", value: "Send invoices to QuickBooks when connected." },
  { label: "Custom tools", value: "Read and update work records through the API, or receive webhook events." },
];

export function MarketingContent({ plans }: { plans: MarketingPlan[] }) {
  return (
    <>
      <section id="proof-packs" className="scroll-mt-20 px-4 py-20 sm:px-6 sm:py-24">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Invoicing</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight sm:text-6xl">Show the work behind the total.</h2>
            <p className="mt-5 text-lg leading-8 text-slate-600">Create invoices from approved billable time. Keep the hours, rates, and work descriptions close at hand when a client has a question.</p>
            <Link href="/login" className="mt-7 inline-flex items-center gap-2 text-sm font-bold text-cyan-800 transition hover:text-cyan-600">Start with your first project <ArrowRight className="h-4 w-4" /></Link>
          </div>
          <dl className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
            {INVOICE_DETAILS.map((row) => (
              <div key={row.label} className="grid gap-2 border-b border-border p-6 last:border-b-0 sm:grid-cols-[9rem_1fr]"><dt className="font-semibold text-slate-950">{row.label}</dt><dd className="text-sm leading-6 text-slate-600">{row.value}</dd></div>
            ))}
          </dl>
        </div>
      </section>

      <section id="recovery" className="scroll-mt-20 border-y border-border bg-surface px-4 py-20 sm:px-6 sm:py-24">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div className="rounded-2xl border border-border bg-background p-6 shadow-sm sm:p-8">
            <BarChart3 className="h-7 w-7 text-cyan-700" aria-hidden="true" />
            <h3 className="mt-5 text-2xl font-semibold">A useful check before billing</h3>
            <ul className="mt-6 divide-y divide-border">
              {[
                "Did the work take more or less time than you planned?",
                "Are there completed tasks you still need to log?",
                "Does each billable entry have the right rate?",
                "Is approved time still waiting to be invoiced?",
              ].map((question) => <li key={question} className="flex gap-3 py-4 text-sm leading-6 text-slate-700"><Check className="mt-1 h-4 w-4 shrink-0 text-cyan-700" aria-hidden="true" />{question}</li>)}
            </ul>
          </div>
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Analytics</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight sm:text-6xl">See where your time went.</h2>
            <p className="mt-5 text-lg leading-8 text-slate-600">Compare planned and actual hours, review billable time, and check work that still needs attention. Use the project and date filters to focus on the period you are billing.</p>
            <p className="mt-5 text-base leading-7 text-slate-600">A scheduled block is a plan, not a bill. Review any gap before adding time or changing an invoice.</p>
          </div>
        </div>
      </section>

      <section className="bg-white px-4 py-20 sm:px-6 sm:py-24"><div className="mx-auto max-w-5xl"><RoiCalculator /></div></section>

      <section id="signoff" className="scroll-mt-20 px-4 py-20 sm:px-6 sm:py-24">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Client review</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight sm:text-6xl">Give clients a clear place to review.</h2>
            <p className="mt-5 text-lg leading-8 text-slate-600">Clients can review their issued invoices and the entries behind them, then record approval. They do not need access to your team&apos;s calendar, running timers, or workspace settings.</p>
          </div>
          <ol className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
            {[
              { title: "Prepare the invoice", detail: "Approve billable time and create a draft. Check the hours, rates, and descriptions." },
              { title: "Make it available for review", detail: "Mark the invoice as sent so it appears in the client portal. Share the portal link with your client separately." },
              { title: "Keep the approval on record", detail: "The client can approve the issued invoice. Refer back to the reviewed work when a question comes up." },
            ].map((step, index) => (
              <li key={step.title} className="flex gap-4 border-b border-border p-6 last:border-b-0"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-50 text-sm font-bold text-cyan-800">{index + 1}</span><div><h3 className="text-lg font-semibold">{step.title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{step.detail}</p></div></li>
            ))}
          </ol>
        </div>
      </section>

      <section id="integrations" className="scroll-mt-20 bg-slate-950 px-4 py-20 text-white sm:px-6 sm:py-24">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-300">Integrations</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight sm:text-6xl">Keep your other tools in the loop.</h2>
            <p className="mt-5 text-lg leading-8 text-slate-300">Export records for a spreadsheet, connect an available integration, or use the API for your own workflow. Choose what each API key can access and revoke it when it is no longer needed.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/support/api" className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-50">Read API docs <ArrowRight className="h-4 w-4" /></Link>
              <Link href="/support" className="inline-flex items-center justify-center gap-2 rounded-full border border-white/15 px-6 py-3 text-sm font-bold text-white transition hover:border-cyan-300 hover:text-cyan-100">Get setup help</Link>
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] shadow-xl shadow-black/10">
            <div className="flex items-center gap-3 border-b border-white/10 p-5"><Code2 className="h-6 w-6 text-cyan-200" aria-hidden="true" /><h3 className="font-semibold">Ways to connect</h3></div>
            <dl className="divide-y divide-white/10">{INTEGRATIONS.map((row) => <div key={row.label} className="grid gap-2 p-5 sm:grid-cols-[8rem_1fr]"><dt className="text-sm font-semibold text-cyan-200">{row.label}</dt><dd className="text-sm leading-6 text-slate-300">{row.value}</dd></div>)}</dl>
            <p className="border-t border-white/10 p-5 text-xs leading-5 text-slate-400">Provider setup and an authorized workspace connection are required. Check Integrations in your workspace for availability.</p>
            <div className="grid border-t border-white/10 sm:grid-cols-3">
              {[{ icon: KeyRound, label: "Choose permissions" }, { icon: LockKeyhole, label: "Revoke access" }, { icon: FileCheck2, label: "Review key usage" }].map((item) => {
                const Icon = item.icon;
                return <div key={item.label} className="border-b border-white/10 p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"><Icon className="h-5 w-5 text-cyan-200" aria-hidden="true" /><p className="mt-3 text-sm font-semibold">{item.label}</p></div>;
              })}
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" className="scroll-mt-20 border-y border-border bg-surface px-4 py-20 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-7xl">
          <div className="mb-10 max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Pricing</p>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight sm:text-6xl">One monthly price for your workspace.</h2>
            <p className="mt-4 max-w-2xl text-lg text-slate-600">Every plan includes planning, timers, manual entries, analytics, exports, API keys, and time review. Upgrade for invoicing, webhooks, or more people and projects.</p>
          </div>
          <div className="overflow-hidden rounded-2xl border border-border bg-border">
            {plans.map((plan) => (
              <div key={plan.planId} data-testid="pricing-plan" className={`grid gap-5 border-b border-border p-5 last:border-b-0 lg:grid-cols-[13rem_1fr_11rem_9rem] lg:items-center ${plan.recommended ? "bg-cyan-50/70" : "bg-surface"}`}>
                <div><h3 className="text-2xl font-semibold">{plan.name}</h3>{plan.recommended && <p className="mt-2 text-sm font-medium text-cyan-800">For small teams</p>}</div>
                <div><p className="text-sm leading-6 text-slate-600">{plan.description}</p><ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-600">{plan.features.map((feature) => <li key={feature} className="flex items-center gap-2"><Check className="h-4 w-4 text-cyan-700" aria-hidden="true" />{feature}</li>)}</ul></div>
                <div><span className="text-4xl font-semibold tracking-tight">${plan.price}</span><span className="text-sm font-semibold text-slate-600"> / month</span><p className="mt-1 text-xs text-slate-600">Per workspace · {plan.limits.members} {plan.limits.members === 1 ? "person" : "people"} · {plan.limits.projects} projects</p></div>
                <Link href="/login" className="inline-flex items-center justify-center rounded-full bg-slate-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-slate-800">Start free</Link>
              </div>
            ))}
          </div>
          <p className="mt-5 text-sm leading-6 text-slate-600">Create a free workspace, then choose a paid plan in Billing when you need it. Client access counts toward your workspace&apos;s member limit and uses the permissions you assign. Prices are in USD. <Link href="/billing-policy" className="font-semibold text-cyan-800 underline underline-offset-4">Read the billing policy</Link> for subscription and cancellation details.</p>
        </div>
      </section>

      <section className="px-4 py-20 sm:px-6 sm:py-24">
        <div className="mx-auto grid max-w-7xl gap-6 py-10 lg:grid-cols-[1fr_auto] lg:items-center">
          <div><p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-cyan-800"><Workflow className="h-4 w-4" />Get started</p><h2 className="mt-4 max-w-4xl text-3xl font-semibold tracking-tight sm:text-5xl">Start with the work you are doing today.</h2><p className="mt-3 max-w-2xl text-slate-600">Create a workspace, add a project, and log your first time entry. You can build the rest of your workflow from there.</p></div>
          <Link href="/login" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-cyan-700 px-6 py-4 text-sm font-bold text-white transition hover:bg-cyan-600">Start free <ArrowRight className="h-4 w-4" /></Link>
        </div>
      </section>
    </>
  );
}
