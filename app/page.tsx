import { TimerDashboard } from "@/components/timer-dashboard";

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#050914]">
      {/* Ambient gradient orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-cyan-600/20 blur-[100px]" />
        <div className="absolute right-0 top-1/3 h-80 w-80 rounded-full bg-violet-600/15 blur-[100px]" />
        <div className="absolute bottom-0 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-indigo-600/10 blur-[120px]" />
      </div>
      <div className="relative z-10 px-4 py-6 sm:px-6 lg:px-8">
        <TimerDashboard />
      </div>
    </main>
  );
}
