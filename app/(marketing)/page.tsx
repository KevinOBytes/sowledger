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
    icon: FileCheck2,
    href: "#proof-packs",
  },
  {
    title: "Project analytics",
    icon: BarChart3,
    href: "#recovery",
  },
  {
    title: "Client review",
    icon: ShieldCheck,
    href: "#signoff",
  },
  {
    title: "Time tracking",
    icon: TimerReset,
    href: "#workflow",
  },
  {
    title: "Integrations",
    icon: Webhook,
    href: "#integrations",
  },
];

export default function MarketingPage() {
  return (
    <div className="bg-background text-slate-950">
      <section className="relative overflow-hidden border-b border-border px-4 pb-10 pt-10 sm:px-6 lg:pt-12">
        <div className="relative mx-auto grid min-w-0 max-w-7xl gap-8 lg:min-h-[calc(100vh-64px)] lg:grid-rows-[1fr_auto]">
          
          <HeroSection 
            headline="Your work, your time, your invoices. Together."
            subhead="Plan the day, track what you do, and turn approved time into invoices your clients can understand. One place for the work and the details behind the bill."
          />

          <nav
            className="flex flex-wrap gap-x-7 gap-y-1 border-t border-border pt-4"
            aria-label="SOWLedger capability navigation"
          >
            {CAPABILITIES.map((capability) => {
              const Icon = capability.icon;
              return (
                <a key={capability.title} href={capability.href} className="group inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-slate-800 transition hover:text-cyan-700">
                  <Icon className="h-4 w-4 shrink-0 text-cyan-700" aria-hidden="true" />
                  {capability.title}
                  <ArrowRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-cyan-700" aria-hidden="true" />
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
