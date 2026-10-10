import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  BookOpen,
  CalendarClock,
  Code2,
  CreditCard,
  FileCheck2,
  FileDown,
  LifeBuoy,
  LockKeyhole,
  TimerReset,
  Workflow,
} from "lucide-react";

const WORKFLOW = [
  "Plan work",
  "Track your time",
  "Add completed work",
  "Review your hours",
  "Approve and invoice",
  "Export or connect tools",
];

const SUPPORT_TILES = [
  {
    title: "Invoices",
    description: "Create an invoice from approved time and review the hours, rates, and entries behind the total.",
    href: "#proof-packs",
    icon: FileCheck2,
  },
  {
    title: "Analytics and time review",
    description: "Compare planned and logged hours, check missing rates, and find approved time that has not been invoiced.",
    href: "#recovery-radar",
    icon: BarChart3,
  },
  {
    title: "Client review",
    description: "Let clients review their issued invoices and work details, then record approval in the client portal.",
    href: "#sign-off",
    icon: BadgeCheck,
  },
  {
    title: "API",
    description: "Create an API key, choose its permissions, and connect work records to your own tools.",
    href: "/support/api",
    icon: Code2,
  },
  {
    title: "Billing",
    description: "Find your workspace plan, subscription settings, and cancellation information.",
    href: "#billing",
    icon: CreditCard,
  },
  {
    title: "Security",
    description: "Learn how access and API keys work, or report a security concern.",
    href: "/security",
    icon: LockKeyhole,
  },
];

const HOW_TO = [
  {
    id: "planning",
    title: "Plan work",
    icon: CalendarClock,
    body: "Open Calendar to set aside time for a project. When the work starts, start a timer from the block. When it is done, you can log the completed time. Move or cancel blocks when your plans change.",
  },
  {
    id: "tracking",
    title: "Track and log work",
    icon: TimerReset,
    body: "Start a timer on the Dashboard and stop it when you finish. Use Log time to add work you have already done. In Activity, check the project, description, and duration before submitting entries for approval.",
  },
  {
    id: "exports",
    title: "Export workspace data",
    icon: FileDown,
    body: "Owners and managers can open Exports for a full JSON workspace export or a filtered time-entry CSV. Filter time by project, person, date, status, or source. Review downloaded files before sharing: JSON exports can contain other workspace records as well as filtered time entries.",
  },
];

export const metadata = {
  title: "Support - SOWLedger",
  description: "Get help with SOWLedger timers, calendar planning, time entries, invoices, client review, exports, and account billing.",
};

export default function SupportPage() {
  return (
    <div className="bg-background text-slate-950">
      <section className="border-b border-border px-4 pb-12 pt-12 sm:px-6 lg:pt-16">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-end">
          <div className="max-w-3xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-surface px-4 py-1.5 text-sm font-bold text-cyan-800 shadow-sm">
              <LifeBuoy className="h-4 w-4" />
              Support
            </p>
            <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-6xl">
              How can we help?
            </h1>
            <p className="mt-5 text-lg leading-8 text-slate-700">
              Find the next step for planning work, logging time, reviewing entries, or preparing an invoice. If something is not working, contact us with the page and what happened.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link href="/contact" className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-950 px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800">
                Contact support
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/support/api" className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-surface px-6 py-3 text-sm font-bold text-slate-800 shadow-sm transition hover:border-cyan-300 hover:text-cyan-700">
                Read API docs
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-surface p-4 shadow-xl shadow-stone-900/10">
            <div className="flex items-center gap-2 border-b border-border pb-3 text-sm font-bold text-slate-700">
              <Workflow className="h-4 w-4 text-cyan-700" />
              Getting started
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {WORKFLOW.map((step, index) => (
                <div key={step} className="rounded-xl border border-border bg-background/60 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-800">Step {index + 1}</p>
                  <p className="mt-2 font-semibold text-slate-950">{step}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 py-12 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {SUPPORT_TILES.map((topic) => {
              const Icon = topic.icon;
              return (
                <Link key={topic.title} href={topic.href} className="group rounded-2xl border border-border bg-surface p-6 shadow-sm shadow-stone-900/5 transition hover:-translate-y-0.5 hover:border-cyan-300 hover:shadow-md">
                  <div className="flex items-start justify-between gap-4">
                    <div className="rounded-xl bg-cyan-50 p-3 text-cyan-700">
                      <Icon className="h-5 w-5" />
                    </div>
                    <ArrowRight className="h-5 w-5 text-stone-300 transition group-hover:translate-x-1 group-hover:text-cyan-700" />
                  </div>
                  <h2 className="mt-5 text-xl font-semibold">{topic.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{topic.description}</p>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <section className="px-4 py-6 sm:px-6">
        <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-3">
          {HOW_TO.map((item) => {
            const Icon = item.icon;
            return (
              <section key={item.id} id={item.id} className="rounded-2xl border border-border bg-surface p-6 shadow-sm shadow-stone-900/5">
                <Icon className="h-6 w-6 text-cyan-700" />
                <h2 className="mt-4 text-2xl font-semibold">{item.title}</h2>
                <p className="mt-3 text-sm leading-6 text-slate-600">{item.body}</p>
              </section>
            );
          })}
        </div>
      </section>

      <section className="px-4 py-12 sm:px-6">
        <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="rounded-2xl border border-border bg-slate-950 p-7 text-white shadow-sm">
            <BookOpen className="h-6 w-6 text-cyan-300" />
            <h2 className="mt-4 text-3xl font-semibold">Before you send the bill</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Check the work, confirm the rates, and approve the entries. Then create the invoice and let the client review its details.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {[
              ["proof-packs", "Create an invoice", "In Invoices, select approved billable entries to create a draft. Review its details, then mark it as sent to make it available in the client portal. This changes its status; it does not send an email. Share the portal link with the client separately."],
              ["recovery-radar", "Check your time", "In Analytics, compare planned and actual hours. Review any unlogged work, missing rates, or approved time waiting for an invoice. A calendar gap does not necessarily mean billable work occurred."],
              ["sign-off", "Ask for client review", "Clients can review issued invoices linked to their client account and record approval. Review the entry descriptions first, because work details may be visible to the client."],
              ["billing", "Manage your subscription", "Owners can manage the workspace subscription in Settings → Billing. Plans are priced per workspace, with different member and project limits. See Pricing and the billing policy for details."],
            ].map(([id, title, body]) => (
              <section key={id} id={id} className="rounded-2xl border border-border bg-surface p-6 shadow-sm shadow-stone-900/5">
                <h3 className="text-xl font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
              </section>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 pb-20 pt-8 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 rounded-2xl border border-border bg-surface p-6 shadow-sm shadow-stone-900/5 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold">Still need help?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Tell us which workspace and page you were using, what you expected, and what happened instead. Please leave out passwords, API keys, and private client information.
            </p>
          </div>
          <Link href="/contact" className="inline-flex items-center justify-center gap-2 rounded-full bg-cyan-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-cyan-500">
            Contact SOWLedger
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
