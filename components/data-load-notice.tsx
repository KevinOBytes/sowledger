"use client";

export function DataLoadNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <section role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
      <p className="font-semibold">{message}</p>
      <p className="mt-2 text-sm">Try again in a moment. If the problem continues, contact support.</p>
      <button type="button" onClick={onRetry ?? (() => window.location.reload())} className="mt-4 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Try again</button>
    </section>
  );
}
