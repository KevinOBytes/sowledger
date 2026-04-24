"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CalendarIcon, DownloadIcon, LineChart, Timer, TrendingUp } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

import { ManualTimeDialog } from "@/components/manual-time-dialog";

type ReportData = {
  ok: boolean;
  scope: "mine" | "team";
  totalHours: number;
  totalBillableAmount: number;
  plannedHours: number;
  manualHours: number;
  timerHours: number;
  utilization: number | null;
  missedBlocks: number;
  dailyTrend: { date: string; hours: number }[];
  projectDistribution: { projectId: string; name: string; hours: number }[];
  userDistribution: { userId: string; email: string; hours: number }[];
};

const COLORS = ["#0891b2", "#0f766e", "#d97706", "#4f46e5", "#be123c", "#64748b"];

function get30DaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().split("T")[0];
}

function metric(value: number, suffix = "") {
  return `${value.toFixed(value >= 10 ? 0 : 1)}${suffix}`;
}

export function ReportsPageClient() {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<"mine" | "team">("mine");
  const [startDate, setStartDate] = useState(get30DaysAgo());
  const [endDate, setEndDate] = useState(new Date().toISOString().split("T")[0]);
  const [manualOpen, setManualOpen] = useState(false);

  async function fetchReports() {
    setLoading(true);
    try {
      const query = new URLSearchParams({ scope });
      if (startDate) query.append("start", startDate);
      if (endDate) query.append("end", endDate);
      const res = await fetch(`/api/reports?${query.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Unable to load analytics");
      setData(json);
    } catch (error) {
      if (scope === "team") setScope("mine");
      toast.error("Analytics unavailable", { description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, startDate, endDate]);

  useEffect(() => {
    const onTimeSaved = () => {
      fetchReports().catch(() => null);
    };
    window.addEventListener("billabled:time-saved", onTimeSaved);
    return () => window.removeEventListener("billabled:time-saved", onTimeSaved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, startDate, endDate]);

  const utilizationLabel = useMemo(() => {
    if (!data || data.utilization == null) return "No plan yet";
    return `${Math.round(data.utilization * 100)}%`;
  }, [data]);

  function exportAnalytics() {
    const query = new URLSearchParams({ format: "csv", start: startDate, end: endDate, include: "projects,timeEntries,users,schedule" });
    window.location.href = `/api/export/csv?${query.toString()}`;
  }

  if (loading && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f6f3ee] p-8 text-slate-500">
        <div className="flex flex-col items-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-t-2 border-cyan-600" />
          <p>Loading analytics...</p>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#f6f3ee] p-4 text-slate-950 sm:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Analytics</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Work performance and billable output</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-500">Track planned vs actual work, manual vs timer entries, utilization, project allocation, and export-ready billing signals.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => setManualOpen(true)} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:border-cyan-300 hover:text-cyan-700">Log time</button>
              <button onClick={exportAnalytics} disabled={!data} className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50">
                <DownloadIcon className="h-4 w-4" />Export CSV
              </button>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-3 md:flex-row md:items-center md:justify-between">
            <div className="flex rounded-full bg-white p-1 shadow-sm">
              {(["mine", "team"] as const).map((option) => (
                <button key={option} onClick={() => setScope(option)} className={`rounded-full px-4 py-2 text-sm font-bold capitalize transition ${scope === option ? "bg-slate-950 text-white" : "text-slate-500 hover:text-slate-950"}`}>
                  {option === "mine" ? "My analytics" : "Team analytics"}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-500"><CalendarIcon className="h-4 w-4" />Date range</div>
              <input type="date" title="Start Date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-cyan-500" />
              <span className="text-slate-400">to</span>
              <input type="date" title="End Date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-cyan-500" />
            </div>
          </div>
        </header>

        {!data ? (
          <div className="rounded-[32px] border border-slate-200 bg-white p-10 text-center text-rose-600 shadow-sm">Failed to load analytics.</div>
        ) : (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className={`space-y-6 transition-opacity ${loading ? "opacity-60" : "opacity-100"}`}>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-semibold text-slate-500">Logged hours</p>
                <p className="mt-2 text-3xl font-semibold">{metric(data.totalHours, "h")}</p>
              </div>
              <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-semibold text-slate-500">Planned hours</p>
                <p className="mt-2 text-3xl font-semibold">{metric(data.plannedHours, "h")}</p>
              </div>
              <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-semibold text-slate-500">Utilization</p>
                <p className="mt-2 text-3xl font-semibold text-cyan-700">{utilizationLabel}</p>
              </div>
              <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-semibold text-slate-500">Manual vs timer</p>
                <p className="mt-2 text-3xl font-semibold">{metric(data.manualHours, "h")}</p>
                <p className="text-sm text-slate-500">manual / {metric(data.timerHours, "h")} timer</p>
              </div>
              <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-semibold text-slate-500">Billable pipeline</p>
                <p className="mt-2 text-3xl font-semibold text-emerald-700">${data.totalBillableAmount.toFixed(0)}</p>
                <p className="text-sm text-amber-700">{data.missedBlocks} missed planned block(s)</p>
              </div>
            </section>

            <section className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-6 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">Daily execution trend</h2>
                    <p className="text-sm text-slate-500">Actual logged hours by day.</p>
                  </div>
                  <LineChart className="h-5 w-5 text-cyan-700" />
                </div>
                <div className="min-h-[320px] w-full">
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={data.dailyTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="date" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                      <Tooltip cursor={{ fill: "#f1f5f9" }} contentStyle={{ backgroundColor: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "16px" }} />
                      <Bar dataKey="hours" fill="#0891b2" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-6 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">Project distribution</h2>
                    <p className="text-sm text-slate-500">Where billable capacity is going.</p>
                  </div>
                  <TrendingUp className="h-5 w-5 text-cyan-700" />
                </div>
                <div className="min-h-[320px] w-full">
                  {data.projectDistribution.length > 0 ? (
                    <ResponsiveContainer width="100%" height={320}>
                      <PieChart>
                        <Pie data={data.projectDistribution} cx="50%" cy="50%" innerRadius={78} outerRadius={118} paddingAngle={4} dataKey="hours">
                          {data.projectDistribution.map((project, index) => <Cell key={project.projectId} fill={COLORS[index % COLORS.length]} stroke="transparent" />)}
                        </Pie>
                        <Tooltip contentStyle={{ backgroundColor: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "16px" }} />
                        <Legend verticalAlign="bottom" height={36} iconType="circle" />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-slate-50 text-center text-slate-500">
                      <Timer className="mb-3 h-8 w-8 text-slate-400" />
                      <p className="font-semibold text-slate-700">No project data yet.</p>
                      <button onClick={() => setManualOpen(true)} className="mt-3 rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white">Log first block</button>
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="grid gap-6 lg:grid-cols-2">
              <div className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-6 py-4"><h3 className="font-semibold">Top projects</h3></div>
                <div className="divide-y divide-slate-100">
                  {data.projectDistribution.slice().sort((a, b) => b.hours - a.hours).map((project) => (
                    <div key={project.projectId} className="flex items-center justify-between px-6 py-3">
                      <span className="font-semibold text-slate-700">{project.name}</span>
                      <span className="font-mono font-bold text-cyan-700">{project.hours.toFixed(1)}h</span>
                    </div>
                  ))}
                  {data.projectDistribution.length === 0 && <div className="px-6 py-8 text-center text-slate-500">No project activity.</div>}
                </div>
              </div>

              <div className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-6 py-4"><h3 className="font-semibold">Contributors</h3></div>
                <div className="divide-y divide-slate-100">
                  {data.userDistribution.slice().sort((a, b) => b.hours - a.hours).map((user) => (
                    <div key={user.userId} className="flex items-center justify-between px-6 py-3">
                      <span className="font-semibold text-slate-700">{user.email}</span>
                      <span className="font-mono font-bold text-cyan-700">{user.hours.toFixed(1)}h</span>
                    </div>
                  ))}
                  {data.userDistribution.length === 0 && <div className="px-6 py-8 text-center text-slate-500">No contributor activity.</div>}
                </div>
              </div>
            </section>
          </motion.div>
        )}
      </div>
      <ManualTimeDialog open={manualOpen} onOpenChange={setManualOpen} onSaved={fetchReports} />
    </main>
  );
}
