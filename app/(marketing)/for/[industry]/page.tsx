import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IndustryLandingContent } from "@/components/marketing/industry-landing-content";
import { industries } from "@/lib/content/industries";

type PageProps = { params: Promise<{ industry: string }> };

export function generateStaticParams() {
  return industries.map(({ slug }) => ({ industry: slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { industry: slug } = await params;
  const industry = industries.find((item) => item.slug === slug);

  if (!industry) {
    return { title: "Page not found | SOWLedger" };
  }

  return {
    title: `Time tracking for ${industry.name} | SOWLedger`,
    description: industry.heroSubhead,
    alternates: { canonical: `https://www.sowledger.com/for/${industry.slug}` },
  };
}

export default async function IndustryMarketingPage({ params }: PageProps) {
  const { industry: slug } = await params;
  const industry = industries.find((item) => item.slug === slug);

  if (!industry) {
    notFound();
  }

  return <IndustryLandingContent industry={industry} />;
}
