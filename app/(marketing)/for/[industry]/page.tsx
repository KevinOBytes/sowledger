import { notFound } from "next/navigation";
import { industries } from "@/lib/content/industries";
import { HeroSection } from "@/components/marketing/hero-section";
import { WorkflowSection } from "@/components/marketing/workflow-section";
import { MarketingContent } from "@/components/marketing/marketing-content";
import type { Metadata } from "next";

type PageProps = {
  params: Promise<{ industry: string }>;
};

// Generate static routes at build time for all industries
export async function generateStaticParams() {
  return industries.map((ind) => ({
    industry: ind.slug,
  }));
}

// Generate dynamic metadata (SEO)
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const resolvedParams = await params;
  const industry = industries.find((i) => i.slug === resolvedParams.industry);
  
  if (!industry) {
    return {
      title: "Industry Not Found | SOWLedger",
    };
  }

  return {
    title: `SOWLedger for ${industry.name} | Proof-backed billing`,
    description: industry.heroSubhead,
    alternates: {
      canonical: `https://www.sowledger.com/for/${industry.slug}`,
    },
  };
}

export default async function IndustryMarketingPage({ params }: PageProps) {
  const resolvedParams = await params;
  const industry = industries.find((i) => i.slug === resolvedParams.industry);

  if (!industry) {
    notFound();
  }

  return (
    <div className="bg-background text-slate-950">
      <section className="relative overflow-hidden border-b border-border px-4 pb-10 pt-10 sm:px-6 lg:pt-12">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(15,159,154,0.08)_1px,transparent_1px),linear-gradient(180deg,rgba(22,60,54,0.06)_1px,transparent_1px)] bg-[length:88px_88px]" />
        <div className="relative mx-auto grid max-w-7xl gap-8">
          
          <HeroSection 
            label={industry.heroLabel}
            headline={industry.heroHeadline}
            subhead={industry.heroSubhead}
          />

        </div>
      </section>

      <WorkflowSection 
        headline={industry.workflowHeadline}
        subhead={industry.workflowSubhead}
      />

      <MarketingContent />
    </div>
  );
}
