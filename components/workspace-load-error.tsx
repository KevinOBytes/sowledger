"use client";

export function WorkspaceLoadError() {
  return (
    <main className="app-shell-bg flex min-h-screen items-center justify-center px-5 text-slate-800">
      <section role="alert" className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold">We couldn&apos;t load your workspace</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">SOWLedger couldn&apos;t reach your workspace data. Try again in a moment.</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-6 rounded-xl bg-cyan-700 px-5 py-2.5 font-semibold text-white hover:bg-cyan-800">Try again</button>
        <a href="/support" className="ml-4 text-sm font-medium text-cyan-800 underline">Contact support</a>
      </section>
    </main>
  );
}
