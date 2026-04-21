"use client";

import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Clock, CheckSquare } from "lucide-react";
import { ProjectTask } from "@/lib/store";

type TimeEntry = {
    id: string;
    startedAt: string;
    stoppedAt: string | null;
    durationSeconds: number | null;
    taskId?: string;
};

export function CalendarView() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      const res = await fetch("/api/calendar");
      if (res.ok) {
          const data = await res.json();
          setEntries(data.entries ?? []);
          setTasks(data.tasks ?? []);
      }
      setLoading(false);
    }
    fetchData();
  }, []);

  const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));

  function generateCalendarGrid() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDayIndex = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const days = [];
    // Filler padding days
    for (let i = 0; i < firstDayIndex; i++) {
        days.push(null);
    }
    for (let i = 1; i <= daysInMonth; i++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(i).padStart(2, "0")}`;
        days.push({ dayNumber: i, dateStr });
    }
    return days;
  }

  const formatHours = (seconds: number) => (seconds / 3600).toFixed(1) + "h";

  return (
    <div className="flex h-full flex-col rounded-2xl border border-white/5 bg-slate-900/40 shadow-xl overflow-hidden backdrop-blur-xl">
        {/* Header toolbar */}
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
            <h2 className="text-xl font-semibold text-white">
                {currentDate.toLocaleString("default", { month: "long" })} {currentDate.getFullYear()}
            </h2>
            <div className="flex items-center gap-2">
                <button 
                  onClick={prevMonth}
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                >
                    <ChevronLeft className="h-5 w-5" />
                </button>
                <button 
                  onClick={() => setCurrentDate(new Date())}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
                >
                    Today
                </button>
                <button 
                  onClick={nextMonth}
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                >
                    <ChevronRight className="h-5 w-5" />
                </button>
            </div>
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-7 border-b border-white/5 bg-slate-900/50">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
                <div key={d} className="py-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {d}
                </div>
            ))}
        </div>

        <div className="flex-1 overflow-y-auto">
            {loading ? (
                <div className="flex h-full items-center justify-center text-slate-500 animate-pulse">Loading calendar data...</div>
            ) : (
                <div className="grid grid-cols-7 auto-rows-[minmax(120px,1fr)] h-full">
                    {generateCalendarGrid().map((cell, idx) => {
                        if (!cell) {
                            return <div key={`empty-${idx}`} className="border-b border-r border-white/5 bg-slate-950/30" />;
                        }

                        const dayEntries = entries.filter(e => e.startedAt.startsWith(cell.dateStr));
                        const totalSeconds = dayEntries.reduce((acc, curr) => acc + (curr.durationSeconds || 0), 0);
                        const dayTasks = tasks.filter(t => 
                            (t.dueDate as unknown as string) === cell.dateStr || 
                            ((t.createdAt as unknown as string).startsWith(cell.dateStr) && !t.dueDate)
                        );
                        const isToday = cell.dateStr === new Date().toISOString().split("T")[0];

                        return (
                            <div key={cell.dateStr} className={`border-b border-r border-white/5 p-2 transition-colors hover:bg-white/[0.02] ${isToday ? 'bg-cyan-500/5' : ''}`}>
                                <div className="flex items-start justify-between">
                                    <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium ${isToday ? 'bg-cyan-500 text-white' : 'text-slate-400'}`}>
                                        {cell.dayNumber}
                                    </span>
                                </div>
                                <div className="mt-2 space-y-1.5 flex flex-col items-start w-full">
                                    {totalSeconds > 0 && (
                                        <div className="flex w-full items-center justify-between rounded bg-violet-500/10 px-2 py-1 text-xs text-violet-400 border border-violet-500/20">
                                            <div className="flex gap-1 items-center"><Clock className="w-3 h-3" /> Time</div>
                                            <span className="font-semibold">{formatHours(totalSeconds)}</span>
                                        </div>
                                    )}
                                    {/* Trim max 3 tasks to fit nicely */}
                                    {dayTasks.slice(0, 3).map(t => (
                                        <div key={t.id} className="w-full truncate rounded bg-slate-800/80 px-2 py-1 text-xs text-slate-300 border border-white/5 flex items-center gap-1.5" title={t.title}>
                                            <CheckSquare className="w-3 h-3 text-cyan-500 shrink-0" />
                                            <span className="truncate">{t.title}</span>
                                        </div>
                                    ))}
                                    {dayTasks.length > 3 && (
                                        <div className="w-full text-xs text-slate-500 px-1 font-medium">
                                            + {dayTasks.length - 3} more
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    </div>
  );
}
