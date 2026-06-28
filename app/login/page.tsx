"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
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
    setError(linkError === "missing_link" ? "Sign-in link is missing. Enter your email to request a fresh secure link." : `Sign-in link could not be used: ${linkError}. Request a fresh link below.`);
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
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell-bg flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="grid w-full max-w-5xl gap-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
        {/* Logo / branding */}
        <div className="text-center lg:text-left">
          <div className="mb-3 inline-flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-lg shadow-stone-900/10">
            <Image src="/logo.png" alt="Billabled Logo" width={56} height={56} unoptimized />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#17211d]">Billabled</h1>
          <p className="mt-1 text-sm text-stone-500">Schedule work. Track cleanly. Invoice with proof.</p>
          <div className="mt-8 rounded-[28px] border border-stone-200 bg-[#fffdf8]/85 p-5 text-left shadow-xl shadow-stone-900/10">
            <p className="text-sm font-bold uppercase tracking-[0.22em] text-teal-700">What happens next</p>
            <div className="mt-4 space-y-4 text-sm text-stone-600">
              <p><span className="font-semibold text-[#17211d]">New workspace:</span> if signup is open, your email can create a workspace.</p>
              <p><span className="font-semibold text-[#17211d]">Invited workspace:</span> use the exact email your workspace owner invited. Other emails can request access.</p>
              <p><span className="font-semibold text-[#17211d]">Existing workspace:</span> the same secure link signs you back in without a password.</p>
            </div>
          </div>
        </div>

        <div className="rounded-[28px] border border-stone-200 bg-[#fffdf8] p-6 shadow-xl shadow-stone-900/10">
          <h2 className="mb-1 text-lg font-semibold text-[#17211d]">Continue to your workspace</h2>
          <p className="mb-6 text-sm text-stone-500">
            Enter your email to receive a secure link. New users can create a workspace when signup is available; invited users should use the email their owner or manager invited.
          </p>

          {success ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto mb-4 h-12 w-12 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <h3 className="mb-2 text-lg font-semibold text-emerald-800">Open your secure link</h3>
              <p className="text-sm text-emerald-700">
                We&apos;ve sent a secure sign-in link to <strong>{email}</strong>. Please check your spam folder if you don&apos;t see it.
              </p>
              <button
                type="button"
                className="mt-6 text-sm font-medium text-teal-700 hover:text-teal-600"
                onClick={() => { setSuccess(false); setEmail(""); }}
              >
                ← Use a different email
              </button>
            </div>
          ) : verifyUrl ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-sm font-medium text-emerald-800">Secure link created</p>
                <p className="mt-1 text-xs text-stone-500">
                  Development shortcut only. In production, this link is delivered by email:
                </p>
              </div>
              <a
                href={verifyUrl}
                className="block w-full rounded-2xl bg-[#163c36] py-2.5 text-center text-sm font-semibold text-white transition hover:bg-[#23544b] focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                Click here to sign in →
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
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-2xl border border-stone-200 bg-white px-3 py-2.5 text-sm text-[#17211d] placeholder-stone-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>

              {error && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-2xl bg-[#163c36] py-2.5 text-sm font-semibold text-white transition hover:bg-[#23544b] focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50"
              >
                {loading ? "Sending…" : "Continue with email"}
              </button>
            </form>
          )}
          <div className="mt-5 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-xs leading-5 text-stone-500">
            By continuing, you can create or join a workspace when signup is available or your email has a pending invitation. Workspace owners can invite teammates later from People.
          </div>
        </div>

        <p className="text-center text-xs text-stone-500 lg:col-span-2">
          Secure passwordless authentication · Billabled &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
