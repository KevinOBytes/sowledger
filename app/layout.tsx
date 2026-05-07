import type { Metadata, Viewport } from "next";
import DatadogInit from "@/components/DatadogInit";
import { Toaster } from "sonner";
import "./globals.css";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.billabled.com";
const metadataTitle = "Billabled Workforce Intelligence";
const metadataDescription = "Recover revenue and prove every invoice with proof-backed time tracking, retainer leak radar, client sign-off, and agency APIs.";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: metadataTitle,
  description: metadataDescription,
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: metadataTitle,
    description: metadataDescription,
    url: "/",
    siteName: "Billabled",
    images: [
      {
        url: "/images/marketing/billabled-og.png",
        width: 1200,
        height: 630,
        alt: "Billabled proof-backed billing preview.",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: metadataTitle,
    description: metadataDescription,
    images: ["/images/marketing/billabled-og.png"],
  },
  appleWebApp: {
    capable: true,
    title: "Billabled",
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
      </body>
    </html>
  );
}
