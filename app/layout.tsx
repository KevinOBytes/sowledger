import type { Metadata, Viewport } from "next";
import DatadogInit from "@/components/DatadogInit";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Billabled Workforce Intelligence",
  description: "Compliance-first time tracking with auditability and local-first resilience",
  manifest: "/manifest.webmanifest",
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
