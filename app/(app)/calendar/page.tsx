import { CalendarView } from "@/components/calendar-view";

export const metadata = { title: "Calendar – Timed" };

export default function CalendarPage() {
  return (
    <main className="flex h-screen flex-col bg-[#050914] p-6 sm:p-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-white">Calendar Tracker</h1>
        <p className="mt-2 text-sm text-slate-400">Review your past time blocks and upcoming task deadlines in a glance.</p>
      </div>

      <div className="flex-1 overflow-hidden">
        <CalendarView />
      </div>
    </main>
  );
}
