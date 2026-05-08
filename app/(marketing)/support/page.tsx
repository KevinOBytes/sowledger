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
  "Track live timers",
  "Log manual/calendar time",
  "Review analytics",
  "Approve/invoice/export",
  "Integrate by API",
];

const SUPPORT_TILES = [
  {
    title: "Proof Packs",
    description: "Understand the invoice evidence bundle: work basis, source mix, approvals, invoice state, and digest-backed exports.",
    href: "#proof-packs",
    icon: FileCheck2,
  },
  {
    title: "Recovery Radar",
    description: "Find planned work without completed time, approved unbilled work, stale drafts, and retainer pressure.",
    href: "#recovery-radar",
    icon: BarChart3,
  },
  {
    title: "Sign-Off",
    description: "Route corrected work into client-facing approval without exposing internal timers, API keys, or admin settings.",
    href: "#sign-off",
    icon: BadgeCheck,
  },
  {
    title: "API",
    description: "Use scoped keys for clients, projects, tags, tasks, schedule, time, analytics, invoices, proof packs, and exports.",
    href: "/support/api",
    icon: Code2,
  },
  {
    title: "Billing",
    description: "Compare flat workspace plans and understand subscription, cancellation, receipt, and refund handling.",
    href: "#billing",
    icon: CreditCard,
  },
  {
    title: "Security",
    description: "Review workspace boundaries, API key lifecycle, checkout boundaries, export integrity, and report guidance.",
    href: "/security",
    icon: LockKeyhole,
  },
];

const HOW_TO = [
  {
    id: "planning",
    title: "Plan work",
    icon: CalendarClock,
    body: "Use Dashboard for today's plan and Calendar for future scheduling. Planned blocks can be started as timers, logged as completed work, rescheduled, skipped, or reviewed later.",
  },
  {
    id: "tracking",
    title: "Track and log work",
    icon: TimerReset,
    body: "Run concurrent timers while keeping one focused timer visually primary. Add completed work from Dashboard, Activity, Calendar, or analytics empty states when work happened outside the timer.",
  },
  {
    id: "exports",
    title: "Export workspace data",
    icon: FileDown,
    body: "Workspace managers can export complete JSON backups or filtered CSV files by project, user, status, source, and date range. Export responses avoid secrets and include x-billabled-export-sha256 where supported.",
  },
];

export const metadata = {
  title: "Support - Billabled",
  description: "Support for Billabled proof-backed billing operations, from planning and timers through approvals, exports, billing, security, and API integrations.",
};

export default function SupportPage() {
  return (
    <div className="bg-background text-slate-950">
      <section className="border-b border-border px-4 pb-12 pt-12 sm:px-6 lg:pt-16">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-end">
          <div className="max-w-3xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-surface px-4 py-1.5 text-sm font-bold text-cyan-800 shadow-sm">
              <LifeBuoy className="h-4 w-4" />
              Proof-backed billing support
            </p>
            <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-6xl">
              Get help moving work into invoice proof.
            </h1>
            <p className="mt-5 text-lg leading-8 text-slate-700">
              Billabled support follows the operational workflow: plan the work, capture it, correct it, review the billing record, approve or export it, then integrate it by API.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link href="/support/api" className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-950 px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800">
                Open API guide
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/contact" className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-surface px-6 py-3 text-sm font-bold text-slate-800 shadow-sm transition hover:border-cyan-300 hover:text-cyan-700">
                Contact support
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-surface p-4 shadow-xl shadow-stone-900/10">
            <div className="flex items-center gap-2 border-b border-border pb-3 text-sm font-bold text-slate-700">
              <Workflow className="h-4 w-4 text-cyan-700" />
              Workflow map
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
            <h2 className="mt-4 text-3xl font-semibold">Support by billing outcome</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              These guides keep the product story connected to the invoice record instead of treating timers, exports, approvals, and APIs as separate tools.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {[
              ["proof-packs", "Proof Packs", "Use planned vs actual hours, source mix, invoice status, and export digest evidence to explain a bill."],
              ["recovery-radar", "Recovery Radar", "Review gaps before billing: scheduled work without time, approved unbilled entries, missing rates, and stale invoices."],
              ["sign-off", "Sign-Off", "Send client-facing proof packets for approval while keeping internal workspace controls private."],
              ["billing", "Billing", "Plans are flat per workspace: Free, Starter ($9/month), Studio ($29/month), and Business ($79/month)."],
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
            <h2 className="text-2xl font-semibold">Need a human review?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Send the workspace name, account email, relevant page or endpoint, timestamps, and safe reproduction details. Do not send secrets.
            </p>
          </div>
          <Link href="/contact" className="inline-flex items-center justify-center gap-2 rounded-full bg-cyan-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-cyan-500">
            Contact Billabled
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
