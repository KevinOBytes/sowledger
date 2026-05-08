"use client";

import type { ReactNode } from "react";
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
import { AlertTriangle, CalendarIcon, DownloadIcon, LineChart, Search, Timer, TrendingUp } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

import {
  AppEmptyState,
  AppMetricCard,
  AppPageHeader,
  AppPageShell,
  AppWorkflowRail,
} from "@/components/app-page-shell";
import { ManualTimeDialog } from "@/components/manual-time-dialog";

type ReportData = {
  ok: boolean;
  scope: "mine" | "team";
  totalHours: number;
  totalBillableAmount: number;
  plannedHours: number;
  manualHours: number;
  timerHours: number;
  calendarHours: number;
  utilization: number | null;
  missedBlocks: number;
  dailyTrend: { date: string; hours: number }[];
  projectDistribution: { projectId: string; name: string; hours: number }[];
  userDistribution: { userId: string; email: string; hours: number }[];
};

type IntelligenceItem = {
  id?: string;
  clientName?: string;
  projectName?: string;
  title?: string;
  reason?: string;
  notes?: string;
  amount?: number;
  amountAtRisk?: number;
  leakAmount?: number;
  recoverableAmount?: number;
  plannedHours?: number;
  actualHours?: number;
  missingHours?: number;
  hours?: number;
};

type RevenueIntelligenceData = {
  ok: boolean;
  summary?: Record<string, unknown>;
  retainerRisks?: IntelligenceItem[];
  recoveryOpportunities?: IntelligenceItem[];
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

function money(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return `$${value.toFixed(value >= 100 ? 0 : 2)}`;
}

function itemAmount(item: IntelligenceItem, keys: (keyof IntelligenceItem)[]) {
  for (const key of keys) {
    const formatted = money(item[key] as number | undefined);
    if (formatted) return formatted;
  }
  return null;
}

async function fetchJson<T>(url: string, fallbackMessage: string): Promise<T> {
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) throw new Error(json.error || fallbackMessage);
  return json as T;
}

export function ReportsPageClient() {
  const [data, setData] = useState<ReportData | null>(null);
  const [intelligence, setIntelligence] = useState<RevenueIntelligenceData | null>(null);
  const [intelligenceLoading, setIntelligenceLoading] = useState(false);
  const [intelligenceError, setIntelligenceError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<"mine" | "team">("mine");
  const [startDate, setStartDate] = useState(get30DaysAgo());
  const [endDate, setEndDate] = useState(new Date().toISOString().split("T")[0]);
  const [manualOpen, setManualOpen] = useState(false);

  async function fetchReports() {
    setLoading(true);
    setIntelligenceLoading(true);
    setIntelligenceError(null);
    try {
      const query = new URLSearchParams({ scope });
      if (startDate) query.append("start", startDate);
      if (endDate) query.append("end", endDate);
      const queryString = query.toString();
      const [reportResult, intelligenceResult] = await Promise.allSettled([
        fetchJson<ReportData>(`/api/reports?${queryString}`, "Unable to load analytics"),
        fetchJson<RevenueIntelligenceData>(`/api/revenue-intelligence?${queryString}`, "Unable to load revenue intelligence"),
      ]);

      if (reportResult.status === "fulfilled") {
        setData(reportResult.value);
      } else {
        setData(null);
        if (scope === "team") setScope("mine");
        toast.error("Analytics unavailable", { description: reportResult.reason instanceof Error ? reportResult.reason.message : "Unknown error" });
      }

      if (intelligenceResult.status === "fulfilled") {
        setIntelligence(intelligenceResult.value);
      } else {
        setIntelligence(null);
        setIntelligenceError(intelligenceResult.reason instanceof Error ? intelligenceResult.reason.message : "Unable to load revenue intelligence");
      }
    } finally {
      setLoading(false);
      setIntelligenceLoading(false);
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
    if (scope !== "team") {
      toast.error("CSV export unavailable for personal analytics", {
        description: "Use team analytics or the Exports page person filter so exported data matches the visible scope.",
      });
      return;
    }
    const query = new URLSearchParams({ format: "csv", scope, start: startDate, end: endDate, include: "projects,timeEntries,users,schedule" });
    window.location.href = `/api/export/csv?${query.toString()}`;
  }

  const analyticsExportUnavailable = scope !== "team";

  return (
    <>
      <AppPageShell>
        <AppPageHeader
          eyebrow="Analytics"
          title="Work performance and billable output"
          description="Track planned vs actual work, manual vs timer entries, utilization, project allocation, and export-ready billing signals."
          icon={LineChart}
          metadata={[
            { label: scope === "mine" ? "My analytics" : "Team analytics", tone: "cyan", icon: TrendingUp },
            { label: `${startDate || "Open"} to ${endDate || "today"}`, tone: "slate", icon: CalendarIcon },
          ]}
          secondaryAction={(
            <button
              onClick={() => setManualOpen(true)}
              className="inline-flex w-full items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:border-cyan-300 hover:text-cyan-700 sm:w-auto"
            >
              Log time
            </button>
          )}
          primaryAction={(
            <button
              onClick={exportAnalytics}
              disabled={!data || analyticsExportUnavailable}
              title={analyticsExportUnavailable ? "CSV export is available from team analytics or the Exports page person filter." : "Export visible team analytics to CSV"}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50 sm:w-auto"
            >
              <DownloadIcon className="h-4 w-4" />
              {analyticsExportUnavailable ? "Export CSV unavailable" : "Export CSV"}
            </button>
          )}
        />

        <AppWorkflowRail current="review" />

        <section className="flex flex-col gap-3 rounded-[32px] border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="inline-flex w-full rounded-full bg-slate-100 p-1 text-sm font-bold shadow-inner sm:w-auto">
            {(["mine", "team"] as const).map((option) => (
              <button
                key={option}
                onClick={() => setScope(option)}
                className={`flex-1 rounded-full px-4 py-2 text-sm font-bold capitalize transition sm:flex-none ${scope === option ? "bg-slate-950 text-white shadow-sm" : "text-slate-500 hover:text-slate-950"}`}
              >
                {option === "mine" ? "My analytics" : "Team analytics"}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
              <CalendarIcon className="h-4 w-4" />
              Date range
            </div>
            <input type="date" title="Start Date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-10 min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-cyan-500" />
            <span className="hidden text-slate-400 sm:inline">to</span>
            <input type="date" title="End Date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-10 min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-cyan-500" />
          </div>
        </section>

        <RevenueIntelligenceSection
          intelligence={intelligence}
          loading={intelligenceLoading}
          error={intelligenceError}
        />

        {!data ? (
          loading ? (
            <section className="flex min-h-[360px] flex-col items-center justify-center rounded-[32px] border border-slate-200 bg-white p-10 text-center shadow-sm" aria-live="polite">
              <div className="mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-t-2 border-cyan-600" />
              <h2 className="text-xl font-semibold text-slate-950">Loading analytics...</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">Preparing your planned vs actual, recovery, utilization, and billable output views.</p>
            </section>
          ) : (
            <AppEmptyState
              icon={AlertTriangle}
              title="Failed to load analytics."
              description="Try a narrower date range or switch back to my analytics if team reporting is restricted."
              action={(
                <button
                  onClick={() => fetchReports().catch(() => null)}
                  className="rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800"
                >
                  Retry analytics
                </button>
              )}
            />
          )
        ) : (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className={`space-y-6 transition-opacity ${loading ? "opacity-60" : "opacity-100"}`}>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <AppMetricCard label="Logged hours" value={metric(data.totalHours, "h")} detail="Actual time in this range." accent="slate" icon={Timer} />
              <AppMetricCard label="Planned hours" value={metric(data.plannedHours, "h")} detail="Scheduled work for comparison." accent="slate" icon={CalendarIcon} />
              <AppMetricCard label="Utilization" value={utilizationLabel} detail="Actual time against plan." accent="cyan" icon={TrendingUp} />
              <AppMetricCard
                label="Manual vs timer"
                value={metric(data.manualHours, "h")}
                detail={`manual / ${metric(data.timerHours, "h")} timer / ${metric(data.calendarHours, "h")} calendar`}
                accent="slate"
                icon={Timer}
              />
              <AppMetricCard
                label="Billable pipeline"
                value={`$${data.totalBillableAmount.toFixed(0)}`}
                detail={`${data.missedBlocks} missed scheduled work item(s)`}
                accent="emerald"
                icon={DownloadIcon}
              />
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
      </AppPageShell>
      <ManualTimeDialog open={manualOpen} onOpenChange={setManualOpen} onSaved={fetchReports} />
    </>
  );
}

function RevenueIntelligenceSection({
  intelligence,
  loading,
  error,
}: {
  intelligence: RevenueIntelligenceData | null;
  loading: boolean;
  error: string | null;
}) {
  const risks = intelligence?.retainerRisks || [];
  const opportunities = intelligence?.recoveryOpportunities || [];

  return (
    <section className="grid gap-6 lg:grid-cols-2">
      <IntelligencePanel
        title="Retainer Leak Radar"
        description="Spot retained work trending past plan before it leaks margin."
        icon={<AlertTriangle className="h-5 w-5 text-amber-600" />}
        items={risks}
        empty="No retainer leaks detected for this range."
        amountKeys={["amountAtRisk", "leakAmount", "amount"]}
        loading={loading}
        error={error}
      />
      <IntelligencePanel
        title="Missing Billable Recovery"
        description="Find completed work that looks recoverable but has not reached the billable pipeline."
        icon={<Search className="h-5 w-5 text-cyan-700" />}
        items={opportunities}
        empty="No missing billable recovery opportunities found."
        amountKeys={["recoverableAmount", "amount", "amountAtRisk"]}
        loading={loading}
        error={error}
      />
    </section>
  );
}

function IntelligencePanel({
  title,
  description,
  icon,
  items,
  empty,
  amountKeys,
  loading,
  error,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  items: IntelligenceItem[];
  empty: string;
  amountKeys: (keyof IntelligenceItem)[];
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            {icon}
            {title}
          </h2>
          <p className="mt-2 text-sm text-slate-500">{description}</p>
        </div>
        {loading && <div className="h-5 w-5 animate-spin rounded-full border-b-2 border-t-2 border-cyan-600" />}
      </div>

      <div className="mt-5 space-y-3">
        {error ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
            Revenue intelligence is unavailable: {error}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
            {empty}
          </div>
        ) : (
          items.map((item, index) => {
            const amount = itemAmount(item, amountKeys);
            const label = item.title || item.projectName || item.clientName || `Signal ${index + 1}`;
            const detail = item.reason || item.notes || "Review this billing signal before the next approval cycle.";
            const flaggedHours = [item.missingHours, item.hours, item.plannedHours].find(
              (value): value is number => typeof value === "number" && Number.isFinite(value),
            );
            const actualHours = typeof item.actualHours === "number" && Number.isFinite(item.actualHours) ? item.actualHours : null;
            return (
              <article key={item.id || `${label}-${index}`} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h3 className="font-bold text-slate-950">{label}</h3>
                    <p className="mt-1 text-sm text-slate-500">{detail}</p>
                    {flaggedHours != null && (
                      <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                        {metric(flaggedHours, "h")} flagged
                        {actualHours != null ? ` / ${metric(actualHours, "h")} actual` : ""}
                      </p>
                    )}
                  </div>
                  {amount && <span className="shrink-0 rounded-full bg-white px-3 py-1 text-sm font-bold text-emerald-700">{amount}</span>}
                </div>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
