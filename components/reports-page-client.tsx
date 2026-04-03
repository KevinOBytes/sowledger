"use client";

import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend
} from "recharts";
import { DownloadIcon, CalendarIcon } from "lucide-react";

type ReportData = {
  ok: boolean;
  totalHours: number;
  totalBillableAmount: number;
  dailyTrend: { date: string; hours: number }[];
  projectDistribution: { projectId: string; name: string; hours: number }[];
  userDistribution: { userId: string; email: string; hours: number }[];
};

const COLORS = ["#0ea5e9", "#10b981", "#8b5cf6", "#f43f5e", "#f59e0b", "#14b8a6"];

function get30DaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().split("T")[0];
}

export function ReportsPageClient() {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);

  const [startDate, setStartDate] = useState(get30DaysAgo());
  const [endDate, setEndDate] = useState(new Date().toISOString().split("T")[0]);

  useEffect(() => {
    async function fetchReports() {
      setLoading(true);
      try {
        const query = new URLSearchParams();
        if (startDate) query.append("start", startDate);
        if (endDate) query.append("end", endDate);

        const res = await fetch(`/api/reports?${query.toString()}`);
        if (res.ok) {
          const json = await res.json();
          setData(json);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    fetchReports();
  }, [startDate, endDate]);

  function exportCSV() {
    if (!data) return;

    let csv = "Report Breakdown\n\n";
    csv += `Total Hours,${data.totalHours.toFixed(2)}\n`;
    csv += `Total Billable,${data.totalBillableAmount.toFixed(2)}\n\n`;

    csv += "Project Distribution\n";
    csv += "Project,Hours\n";
    data.projectDistribution.forEach(p => {
      csv += `"${p.name}",${p.hours.toFixed(2)}\n`;
    });
    csv += "\n";

    csv += "User Distribution\n";
    csv += "User,Hours\n";
    data.userDistribution.forEach(u => {
      csv += `"${u.email}",${u.hours.toFixed(2)}\n`;
    });
    csv += "\n";

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report_${startDate}_to_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading && !data) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-slate-400">
        <div className="flex flex-col items-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-t-2 border-cyan-500"></div>
          <p>Aggregating enterprise telemetry...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col p-4 sm:p-8 max-w-7xl mx-auto w-full">
      <div className="flex flex-col sm:flex-row justify-between sm:items-end mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Workforce Intelligence</h1>
          <p className="text-slate-400">High-level analytics and capacity telemetry.</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-4 bg-slate-900 border border-slate-800 p-2 rounded-xl shadow-lg">
          <div className="flex items-center gap-2 px-2 text-sm text-slate-400">
            <CalendarIcon className="w-4 h-4" />
          </div>
          <input 
            type="date" 
            title="Start Date"
            value={startDate} 
            onChange={(e) => setStartDate(e.target.value)}
            className="bg-slate-800 border-none text-white text-sm rounded outline-none p-1.5 focus:ring-1 focus:ring-emerald-500"
          />
          <span className="text-slate-600">to</span>
          <input 
            type="date" 
            title="End Date"
            value={endDate} 
            onChange={(e) => setEndDate(e.target.value)}
            className="bg-slate-800 border-none text-white text-sm rounded outline-none p-1.5 focus:ring-1 focus:ring-emerald-500"
          />
          
          <button 
            onClick={exportCSV} 
            disabled={!data}
            className="ml-auto sm:ml-4 flex items-center gap-2 rounded-lg bg-emerald-500/10 px-4 py-1.5 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 transition disabled:opacity-50"
          >
            <DownloadIcon className="h-4 w-4" />
            Export CSV
          </button>
        </div>
      </div>

      {!data ? (
        <div className="p-8 text-center text-rose-400">Failed to load report data.</div>
      ) : (
        <div className={`transition-opacity duration-200 ${loading ? 'opacity-50' : 'opacity-100'}`}>
          <div className="mb-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-transparent opacity-0 group-hover:opacity-100 transition duration-500" />
              <h2 className="text-sm font-medium text-slate-400 relative z-10">Total Logged Hours</h2>
              <div className="mt-2 text-4xl font-bold text-white relative z-10">
                {data.totalHours.toFixed(1)} <span className="text-xl font-normal text-slate-500">hrs</span>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition duration-500" />
              <h2 className="text-sm font-medium text-slate-400 relative z-10">Total Billable Pipeline</h2>
              <div className="mt-2 text-4xl font-bold text-emerald-400 relative z-10">
                ${data.totalBillableAmount.toFixed(2)}
              </div>
            </div>
          </div>

          <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl flex flex-col">
              <h2 className="mb-6 text-lg font-semibold text-white">Daily Execution Trend</h2>
              <div className="flex-1 min-h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.dailyTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis dataKey="date" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                    <Tooltip
                      cursor={{ fill: "#1e293b" }}
                      contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px" }}
                    />
                    <Bar dataKey="hours" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl flex flex-col">
              <h2 className="mb-6 text-lg font-semibold text-white">Resource Allocation by Project</h2>
              <div className="flex-1 min-h-[300px] w-full">
                {data.projectDistribution.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={data.projectDistribution}
                        cx="50%"
                        cy="50%"
                        innerRadius={80}
                        outerRadius={120}
                        paddingAngle={5}
                        dataKey="hours"
                      >
                        {data.projectDistribution.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="rgba(0,0,0,0)" />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px" }}
                      />
                      <Legend verticalAlign="bottom" height={36} iconType="circle" />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-slate-500">
                    No project data mapped
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-2xl border border-slate-800 bg-slate-900 shadow-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-800 bg-slate-800/20">
                    <h3 className="font-semibold text-white">Top Projects</h3>
                </div>
                <div className="divide-y divide-slate-800">
                    {data.projectDistribution.slice().sort((a,b) => b.hours - a.hours).map((p) => (
                        <div key={p.projectId} className="px-6 py-3 flex justify-between items-center bg-slate-900 hover:bg-slate-800/50 transition">
                            <span className="text-slate-300 font-medium">{p.name}</span>
                            <span className="text-emerald-400 font-mono">{p.hours.toFixed(1)}h</span>
                        </div>
                    ))}
                    {data.projectDistribution.length === 0 && (
                        <div className="px-6 py-8 text-center text-slate-500">No project activity.</div>
                    )}
                </div>
            </div>
            
            <div className="rounded-2xl border border-slate-800 bg-slate-900 shadow-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-800 bg-slate-800/20">
                    <h3 className="font-semibold text-white">Top Contributors</h3>
                </div>
                <div className="divide-y divide-slate-800">
                    {data.userDistribution.slice().sort((a,b) => b.hours - a.hours).map((u) => (
                        <div key={u.userId} className="px-6 py-3 flex justify-between items-center bg-slate-900 hover:bg-slate-800/50 transition">
                            <span className="text-slate-300 font-medium">{u.email}</span>
                            <span className="text-cyan-400 font-mono">{u.hours.toFixed(1)}h</span>
                        </div>
                    ))}
                    {data.userDistribution.length === 0 && (
                        <div className="px-6 py-8 text-center text-slate-500">No user activity.</div>
                    )}
                </div>
            </div>
          </div>
          
        </div>
      )}
    </div>
  );
}
