import { CalendarView } from "@/components/calendar-view";

export const metadata = { title: "Calendar - Billabled" };

export default function CalendarPage() {
  return (
    <main className="min-h-screen bg-[#f6f3ee] p-4 text-slate-950 sm:p-8">
      <div className="mx-auto flex h-[calc(100vh-2rem)] max-w-7xl flex-col gap-6 sm:h-[calc(100vh-4rem)]">
        <header className="rounded-[32px] border border-slate-200 bg-white px-6 py-5 shadow-sm">
          <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Planning surface</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Calendar</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">
            Schedule work blocks, start timers from plans, and convert planned work into manual time when work happens offline.
          </p>
        </header>
        <div className="min-h-0 flex-1">
          <CalendarView />
        </div>
      </div>
    </main>
  );
}
