import { ArrowRight, BarChart3, FileCheck2, ShieldCheck, TimerReset, Webhook } from "lucide-react";
import { HeroSection } from "@/components/marketing/hero-section";
import { WorkflowSection } from "@/components/marketing/workflow-section";
import { MarketingContent } from "@/components/marketing/marketing-content";
import { marketingPlans } from "@/lib/content/marketing-plans";
import { MARKETING_DESCRIPTION, MARKETING_TITLE, publicPageMetadata } from "@/lib/marketing-metadata";

export const metadata = publicPageMetadata("/", MARKETING_TITLE, MARKETING_DESCRIPTION);

const CAPABILITIES = [
  {
    title: "Invoices",
    shortTitle: "Invoices",
    description: "Keep the hours, rates, and work details behind each invoice together.",
    metric: "Bill",
    icon: FileCheck2,
    href: "#proof-packs",
  },
  {
    title: "Project analytics",
    shortTitle: "Analytics",
    description: "See how actual time compares with the work you planned.",
    metric: "Review",
    icon: BarChart3,
    href: "#recovery",
  },
  {
    title: "Client review",
    shortTitle: "Client review",
    description: "Give clients a place to review their project work and record approval.",
    metric: "Share",
    icon: ShieldCheck,
    href: "#signoff",
  },
  {
    title: "Time tracking",
    shortTitle: "Time tracking",
    description: "Use timers, manual entries, or completed calendar blocks to log your work.",
    metric: "Track",
    icon: TimerReset,
    href: "#workflow",
  },
  {
    title: "Integrations",
    shortTitle: "Integrations",
    description: "Connect your work records to other tools with exports, API access, and webhooks.",
    metric: "API",
    icon: Webhook,
    href: "#integrations",
  },
];

export default function MarketingPage() {
  return (
    <div className="bg-background text-slate-950">
      <section className="relative overflow-hidden border-b border-border px-4 pb-10 pt-10 sm:px-6 lg:pt-12">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(15,159,154,0.08)_1px,transparent_1px),linear-gradient(180deg,rgba(22,60,54,0.06)_1px,transparent_1px)] bg-[length:88px_88px]" />
        <div className="relative mx-auto grid min-w-0 max-w-7xl gap-8 lg:min-h-[calc(100vh-64px)] lg:grid-rows-[1fr_auto]">
          
          <HeroSection 
            headline="Your work, your time, your invoices. Together."
            subhead="Plan the day, track what you do, and turn approved time into invoices your clients can understand. One place for the work and the details behind the bill."
          />

          <nav
            className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border shadow-sm md:grid-cols-5"
            aria-label="SOWLedger capability navigation"
          >
            {CAPABILITIES.map((capability) => {
              const Icon = capability.icon;
              return (
                <a key={capability.title} href={capability.href} className="group flex min-w-0 items-center gap-2 bg-surface p-3 transition hover:bg-white md:block md:min-h-36 md:p-4">
                  <div className="flex items-center justify-between gap-3">
                    <Icon className="h-5 w-5 shrink-0 text-cyan-700" aria-hidden="true" />
                    <span className="hidden font-mono text-xs font-bold text-slate-500 md:inline">{capability.metric}</span>
                  </div>
                  <p className="text-sm font-bold text-slate-950 md:mt-5">{capability.shortTitle}</p>
                  <p className="mt-2 hidden text-xs leading-5 text-slate-600 md:block">{capability.description}</p>
                  <ArrowRight className="mt-4 hidden h-4 w-4 text-slate-300 transition group-hover:translate-x-1 group-hover:text-cyan-700 md:block" aria-hidden="true" />
                </a>
              );
            })}
          </nav>
        </div>
      </section>

      <WorkflowSection 
        headline="From the first task to the final invoice."
        subhead="Keep planning, time tracking, and billing in the same place, so you can review the work without piecing together a week of notes."
      />

      <MarketingContent plans={marketingPlans} />

    </div>
  );
}
