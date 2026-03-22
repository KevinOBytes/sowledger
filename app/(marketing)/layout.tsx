import Link from "next/link";
import Image from "next/image";
import { ReactNode } from "react";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col bg-[#050914] text-white selection:bg-cyan-500/30">
      <header className="fixed inset-x-0 top-0 z-50 flex h-16 items-center justify-between border-b border-white/5 bg-[#050914]/60 px-6 backdrop-blur-xl">
        <Link href="/" className="flex items-center gap-2 transition hover:opacity-80">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#050914] shadow overflow-hidden">
            <Image src="/logo.png" alt="Timed" width={32} height={32} unoptimized />
          </div>
          <span className="text-lg font-bold tracking-tight">Timed</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-sm font-medium text-slate-300 transition hover:text-white">
            Sign in
          </Link>
          <Link
            href="/login"
            className="rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-black transition hover:bg-slate-200"
          >
            Start tracking
          </Link>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-white/5 bg-[#050914] py-12 text-center text-sm text-slate-500">
        <p>&copy; {new Date().getFullYear()} Timed Inc. All rights reserved.</p>
      </footer>
    </div>
  );
}
