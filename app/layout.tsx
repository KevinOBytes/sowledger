import type { Metadata } from "next";
import DatadogInit from "@/components/DatadogInit";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Billabled Workforce Intelligence",
  description: "Compliance-first time tracking with auditability and local-first resilience",
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
        <Toaster theme="dark" position="bottom-right" />
      </body>
    </html>
  );
}
