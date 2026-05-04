import Link from "next/link";
import Image from "next/image";
import { ReactNode } from "react";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col bg-[#f6f3ee] text-slate-950 selection:bg-cyan-500/30">
      <header className="fixed inset-x-0 top-0 z-50 flex h-16 items-center justify-between border-b border-stone-200/70 bg-[#fffdf8]/80 px-6 shadow-sm shadow-stone-900/5 backdrop-blur-xl">
        <Link href="/" className="flex items-center gap-2 transition hover:opacity-80">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white shadow overflow-hidden">
            <Image src="/logo.png" alt="Billabled" width={32} height={32} unoptimized />
          </div>
          <span className="text-lg font-bold tracking-tight">Billabled</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/support" className="text-sm font-medium text-stone-600 transition hover:text-slate-950">
            Support
          </Link>
          <Link href="/support/api" className="hidden text-sm font-medium text-stone-600 transition hover:text-slate-950 sm:inline">
            API
          </Link>
          <Link href="/login" className="text-sm font-medium text-stone-600 transition hover:text-slate-950">
            Log in
          </Link>
          <Link
            href="/login"
            className="rounded-full bg-slate-950 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            Sign up
          </Link>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-stone-200 bg-[#fffdf8] py-12 text-center text-sm text-stone-500">
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
