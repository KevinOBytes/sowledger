import { ArrowRight, FileText, Workflow } from "lucide-react";
import Link from "next/link";
import type { InvoiceExample } from "@/lib/content/industries";

const DEFAULT_EXAMPLE: InvoiceExample = {
  title: "Website refresh",
  work: ["Discovery call", "Website updates", "Review changes"],
};
const EXAMPLE_TIME = [{ time: "45m", amount: "$90" }, { time: "2h 30m", amount: "$300" }, { time: "1h", amount: "$120" }];

interface HeroSectionProps {
  label?: string;
  headline: string;
  subhead: string;
  primaryCtaLabel?: string;
  example?: InvoiceExample;
}

export function HeroSection({
  label = "Time tracking and invoicing for client work",
  headline,
  subhead,
  primaryCtaLabel = "Start free",
  example = DEFAULT_EXAMPLE,
}: HeroSectionProps) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:items-center lg:gap-10">
      <div className="@container min-w-0 max-w-3xl">
        <p className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-surface/90 px-4 py-1.5 text-sm font-bold text-cyan-800 shadow-sm">
          <Workflow className="h-4 w-4 shrink-0" aria-hidden="true" />
          {label}
        </p>
        {/* Scale with the text column, including when the desktop grid narrows it. */}
        <h1 className="mt-6 max-w-4xl text-[clamp(2rem,11cqw,4.5rem)] font-semibold leading-[1.1] tracking-tight text-slate-950">
          {headline}
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-700 sm:text-xl">
          {subhead}
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href="/login" className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-950 px-7 py-4 text-base font-bold text-white shadow-sm transition hover:bg-slate-800">
            {primaryCtaLabel}
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href="#proof-packs" className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-surface px-7 py-4 text-base font-bold text-slate-800 shadow-sm transition hover:border-cyan-300 hover:text-cyan-700">
            See how invoicing works
          </Link>
        </div>
      </div>

      <figure className="min-w-0 overflow-hidden rounded-2xl border border-border bg-surface shadow-xl shadow-stone-900/10">
        <div className="p-5 sm:p-8">
          <div className="flex items-center justify-between gap-4 border-b border-border pb-6">
            <div>
              <p className="text-sm font-semibold text-cyan-800">Example invoice</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950 [overflow-wrap:anywhere]">{example.title}</h2>
            </div>
            <FileText className="h-8 w-8 text-cyan-700" aria-hidden="true" />
          </div>
          <table className="mt-5 w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr><th className="pb-3 font-medium">Work</th><th className="pb-3 pr-4 text-right font-medium">Time</th><th className="pb-3 text-right font-medium">Amount</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {example.work.map((work, index) => (
                <tr key={work}>
                  <td className="py-4 pr-3 font-medium text-slate-800 [overflow-wrap:anywhere] sm:py-5">{work}</td>
                  <td className="whitespace-nowrap py-4 pr-4 text-right text-slate-600 sm:py-5">{EXAMPLE_TIME[index].time}</td>
                  <td className="py-4 text-right font-semibold text-slate-900 sm:py-5">{EXAMPLE_TIME[index].amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 flex items-end justify-between gap-4 rounded-xl bg-cyan-50 p-5">
            <div><p className="font-semibold text-slate-900">4h 15m of work</p><p className="mt-1 text-sm text-slate-600">Billed at $120 per hour</p></div>
            <p className="text-3xl font-semibold tracking-tight text-slate-950">$510</p>
          </div>
          <p className="mt-5 text-sm leading-6 text-slate-600">An invoice with the time and work details behind the total.</p>
        </div>
        <figcaption className="border-t border-border px-6 py-3 text-xs text-slate-500 sm:px-8">
          Illustrative example, not customer data or an app screenshot.
        </figcaption>
      </figure>
    </div>
  );
}
