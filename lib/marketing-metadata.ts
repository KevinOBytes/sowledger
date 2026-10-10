import type { Metadata } from "next";

export const PUBLIC_SITE_URL = "https://www.sowledger.com";
export const MARKETING_TITLE = "SOWLedger | Time tracking and invoicing for client work";
export const MARKETING_DESCRIPTION = "Plan your work, track your time, and create invoices with the details behind each total. Built for freelancers, agencies, and service teams.";
export const MARKETING_SOCIAL_IMAGE = {
  url: `${PUBLIC_SITE_URL}/opengraph-image`,
  width: 1200,
  height: 630,
  alt: "SOWLedger — time tracking and invoicing for client work",
};

// Call only with repository-owned public routes and copy, never request input.
export function publicPageMetadata(path: string, title: string, description: string): Metadata {
  const url = new URL(path, PUBLIC_SITE_URL).href;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: "SOWLedger",
      type: "website",
      images: [MARKETING_SOCIAL_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [MARKETING_SOCIAL_IMAGE],
    },
  };
}
