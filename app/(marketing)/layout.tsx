import Link from "next/link";
import { ReactNode } from "react";
import { industries } from "@/lib/content/industries";
import { MarketingHeader } from "@/components/marketing/marketing-header";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col bg-background text-slate-950 selection:bg-cyan-500/30">
      <MarketingHeader />
      <main className="flex-1 pt-16">{children}</main>
      <footer className="border-t border-border bg-surface py-12 text-sm text-stone-500">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="grid gap-10 md:grid-cols-2">
            <div>
              <p className="font-bold text-slate-950 mb-4">Built for</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {industries.map((ind) => (
                  <Link key={ind.slug} href={`/for/${ind.slug}`} className="hover:text-slate-950 transition">
                    {ind.name}
                  </Link>
                ))}
              </div>
            </div>
            <div className="md:text-right">
              <p className="font-bold text-slate-950 mb-4">Help and information</p>
              <div className="flex flex-col gap-2 md:items-end">
                <Link href="/support" className="hover:text-slate-950">Support</Link>
                <Link href="/support/api" className="hover:text-slate-950">API docs</Link>
                <Link href="/security" className="hover:text-slate-950">Security</Link>
                <Link href="/privacy" className="hover:text-slate-950">Privacy</Link>
                <Link href="/terms" className="hover:text-slate-950">Terms</Link>
                <Link href="/billing-policy" className="hover:text-slate-950">Billing policy</Link>
                <Link href="/contact" className="hover:text-slate-950">Contact</Link>
              </div>
            </div>
          </div>
          <div className="mt-12 border-t border-border pt-6 text-center">
            <p>&copy; {new Date().getFullYear()} SOWLedger Inc. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
