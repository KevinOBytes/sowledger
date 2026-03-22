"use client";

import { useState } from "react";
import Image from "next/image";
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [verifyUrl, setVerifyUrl] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setVerifyUrl(null);
    setSuccess(false);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json() as { ok?: boolean; verifyUrl?: string; error?: string; delivery?: string };
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
      } else {
        if (data.verifyUrl) {
          setVerifyUrl(data.verifyUrl);
        } else {
          setSuccess(true);
        }
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm">
        {/* Logo / branding */}
        <div className="mb-8 text-center">
          <div className="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[#050914] shadow-lg overflow-hidden">
            <Image src="/logo.png" alt="Billabled Logo" width={56} height={56} unoptimized />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Billabled</h1>
          <p className="mt-1 text-sm text-slate-400">Workforce Intelligence Platform</p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
          <h2 className="mb-1 text-lg font-semibold text-white">Sign in to your workspace</h2>
          <p className="mb-6 text-sm text-slate-400">
            Enter your email address to receive a secure sign-in link.
          </p>

          {success ? (
            <div className="rounded-lg border border-emerald-700/40 bg-emerald-900/20 p-6 text-center shadow-inner">
              <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-12 text-emerald-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <h3 className="mb-2 text-lg font-semibold text-emerald-400">Check your inbox</h3>
              <p className="text-sm text-emerald-200/70">
                We&apos;ve sent a secure sign-in link to <strong className="text-emerald-300">{email}</strong>. Please check your spam folder if you don&apos;t see it.
              </p>
              <button
                type="button"
                className="mt-6 text-sm font-medium text-cyan-500 hover:text-cyan-400"
                onClick={() => { setSuccess(false); setEmail(""); }}
              >
                ← Use a different email
              </button>
            </div>
          ) : verifyUrl ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-emerald-700/40 bg-emerald-900/20 p-4">
                <p className="text-sm font-medium text-emerald-400">Magic link created!</p>
                <p className="mt-1 text-xs text-slate-400">
                  In production this would be emailed. Click the link below to sign in:
                </p>
              </div>
              <a
                href={verifyUrl}
                className="block w-full rounded-lg bg-cyan-600 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              >
                Click here to sign in →
              </a>
              <button
                type="button"
                className="w-full text-center text-xs text-slate-500 hover:text-slate-400"
                onClick={() => { setVerifyUrl(null); setEmail(""); }}
              >
                Use a different email
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-300">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>

              {error && (
                <div className="rounded-lg border border-rose-700/40 bg-rose-900/20 px-3 py-2 text-sm text-rose-400">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-cyan-600 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 disabled:opacity-50"
              >
                {loading ? "Sending…" : "Send sign-in link"}
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-slate-600">
          Secure passwordless authentication · Billabled &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
