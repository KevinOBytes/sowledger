import Link from "next/link";
import Image from "next/image";
import { ReactNode } from "react";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col bg-background text-slate-950 selection:bg-cyan-500/30">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-border/80 bg-surface/90 shadow-sm shadow-stone-900/5 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="flex min-w-0 items-center gap-2 transition hover:opacity-80">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white shadow">
              <Image src="/logo.png" alt="Billabled" width={32} height={32} unoptimized />
            </div>
            <span className="text-lg font-bold tracking-tight text-slate-950">Billabled</span>
          </Link>
          <nav className="hidden items-center gap-5 text-sm font-semibold text-stone-600 lg:flex" aria-label="Marketing navigation">
            <Link href="/#proof-packs" className="transition hover:text-cyan-700">
              Proof
            </Link>
            <Link href="/#recovery" className="transition hover:text-cyan-700">
              Recovery
            </Link>
            <Link href="/#signoff" className="transition hover:text-cyan-700">
              Sign-off
            </Link>
            <Link href="/support/api" className="transition hover:text-cyan-700">
              API
            </Link>
            <Link href="/#pricing" className="transition hover:text-cyan-700">
              Pricing
            </Link>
          </nav>
          <div className="flex items-center gap-3 sm:gap-4">
            <Link href="/support" className="hidden text-sm font-medium text-stone-600 transition hover:text-slate-950 sm:inline">
              Support
            </Link>
            <Link href="/login" className="text-sm font-medium text-stone-600 transition hover:text-slate-950">
              Log in
            </Link>
            <Link
              href="/login"
              className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Sign up
            </Link>
          </div>
        </div>
      </header>
      <main className="flex-1 pt-16">{children}</main>
      <footer className="border-t border-border bg-surface py-12 text-center text-sm text-stone-500">
        <div className="mx-auto mb-4 flex max-w-3xl flex-wrap justify-center gap-x-5 gap-y-2">
          <Link href="/support" className="hover:text-slate-950">Support</Link>
          <Link href="/support/api" className="hover:text-slate-950">API docs</Link>
          <Link href="/security" className="hover:text-slate-950">Security</Link>
          <Link href="/privacy" className="hover:text-slate-950">Privacy</Link>
          <Link href="/terms" className="hover:text-slate-950">Terms</Link>
          <Link href="/billing-policy" className="hover:text-slate-950">Billing policy</Link>
          <Link href="/contact" className="hover:text-slate-950">Contact</Link>
        </div>
        <p>&copy; {new Date().getFullYear()} Billabled Inc. All rights reserved.</p>
      </footer>
    </div>
  );
}
