"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Mail } from "lucide-react";
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [verifyUrl, setVerifyUrl] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linkError = params.get("error");
    if (!linkError) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(linkError === "service_unavailable"
      ? "We couldn't finish signing you in. Try the link in your email again in a moment."
      : linkError.includes("invitation") || linkError.includes("invited")
        ? "This invitation is no longer available. Ask your workspace owner for a new one."
        : "This sign-in link is missing, expired, or already used. Enter your email for a new one.");
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

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
      setError("We couldn't connect. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell-bg flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-8 flex items-center justify-center gap-3 text-xl font-semibold tracking-tight text-slate-900">
          <Image src="/logo.png" alt="" width={40} height={40} className="rounded-xl" unoptimized />
          SOWLedger
        </Link>
        <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm shadow-stone-900/5 sm:p-8">
          <h1 className="mb-2 text-2xl font-semibold tracking-tight text-slate-900">Sign in to SOWLedger</h1>
          <p className="mb-6 text-sm leading-6 text-stone-600">Enter your email and we&apos;ll send you a sign-in link. No password needed.</p>

          {success ? (
            <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
              <Mail className="mx-auto mb-4 h-10 w-10 text-emerald-600" aria-hidden="true" />
              <h2 className="mb-2 text-lg font-semibold text-emerald-800">Check your email</h2>
              <p className="text-sm text-emerald-700">
                Your sign-in link is on its way to <strong>{email}</strong>. It works once and expires in 20 minutes. Check your spam folder if it doesn&apos;t arrive.
              </p>
              <button
                type="button"
                className="mt-6 text-sm font-medium text-teal-700 hover:text-teal-600"
                onClick={() => { setSuccess(false); setEmail(""); }}
              >
                Use a different email
              </button>
            </div>
          ) : verifyUrl ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-sm font-medium text-emerald-800">Local sign-in link ready</p>
                <p className="mt-1 text-xs text-stone-500">
                  Email is off in this development environment. Use the link below to sign in.
                </p>
              </div>
              <a
                href={verifyUrl}
                className="block w-full rounded-xl bg-cyan-700 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-cyan-800 focus:outline-none focus:ring-2 focus:ring-cyan-600"
              >
                Sign in
              </a>
              <button
                type="button"
                className="w-full text-center text-xs text-stone-500 hover:text-stone-700"
                onClick={() => { setVerifyUrl(null); setEmail(""); }}
              >
                Use a different email
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="mb-1 block text-sm font-medium text-stone-700">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  inputMode="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-base text-slate-900 placeholder-stone-400 focus:border-cyan-600 focus:outline-none focus:ring-1 focus:ring-cyan-600"
                />
              </div>

              {error && (
                <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-cyan-700 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-800 focus:outline-none focus:ring-2 focus:ring-cyan-600 disabled:opacity-50"
              >
                {loading ? "Sending…" : "Email me a sign-in link"}
              </button>
            </form>
          )}
          <p className="mt-5 text-xs leading-5 text-stone-500">Joining a team? Use the email address they invited. New here? The same link lets you get started.</p>
        </div>

        <p className="mt-6 text-center text-xs text-stone-500">Need a hand? <Link href="/support" className="font-medium text-cyan-700 underline">Get help</Link></p>
      </div>
    </div>
  );
}
