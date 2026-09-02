"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";

const marketingLinks = [
  { href: "/#proof-packs", label: "Proof" },
  { href: "/#recovery", label: "Recovery" },
  { href: "/#signoff", label: "Sign-off" },
  { href: "/support/api", label: "API" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/for", label: "Built for" },
];

export function MarketingHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border/80 bg-surface/90 shadow-sm shadow-stone-900/5 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex min-w-0 items-center gap-2 transition hover:opacity-80">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white shadow">
            <Image src="/logo.png" alt="SOWLedger" width={32} height={32} unoptimized />
          </div>
          <span className="text-lg font-bold tracking-tight text-slate-950">SOWLedger</span>
        </Link>

        <nav className="hidden items-center gap-5 text-sm font-semibold text-stone-600 lg:flex" aria-label="Marketing navigation">
          {marketingLinks.map((link) => (
            <Link key={link.href} href={link.href} className="transition hover:text-cyan-700">
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3 sm:gap-4">
          <Link href="/support" className="hidden text-sm font-medium text-stone-600 transition hover:text-slate-950 sm:inline">
            Support
          </Link>
          <Link href="/login" className="text-sm font-medium text-stone-600 transition hover:text-slate-950">
            Log in
          </Link>
          <Link href="/login" className="rounded-full bg-slate-950 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 sm:px-4">
            Sign up
          </Link>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="marketing-mobile-navigation"
            aria-label="Open marketing menu"
            className="rounded-lg p-2 text-stone-600 transition hover:bg-stone-100 hover:text-slate-950 lg:hidden"
          >
            {menuOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav
          id="marketing-mobile-navigation"
          aria-label="Mobile marketing navigation"
          className="border-t border-border bg-surface px-4 py-4 shadow-lg lg:hidden"
        >
          <div className="mx-auto grid max-w-7xl gap-1">
            {marketingLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-stone-700 transition hover:bg-cyan-50 hover:text-cyan-800"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
