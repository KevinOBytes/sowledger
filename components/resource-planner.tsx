"use client";

import { useState, useEffect } from "react";
import { ProjectTask } from "@/lib/store";
import { Users, Clock, AlertTriangle } from "lucide-react";

type Member = { id: string; email: string; displayName?: string };

export function ResourcePlanner() {
  const [members, setMembers] = useState<Member[]>([]);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchPlanner() {
      const res = await fetch("/api/planner");
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members || []);
        setTasks(data.tasks || []);
      }
      setLoading(false);
    }
    fetchPlanner();
  }, []);

  if (loading) {
    return <div className="p-8 text-slate-500 animate-pulse">Loading capacities...</div>;
  }

  // Create a bucket for each member plus one for "Unassigned"
  const memberBuckets = members.map((m) => {
    const assignedTasks = tasks.filter((t) => t.assigneeId === m.id);
    const totalHours = assignedTasks.reduce((sum, t) => sum + (t.estimatedHours || 0), 0);
    return { ...m, assignedTasks, totalHours };
  });

  const unassignedTasks = tasks.filter((t) => !t.assigneeId);
  const unassignedHours = unassignedTasks.reduce((sum, t) => sum + (t.estimatedHours || 0), 0);

  return (
    <div className="space-y-8">
      {/* Overview Stats */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-800 bg-[#0B101E] p-6 shadow-sm">
           <div className="flex items-center gap-3">
             <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400">
               <Users className="h-5 w-5" />
             </div>
             <div>
               <p className="text-sm font-medium text-slate-400">Total Team</p>
               <h3 className="text-2xl font-bold text-white">{members.length}</h3>
             </div>
           </div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-[#0B101E] p-6 shadow-sm">
           <div className="flex items-center gap-3">
             <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 text-violet-400">
               <Clock className="h-5 w-5" />
             </div>
             <div>
               <p className="text-sm font-medium text-slate-400">Total Backlog Output</p>
               <h3 className="text-2xl font-bold text-white">
                  {memberBuckets.reduce((sum, b) => sum + b.totalHours, 0) + unassignedHours} hrs
               </h3>
             </div>
           </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
          {/* Member Workloads */}
          {memberBuckets.map((bucket) => {
             const isOverloaded = bucket.totalHours > 40; // visual warning if > 40h assigned
             return (
               <div key={bucket.id} className={`rounded-2xl border bg-[#0B101E] overflow-hidden ${isOverloaded ? 'border-rose-500/50' : 'border-slate-800'}`}>
                 <div className="border-b border-slate-800 bg-slate-900/40 p-4 flex items-center justify-between">
                    <div>
                        <h4 className="font-semibold text-white">{bucket.displayName || bucket.email.split('@')[0]}</h4>
                        <p className="text-xs text-slate-400">{bucket.email}</p>
                    </div>
                    <div className={`px-2 py-1 rounded-md text-sm font-bold flex items-center gap-1 ${isOverloaded ? 'bg-rose-500/10 text-rose-400' : 'bg-cyan-500/10 text-cyan-400'}`}>
                        {isOverloaded && <AlertTriangle className="h-3 w-3" />}
                        {bucket.totalHours} hrs {bucket.assignedTasks.length > 0 && ` / ${bucket.assignedTasks.length} act`}
                    </div>
                 </div>
                 <div className="p-4 space-y-3">
                     {bucket.assignedTasks.length === 0 && (
                         <div className="text-sm text-slate-500 italic py-4 text-center border border-dashed border-slate-800 rounded-lg">No active assignments</div>
                     )}
                     {bucket.assignedTasks.map((t) => (
                         <div key={t.id} className="flex flex-col gap-1 p-3 rounded-xl bg-slate-900 border border-white/5 shadow-sm">
                             <div className="flex justify-between items-start gap-4">
                               <p className="text-sm text-slate-200 font-medium line-clamp-2">{t.title}</p>
                               <span className="text-xs font-mono text-slate-400 shrink-0">{t.estimatedHours || 0}h</span>
                             </div>
                             <div className="flex items-center gap-2 mt-2">
                                <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-slate-800 text-slate-300 tracking-wider">
                                    {t.status.replace("_", " ")}
                                </span>
                                {t.dueDate && <span className="text-[10px] text-slate-500 font-medium">Due: {t.dueDate}</span>}
                             </div>
                         </div>
                     ))}
                 </div>
               </div>
             )
          })}

          {/* Unassigned Workload */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 overflow-hidden opacity-80">
             <div className="border-b border-slate-800 p-4 flex items-center justify-between">
                <div>
                    <h4 className="font-semibold text-slate-300">Unassigned Backlog</h4>
                    <p className="text-xs text-slate-500">Tasks needing owners</p>
                </div>
                <div className="px-2 py-1 rounded-md text-sm font-bold bg-slate-800 text-slate-400">
                    {unassignedHours} hrs
                </div>
             </div>
             <div className="p-4 space-y-3">
                 {unassignedTasks.length === 0 && (
                     <div className="text-sm text-slate-600 italic py-4 text-center">Backlog is completely empty!</div>
                 )}
                 {unassignedTasks.slice(0, 10).map((t) => (
                     <div key={t.id} className="flex justify-between items-start gap-4 p-3 rounded-xl bg-[#050914] border border-white/5">
                         <p className="text-sm text-slate-400 font-medium line-clamp-1">{t.title}</p>
                         <span className="text-xs font-mono text-slate-500 shrink-0">{t.estimatedHours || 0}h</span>
                     </div>
                 ))}
                 {unassignedTasks.length > 10 && (
                     <div className="text-xs text-center font-medium text-slate-500 pt-2">+ {unassignedTasks.length - 10} more unassigned tasks</div>
                 )}
             </div>
          </div>

      </div>
    </div>
  );
}
