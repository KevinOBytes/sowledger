import type { Metadata } from "next";
import type { ReactNode } from "react";
import { publicPageMetadata } from "@/lib/marketing-metadata";

export const metadata: Metadata = {
  ...publicPageMetadata("/login", "Sign in | SOWLedger", "Sign in to your SOWLedger workspace with a secure email link."),
  robots: { index: false, follow: false },
};

export default function LoginLayout({ children }: { children: ReactNode }) {
  return children;
}
