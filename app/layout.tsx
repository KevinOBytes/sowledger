import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { CookieConsent } from "@/components/cookie-consent";
import { OptionalAnalytics } from "@/components/optional-analytics";
import { MARKETING_DESCRIPTION, MARKETING_SOCIAL_IMAGE, MARKETING_TITLE, PUBLIC_SITE_URL } from "@/lib/marketing-metadata";
import "./globals.css";

const googleAnalyticsId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
const metadataTitle = MARKETING_TITLE;
const metadataDescription = MARKETING_DESCRIPTION;

export const metadata: Metadata = {
  metadataBase: new URL(PUBLIC_SITE_URL),
  title: metadataTitle,
  description: metadataDescription,
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: metadataTitle,
    description: metadataDescription,
    siteName: "SOWLedger",
    type: "website",
    images: [MARKETING_SOCIAL_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: metadataTitle,
    description: metadataDescription,
    images: [MARKETING_SOCIAL_IMAGE],
  },
  appleWebApp: {
    capable: true,
    title: "SOWLedger",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f7f2ea",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">
        {children}
        <Toaster theme="light" richColors position="bottom-right" closeButton toastOptions={{ closeButtonAriaLabel: "Dismiss notification", classNames: { closeButton: "h-7! w-7!" } }} />
        <OptionalAnalytics gaId={googleAnalyticsId} vercelEnabled={process.env.NODE_ENV === "production" && process.env.VERCEL === "1" && process.env.SOWLEDGER_TEST_DATABASE !== "true"} />
        <CookieConsent />
      </body>
    </html>
  );
}
