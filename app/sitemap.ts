import type { MetadataRoute } from "next";
import { industries } from "@/lib/content/industries";

const SITE_URL = "https://www.sowledger.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const fixedRoutes = ["/", "/for", "/support", "/support/api", "/security", "/privacy", "/terms", "/billing-policy", "/contact"];
  return [
    ...fixedRoutes.map((path) => ({ url: `${SITE_URL}${path}`, changeFrequency: "monthly" as const, priority: path === "/" ? 1 : 0.6 })),
    ...industries.map((industry) => ({ url: `${SITE_URL}/for/${industry.slug}`, changeFrequency: "monthly" as const, priority: 0.7 })),
  ];
}
