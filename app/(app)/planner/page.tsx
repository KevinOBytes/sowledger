import Link from "next/link";
import { ArrowRight, CalendarClock, FolderKanban, Users } from "lucide-react";

import { ResourcePlanner } from "@/components/resource-planner";

export const metadata = { title: "Resource Planner - Billabled" };

export default function PlannerPage() {
  return (
    <main className="min-h-screen bg-[#f6f3ee] p-4 text-slate-950 sm:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Plan</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Resource Planner</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-500">
                Balance assigned work, expose unowned backlog, and move directly into staffing, projects, or calendar planning without leaving the operational flow.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Link href="/people" className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition hover:border-cyan-200 hover:bg-cyan-50">
                <div className="flex items-center gap-2 text-cyan-700">
                  <Users className="h-4 w-4" />
                  <span className="text-xs font-bold uppercase tracking-[0.2em]">People</span>
                </div>
                <p className="mt-2 text-sm font-semibold text-slate-950">Manage organizations</p>
              </Link>
              <Link href="/projects" className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition hover:border-cyan-200 hover:bg-cyan-50">
                <div className="flex items-center gap-2 text-cyan-700">
                  <FolderKanban className="h-4 w-4" />
                  <span className="text-xs font-bold uppercase tracking-[0.2em]">Tasks</span>
                </div>
                <p className="mt-2 text-sm font-semibold text-slate-950">Open project delivery</p>
              </Link>
              <Link href="/calendar" className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition hover:border-cyan-200 hover:bg-cyan-50">
                <div className="flex items-center gap-2 text-cyan-700">
                  <CalendarClock className="h-4 w-4" />
                  <span className="text-xs font-bold uppercase tracking-[0.2em]">Schedule</span>
                </div>
                <p className="mt-2 text-sm font-semibold text-slate-950">Turn backlog into time</p>
              </Link>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-[#f8fafc] p-4">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Planning features</p>
              <p className="mt-2 text-sm text-slate-600">People-aware capacity, unassigned work watchlists, goal ownership, and direct handoff into project task management.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-[#f8fafc] p-4">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Best next action</p>
              <p className="mt-2 text-sm text-slate-600">Create or invite missing people first, then assign the unowned backlog so the planner reflects actual delivery capacity.</p>
            </div>
            <Link href="/people" className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4 text-cyan-900 transition hover:bg-cyan-100">
              <p className="text-xs font-bold uppercase tracking-[0.2em]">Recommended</p>
              <div className="mt-2 flex items-center justify-between gap-4">
                <p className="text-sm font-semibold">Open people workspace</p>
                <ArrowRight className="h-4 w-4" />
              </div>
            </Link>
          </div>
        </header>

        <ResourcePlanner />
      </div>
    </main>
  );
}
