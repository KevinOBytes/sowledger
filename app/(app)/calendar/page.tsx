import { CalendarIntegrationPanel } from "@/components/calendar-integration-panel";
import { CalendarViewClient } from "@/components/calendar-view-client";

export const metadata = { title: "Calendar - SOWLedger" };

export default function CalendarPage() {
  return (
    <main className="min-h-screen bg-[#f6f3ee] p-4 text-slate-950 sm:p-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">Calendar</h1>
          <p className="mt-1 text-sm text-slate-500">Plan work and log time from your schedule.</p>
        </header>
        <div className="min-w-0">
          <CalendarViewClient />
        </div>
        <details className="rounded-2xl border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">Google Calendar sync</summary>
          <div className="mt-3"><CalendarIntegrationPanel /></div>
        </details>
      </div>
    </main>
  );
}
