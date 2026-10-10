import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import DatadogInit from "@/components/DatadogInit";
import { Toaster } from "sonner";
import { CookieConsent } from "@/components/cookie-consent";
import { AnalyticsWrapper } from "@/components/analytics-wrapper";
import { getAppOrigin } from "@/lib/app-url";
import "./globals.css";

const appUrl = getAppOrigin();
const googleAnalyticsId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
const metadataTitle = "SOWLedger | Time tracking and invoicing for client work";
const metadataDescription = "Plan your work, track your time, and create invoices with the details behind each total. Built for freelancers, agencies, and service teams.";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: metadataTitle,
  description: metadataDescription,
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: metadataTitle,
    description: metadataDescription,
    url: "/",
    siteName: "SOWLedger",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: metadataTitle,
    description: metadataDescription,
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
        <DatadogInit />
        {children}
        <Toaster theme="light" richColors position="bottom-right" />
        <Analytics />
        {googleAnalyticsId ? <AnalyticsWrapper gaId={googleAnalyticsId} /> : null}
        <CookieConsent />
      </body>
    </html>
  );
}
