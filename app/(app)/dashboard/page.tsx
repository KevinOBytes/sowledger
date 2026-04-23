import { TimerDashboard } from "@/components/timer-dashboard";

export default function Home() {
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#050914]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-0 top-0 h-72 w-72 rounded-full bg-cyan-600/10 blur-[90px]" />
        <div className="absolute right-0 top-1/2 h-72 w-72 rounded-full bg-indigo-600/10 blur-[95px]" />
      </div>

      <div className="relative z-10 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto mb-5 flex max-w-5xl items-center justify-between rounded-2xl border border-white/10 bg-slate-900/55 px-5 py-4 backdrop-blur">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Time Tracker</p>
            <h1 className="text-xl font-semibold text-slate-100">Log work with fewer clicks</h1>
          </div>
          <p className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs font-medium text-slate-300">{today}</p>
        </div>
        <TimerDashboard />
      </div>
    </main>
  );
}
