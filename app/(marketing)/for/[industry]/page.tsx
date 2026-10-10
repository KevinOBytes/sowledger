import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IndustryLandingContent } from "@/components/marketing/industry-landing-content";
import { industries } from "@/lib/content/industries";
import { publicPageMetadata } from "@/lib/marketing-metadata";

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

  return publicPageMetadata(
    `/for/${industry.slug}`,
    `Time tracking for ${industry.name} | SOWLedger`,
    industry.heroSubhead,
  );
}

export default async function IndustryMarketingPage({ params }: PageProps) {
  const { industry: slug } = await params;
  const industry = industries.find((item) => item.slug === slug);

  if (!industry) {
    notFound();
  }

  return <IndustryLandingContent industry={industry} />;
}
