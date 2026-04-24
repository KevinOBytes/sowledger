import Link from "next/link";
import { ArrowRight, BookOpen, CalendarClock, Code2, CreditCard, FileDown, LifeBuoy, TimerReset } from "lucide-react";

const TOPICS = [
  {
    title: "Plan and schedule work",
    description: "Create work blocks, reschedule planned time, and start timers from the calendar or dashboard.",
    href: "/support#planning",
    icon: CalendarClock,
  },
  {
    title: "Track live and manual time",
    description: "Run concurrent timers, focus one active timer, and add manual time blocks when work happened outside the timer.",
    href: "/support#tracking",
    icon: TimerReset,
  },
  {
    title: "Export workspace data",
    description: "Download complete JSON backups or filtered CSV exports by project, user, status, source, and date range.",
    href: "/support#exports",
    icon: FileDown,
  },
  {
    title: "Choose a billing plan",
    description: "Understand the flat workspace pricing ladder: Free, Starter, Studio, and Business.",
    href: "/support#billing",
    icon: CreditCard,
  },
  {
    title: "Use the public API",
    description: "Generate scoped API keys and call versioned endpoints for clients, projects, tags, tasks, schedule, time, analytics, invoices, and exports.",
    href: "/support/api",
    icon: Code2,
  },
];

export const metadata = { title: "Support - Billabled" };

export default function SupportPage() {
  return (
    <div className="bg-[#f6f3ee] text-slate-950">
      <section className="px-6 pb-16 pt-32">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Knowledge base</p>
            <h1 className="mt-4 text-5xl font-semibold tracking-tight sm:text-7xl">Get productive in Billabled.</h1>
            <p className="mt-5 text-lg text-slate-600">Support articles are organized around the core workflow: plan work, track timers, log manual time, review analytics, approve or export data, then integrate by API.</p>
          </div>
          <div className="mt-12 grid gap-5 md:grid-cols-2">
            {TOPICS.map((topic) => {
              const Icon = topic.icon;
              return (
                <Link key={topic.title} href={topic.href} className="group rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-cyan-200 hover:shadow-md">
                  <div className="flex items-start justify-between gap-4">
                    <div className="rounded-2xl bg-cyan-50 p-3 text-cyan-700"><Icon className="h-6 w-6" /></div>
                    <ArrowRight className="h-5 w-5 text-slate-300 transition group-hover:translate-x-1 group-hover:text-cyan-700" />
                  </div>
                  <h2 className="mt-5 text-2xl font-semibold">{topic.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{topic.description}</p>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <section id="planning" className="px-6 py-12">
        <div className="mx-auto max-w-5xl rounded-[36px] border border-slate-200 bg-white p-8 shadow-sm">
          <h2 className="text-3xl font-semibold">Planning workflow</h2>
          <p className="mt-3 text-slate-600">Use Dashboard for today&apos;s plan and Calendar for future blocks. Each scheduled block can be started as a timer, logged manually, rescheduled, skipped, or exported later for audit history.</p>
        </div>
      </section>

      <section id="tracking" className="px-6 py-12">
        <div className="mx-auto max-w-5xl rounded-[36px] border border-slate-200 bg-white p-8 shadow-sm">
          <h2 className="text-3xl font-semibold">Timer and manual time workflow</h2>
          <p className="mt-3 text-slate-600">Billabled supports concurrent timers while keeping one focused timer visually primary. Manual time is available from Dashboard, Activity, Calendar, and analytics empty states so offline work does not disappear.</p>
        </div>
      </section>

      <section id="exports" className="px-6 py-12">
        <div className="mx-auto max-w-5xl rounded-[36px] border border-slate-200 bg-white p-8 shadow-sm">
          <h2 className="text-3xl font-semibold">Exports</h2>
          <p className="mt-3 text-slate-600">Workspace managers can export complete data in JSON for backup or filtered CSV for spreadsheet workflows. Each export response includes <code className="rounded bg-slate-100 px-1.5 py-0.5">x-billabled-export-sha256</code> for integrity checks.</p>
        </div>
      </section>

      <section id="billing" className="px-6 py-12">
        <div className="mx-auto max-w-5xl rounded-[36px] border border-slate-200 bg-white p-8 shadow-sm">
          <h2 className="text-3xl font-semibold">Billing plans</h2>
          <p className="mt-3 text-slate-600">Billabled uses flat workspace pricing so a solo operator can start paying without seat math. Free is for evaluation, Starter is $9/month for invoices and exports, Studio is $29/month for small-team API/webhook workflows, and Business is $79/month for larger operations.</p>
          <Link href="/#pricing" className="mt-5 inline-flex rounded-full bg-cyan-600 px-5 py-3 text-sm font-bold text-white hover:bg-cyan-500">Compare pricing</Link>
        </div>
      </section>

      <section className="px-6 py-20">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 rounded-[36px] bg-slate-950 p-8 text-white shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-white/10 p-3"><LifeBuoy className="h-6 w-6 text-cyan-300" /></div>
            <div>
              <h2 className="text-2xl font-semibold">Need API details?</h2>
              <p className="mt-1 text-sm text-slate-300">The API usage guide covers authentication, scopes, examples, exports, and error handling.</p>
            </div>
          </div>
          <Link href="/support/api" className="inline-flex items-center justify-center gap-2 rounded-full bg-cyan-300 px-5 py-3 text-sm font-bold text-slate-950 hover:bg-cyan-200">
            <BookOpen className="h-4 w-4" />Open API guide
          </Link>
        </div>
      </section>
    </div>
  );
}
