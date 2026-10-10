import { ArrowRight, Layers3 } from "lucide-react";
import Link from "next/link";
import { industries } from "@/lib/content/industries";
import { publicPageMetadata } from "@/lib/marketing-metadata";

export const metadata = publicPageMetadata(
  "/for",
  "Built for service teams | SOWLedger",
  "See how freelancers, agencies, and service teams use SOWLedger to plan work, track time, and prepare clear invoices.",
);

export default function BuiltForPage() {
  return (
    <div className="bg-background text-slate-950">
      <section className="relative overflow-hidden border-b border-border px-4 py-16 sm:px-6 sm:py-24">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(15,159,154,0.08)_1px,transparent_1px),linear-gradient(180deg,rgba(22,60,54,0.06)_1px,transparent_1px)] bg-[length:88px_88px]" />
        <div className="relative mx-auto max-w-5xl">
          <p className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-surface/90 px-4 py-1.5 text-sm font-bold text-cyan-800 shadow-sm"><Layers3 className="h-4 w-4" /> Built for service teams</p>
          <h1 className="mt-6 max-w-4xl text-5xl font-semibold tracking-tight sm:text-6xl">For people who do client work.</h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-700 sm:text-xl">The work looks different from one team to the next. The need is often the same: know where the time went and prepare a bill the client can follow.</p>
          <Link href="/login" className="mt-8 inline-flex items-center gap-2 rounded-full bg-slate-950 px-6 py-3.5 font-bold text-white transition hover:bg-slate-800">Start free <ArrowRight className="h-4 w-4" /></Link>
        </div>
      </section>
      <section className="px-4 py-16 sm:px-6 sm:py-20" aria-labelledby="audiences-heading">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-2xl"><p className="text-sm font-bold uppercase tracking-[0.24em] text-cyan-700">Built for</p><h2 id="audiences-heading" className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Find the work that looks like yours.</h2></div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {industries.map((industry) => (
              <Link key={industry.slug} href={`/for/${industry.slug}`} className="group rounded-2xl border border-border bg-surface p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-cyan-300 hover:shadow-md">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-700">{industry.category}</p>
                <h3 className="mt-3 text-xl font-semibold text-slate-950">{industry.name}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{industry.heroHeadline}</p>
                <span className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-slate-800 group-hover:text-cyan-800">See how it fits <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
