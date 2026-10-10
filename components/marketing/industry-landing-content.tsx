import { ArrowRight, ChevronRight, CircleHelp, FileCheck2, ListChecks, Workflow } from "lucide-react";
import Link from "next/link";
import { HeroSection } from "@/components/marketing/hero-section";
import { industries, type IndustryContent } from "@/lib/content/industries";

type IndustryLandingContentProps = { industry: IndustryContent };

export function IndustryLandingContent({ industry }: IndustryLandingContentProps) {
  const neighboringIndustries = industry.relatedSlugs.flatMap((slug) => {
    const related = industries.find((item) => item.slug === slug);
    return related ? [related] : [];
  });

  return (
    <div className="bg-background text-slate-950">
      <section className="relative overflow-hidden border-b border-border px-4 pb-12 pt-8 sm:px-6 lg:pt-10">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(15,159,154,0.08)_1px,transparent_1px),linear-gradient(180deg,rgba(22,60,54,0.06)_1px,transparent_1px)] bg-[length:88px_88px]" />
        <div className="relative mx-auto max-w-7xl">
          <nav aria-label="Breadcrumb" className="mb-8 text-sm font-medium text-slate-600">
            <Link href="/for" className="transition hover:text-cyan-800">Built for</Link>
            <ChevronRight className="mx-1 inline h-4 w-4" aria-hidden="true" />
            <span aria-current="page" className="text-slate-950">{industry.name}</span>
          </nav>
          <HeroSection
            label={industry.heroLabel}
            headline={industry.heroHeadline}
            subhead={industry.heroSubhead}
            primaryCtaLabel="Start free"
            example={industry.example}
          />
          <nav aria-label="On this page" className="mt-8 flex flex-wrap gap-2 border-t border-border pt-5 text-sm font-semibold text-slate-700">
            {[
              ["#common-work-heading", "Common challenges"],
              ["#workflow-heading", "Workflow"],
              ["#proof-packs", "Invoice details"],
              ["#faq-heading", "Questions"],
            ].map(([href, label]) => <a key={href} href={href} className="rounded-full border border-border bg-surface px-4 py-2 transition hover:border-cyan-300 hover:text-cyan-800">{label}</a>)}
          </nav>
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6 sm:py-20" aria-labelledby="common-work-heading">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-2xl">
            <p className="text-sm font-bold uppercase tracking-[0.24em] text-cyan-700">Day-to-day challenges</p>
            <h2 id="common-work-heading" className="mt-3 scroll-mt-24 text-3xl font-semibold tracking-tight sm:text-4xl">The time that is easy to miss</h2>
          </div>
          <ul className="mt-8 grid gap-4 md:grid-cols-3">
            {industry.challenges.map((challenge) => (
              <li key={challenge} className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
                <ListChecks className="h-6 w-6 text-cyan-700" aria-hidden="true" />
                <p className="mt-5 text-base leading-7 text-slate-700">{challenge}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-y border-border bg-surface px-4 py-16 sm:px-6 sm:py-20" aria-labelledby="workflow-heading">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.24em] text-cyan-700">{industry.workflowHeadline}</p>
            <h2 id="workflow-heading" className="mt-3 scroll-mt-24 text-3xl font-semibold tracking-tight sm:text-4xl">How SOWLedger fits your work</h2>
            <p className="mt-4 text-lg leading-8 text-slate-600">{industry.workflowSubhead}</p>
          </div>
          <ol className="mt-10 grid overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {industry.workflow.map((step, workflowIndex) => (
              <li key={step.stage} className="bg-surface p-6">
                <div className="flex items-center justify-between"><span className="font-mono text-sm font-bold text-cyan-800">{String(workflowIndex + 1).padStart(2, "0")}</span><Workflow className="h-5 w-5 text-slate-300" aria-hidden="true" /></div>
                <h3 className="mt-8 text-xl font-semibold">{step.stage}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{step.detail}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="proof-packs" className="scroll-mt-20 px-4 py-16 sm:px-6 sm:py-20" aria-labelledby="proof-heading">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.24em] text-cyan-700">Time and invoice details</p>
            <h2 id="proof-heading" className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">A record you can refer back to</h2>
            <p className="mt-4 text-lg leading-8 text-slate-600">Keep the hours and work descriptions together for billing, client questions, and your own records.</p>
          </div>
          <ul className="overflow-hidden rounded-2xl border border-border bg-border">
            {industry.proofOutputs.map((output) => (
              <li key={output} className="flex gap-4 bg-surface p-5"><FileCheck2 className="mt-0.5 h-5 w-5 shrink-0 text-cyan-700" aria-hidden="true" /><span className="leading-6 text-slate-700">{output}</span></li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-y border-border bg-surface-muted px-4 py-16 sm:px-6 sm:py-20" aria-labelledby="faq-heading">
        <div className="mx-auto max-w-4xl">
          <p className="text-sm font-bold uppercase tracking-[0.24em] text-cyan-800">Answers for your workflow</p>
          <h2 id="faq-heading" className="mt-3 scroll-mt-24 text-3xl font-semibold tracking-tight sm:text-4xl">Frequently asked questions</h2>
          <div className="mt-8 space-y-3">
            {industry.faqs.map((faq) => (
              <details key={faq.question} className="rounded-xl border border-border bg-surface px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-slate-950">{faq.question}<CircleHelp className="h-5 w-5 shrink-0 text-cyan-700" aria-hidden="true" /></summary>
                <p className="mt-3 max-w-3xl leading-7 text-slate-600">{faq.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6 sm:py-20" aria-labelledby="next-audience-heading">
        <div className="mx-auto max-w-7xl">
          <h2 id="next-audience-heading" className="text-2xl font-semibold tracking-tight">Explore related teams</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {neighboringIndustries.map((neighbor) => (
              <Link key={neighbor.slug} href={`/for/${neighbor.slug}`} className="rounded-xl border border-border bg-surface p-5 transition hover:border-cyan-300"><p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-700">{neighbor.category}</p><p className="mt-2 font-semibold text-slate-950">{neighbor.name}</p><span className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-slate-700">Explore <ArrowRight className="h-4 w-4" /></span></Link>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-slate-950 px-4 py-16 text-white sm:px-6 sm:py-20">
        <div className="mx-auto max-w-4xl text-center"><p className="text-sm font-bold uppercase tracking-[0.24em] text-cyan-300">Ready for a clearer work record?</p><h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Make the work easier to review, approve, and bill.</h2><Link href="/login" className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3.5 font-bold text-slate-950 transition hover:bg-cyan-50">Start free <ArrowRight className="h-4 w-4" /></Link></div>
      </section>
    </div>
  );
}
