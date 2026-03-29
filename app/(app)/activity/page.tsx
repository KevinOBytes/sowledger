"use client";

import { useEffect, useState } from "react";
import { Plus, LayoutList } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

type Entry = {
  id: string;
  projectId: string;
  projectName: string;
  taskId: string;
  description: string;
  startedAt: string;
  stoppedAt: string;
  durationSeconds: number;
  status: string;
  source: string;
};

type Project = {
  id: string;
  name: string;
};

export default function ActivityPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  // Manual Entry Form State
  const [showManualForm, setShowManualForm] = useState(false);
  const [taskId, setTaskId] = useState("MANUAL-1");
  const [startedAtDate, setStartedAtDate] = useState("");
  const [startedAtTime, setStartedAtTime] = useState("");
  const [stoppedAtDate, setStoppedAtDate] = useState("");
  const [stoppedAtTime, setStoppedAtTime] = useState("");
  
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [description, setDescription] = useState("");

  const fetchEntries = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/timer/list?limit=100");
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries ?? []);
      }
    } catch {
      toast.error("Failed to load activity feed.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEntries();
    fetch("/api/projects").then(res => res.json()).then(data => {
      if (data.projects) setProjects(data.projects);
    }).catch(() => null);
  }, []);

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startedAtDate || !startedAtTime || !stoppedAtDate || !stoppedAtTime) {
      toast.error("Start and end times are required.");
      return;
    }
    
    // Construct local Date objects and then format to ISO string to send
    const startObj = new Date(`${startedAtDate}T${startedAtTime}`);
    const stopObj = new Date(`${stoppedAtDate}T${stoppedAtTime}`);

    try {
      const res = await fetch("/api/timer/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId,
          projectId: projectId || undefined,
          description: description || undefined,
          startedAt: startObj.toISOString(),
          stoppedAt: stopObj.toISOString(),
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast.success("Retroactive entry logged successfully.");
      setShowManualForm(false);
      fetchEntries(); // Reload table
      
      // Reset form
      setTaskId("MANUAL-1");
      setDescription("");
      setStartedAtDate("");
      setStartedAtTime("");
      setStoppedAtDate("");
      setStoppedAtTime("");

    } catch (err) {
      toast.error("Could not save manual entry", { 
        description: (err as Error).message || "Unknown error" 
      });
    }
  };

  function fmtDuration(seconds: number | null) {
    if (seconds == null) return "—";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${String(m).padStart(2, '0')}m`;
  }

  return (
    <div className="flex flex-1 flex-col p-4 sm:p-8">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
            <LayoutList className="h-6 w-6 text-cyan-500" />
            Timesheet & Activity
          </h1>
          <p className="mt-2 text-slate-400">View your historical logs and insert manual time blocks.</p>
        </div>
        <button
          onClick={() => setShowManualForm(!showManualForm)}
          className="flex items-center gap-2 rounded-xl bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white shadow-xl shadow-cyan-600/20 transition hover:bg-cyan-500"
        >
          {showManualForm ? "Cancel" : <><Plus className="h-4 w-4" /> Log Manual Time</>}
        </button>
      </div>

      <AnimatePresence>
        {showManualForm && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="mb-8 overflow-hidden rounded-2xl border border-white/10 bg-black/40 p-6 shadow-2xl backdrop-blur-sm"
          >
            <form onSubmit={handleManualSubmit} className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-4">
                <div>
                  <label htmlFor="taskId" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">Task Reference</label>
                  <input
                    id="taskId"
                    value={taskId} onChange={(e) => setTaskId(e.target.value)} required
                    className="w-full rounded-xl border border-white/10 bg-slate-900/50 px-4 py-2.5 text-sm text-white focus:border-cyan-500/50 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="projectId" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">Project</label>
                  <select
                    id="projectId"
                    value={projectId} onChange={(e) => setProjectId(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-900/50 px-4 py-3 text-sm text-white focus:border-cyan-500/50 focus:outline-none"
                  >
                    <option value="">— Unassigned —</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="description" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">Description</label>
                  <textarea
                    id="description"
                    value={description} onChange={(e) => setDescription(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-900/50 px-4 py-2.5 text-sm text-white focus:border-cyan-500/50 focus:outline-none"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="startedAtDate" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">Start Date</label>
                    <input
                      id="startedAtDate"
                      title="startedAtDate"
                      type="date" value={startedAtDate} onChange={(e) => setStartedAtDate(e.target.value)} required
                      className="w-full rounded-xl border border-white/10 bg-slate-900/50 px-4 py-2 text-sm text-slate-300 dark:[color-scheme:dark]"
                    />
                  </div>
                  <div>
                    <label htmlFor="startedAtTime" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">Start Time</label>
                    <input
                      id="startedAtTime"
                      title="startedAtTime"
                      type="time" value={startedAtTime} onChange={(e) => setStartedAtTime(e.target.value)} required
                      className="w-full rounded-xl border border-white/10 bg-slate-900/50 px-4 py-2 text-sm text-slate-300 dark:[color-scheme:dark]"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="stoppedAtDate" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">End Date</label>
                    <input
                      id="stoppedAtDate"
                      title="stoppedAtDate"
                      type="date" value={stoppedAtDate} onChange={(e) => setStoppedAtDate(e.target.value)} required
                      className="w-full rounded-xl border border-white/10 bg-slate-900/50 px-4 py-2 text-sm text-slate-300 dark:[color-scheme:dark]"
                    />
                  </div>
                  <div>
                    <label htmlFor="stoppedAtTime" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">End Time</label>
                    <input
                      id="stoppedAtTime"
                      title="stoppedAtTime"
                      type="time" value={stoppedAtTime} onChange={(e) => setStoppedAtTime(e.target.value)} required
                      className="w-full rounded-xl border border-white/10 bg-slate-900/50 px-4 py-2 text-sm text-slate-300 dark:[color-scheme:dark]"
                    />
                  </div>
                </div>
                <div className="pt-2">
                  <button type="submit" className="w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 shadow-xl shadow-violet-500/20">
                    Save Manual Entry
                  </button>
                </div>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 shadow-2xl overflow-hidden backdrop-blur-md">
        {loading ? (
          <div className="p-8 text-center text-slate-500 animate-pulse">Loading timesheet...</div>
        ) : entries.length === 0 ? (
          <div className="p-12 text-center text-slate-500">No time entries recorded yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-400">
              <thead className="bg-slate-900/80 text-xs uppercase bg-black/20 text-slate-500">
                <tr>
                  <th className="px-6 py-4 font-semibold tracking-wider">Date</th>
                  <th className="px-6 py-4 font-semibold tracking-wider">Task / Workspace</th>
                  <th className="px-6 py-4 font-semibold tracking-wider">Time Block</th>
                  <th className="px-6 py-4 font-semibold tracking-wider">Duration</th>
                  <th className="px-6 py-4 font-semibold tracking-wider">Status</th>
                  <th className="px-6 py-4 font-semibold tracking-wider">Src</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50 text-slate-300">
                {entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-white/[0.02] transition">
                    <td className="whitespace-nowrap px-6 py-4 font-medium text-white">
                      {new Date(entry.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <span className="font-semibold text-slate-200">{entry.description || entry.taskId || "No description"}</span>
                        {entry.projectName && <span className="text-xs text-cyan-400/80">{entry.projectName}</span>}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-xs font-mono">
                      {new Date(entry.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} -{" "}
                      {entry.stoppedAt ? new Date(entry.stoppedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : <span className="text-emerald-400 animate-pulse">Running</span>}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 font-mono font-bold text-white">
                      {fmtDuration(entry.durationSeconds)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        entry.status === 'approved' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 
                        entry.status === 'invoiced' ? 'bg-violet-500/10 text-violet-400 border border-violet-500/20' :
                        'bg-slate-800 text-slate-400 border border-white/10'
                      }`}>
                        {entry.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-xs uppercase tracking-widest text-slate-500">
                      {entry.source}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
