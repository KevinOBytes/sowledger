import type { MetadataRoute } from "next";
import { PUBLIC_SITE_URL } from "@/lib/marketing-metadata";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Authentication remains the access boundary. These are crawl preferences.
      // Leave /login crawlable so crawlers can read its noindex metadata.
      disallow: [
        "/api/", "/admin", "/app/", "/dashboard", "/activity", "/planner",
        "/calendar", "/clients", "/people", "/projects", "/reports",
        "/approvals", "/invoices", "/integrations", "/exports", "/notifications", "/settings",
        "/client", "/monitoring",
      ],
    },
    sitemap: `${PUBLIC_SITE_URL}/sitemap.xml`,
  };
}
