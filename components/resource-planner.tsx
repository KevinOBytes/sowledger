"use client";

import { useState, useEffect } from "react";
import { ProjectTask } from "@/lib/store";
import { Users, Clock, AlertTriangle } from "lucide-react";

type Member = { id: string; email: string; displayName?: string };
type WorkspaceGoal = {
  id: string;
  name: string;
  assignedUserId: string | null;
  targetType: "hours" | "amount";
  targetHours: number | null;
  targetAmount: number | null;
  recurrence: string;
  dueDate: string | null;
};

export function ResourcePlanner() {
  const [members, setMembers] = useState<Member[]>([]);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [goals, setGoals] = useState<WorkspaceGoal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchPlanner() {
      const res = await fetch("/api/planner");
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members || []);
        setTasks(data.tasks || []);
        setGoals(data.goals || []);
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
    const assignedGoals = goals.filter((g) => g.assignedUserId === m.id);
    const totalHours = assignedTasks.reduce((sum, t) => sum + (t.estimatedHours || 0), 0) + assignedGoals.reduce((sum, g) => sum + (g.targetType === "hours" ? (g.targetHours || 0) : 0), 0);
    return { ...m, assignedTasks, assignedGoals, totalHours };
  });

  const unassignedTasks = tasks.filter((t) => !t.assigneeId);
  const unassignedHours = unassignedTasks.reduce((sum, t) => sum + (t.estimatedHours || 0), 0);

  return (
    <div className="space-y-8">
      {/* Overview Stats */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
           <div className="flex items-center gap-3">
             <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
               <Users className="h-5 w-5" />
             </div>
             <div>
               <p className="text-sm font-medium text-stone-500">Total team</p>
               <h3 className="text-2xl font-bold text-[#17211d]">{members.length}</h3>
             </div>
           </div>
        </div>
        <div className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
           <div className="flex items-center gap-3">
             <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
               <Clock className="h-5 w-5" />
             </div>
             <div>
               <p className="text-sm font-medium text-stone-500">Total backlog output</p>
               <h3 className="text-2xl font-bold text-[#17211d]">
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
               <div key={bucket.id} className={`overflow-hidden rounded-[28px] border bg-white shadow-sm ${isOverloaded ? 'border-rose-200' : 'border-stone-200'}`}>
                 <div className="flex items-center justify-between border-b border-stone-100 bg-stone-50/70 p-4">
                    <div>
                        <h4 className="font-semibold text-[#17211d]">{bucket.displayName || bucket.email.split('@')[0]}</h4>
                        <p className="text-xs text-stone-500">{bucket.email}</p>
                    </div>
                    <div className={`flex items-center gap-1 rounded-full px-3 py-1 text-sm font-bold ${isOverloaded ? 'bg-rose-50 text-rose-700' : 'bg-teal-50 text-teal-700'}`}>
                        {isOverloaded && <AlertTriangle className="h-3 w-3" />}
                        {bucket.totalHours} hrs {bucket.assignedTasks.length > 0 && ` / ${bucket.assignedTasks.length} act`} {bucket.assignedGoals.length > 0 && ` / ${bucket.assignedGoals.length} goals`}
                    </div>
                 </div>
                 <div className="p-4 space-y-3">
                     {bucket.assignedTasks.length === 0 && bucket.assignedGoals.length === 0 && (
                         <div className="rounded-2xl border border-dashed border-stone-200 py-4 text-center text-sm italic text-stone-500">No active assignments or goals</div>
                     )}
                     
                     {/* Goals Section */}
                     {bucket.assignedGoals.length > 0 && (
                         <div className="mb-4">
                             <h5 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-stone-400">Active goals</h5>
                             <div className="space-y-2">
                                 {bucket.assignedGoals.map((g: WorkspaceGoal) => (
                                     <div key={g.id} className="flex items-start justify-between gap-4 rounded-2xl border border-teal-100 bg-teal-50/70 p-2.5 shadow-sm">
                                         <div>
                                            <p className="line-clamp-2 text-sm font-medium text-teal-900">{g.name}</p>
                                            <div className="flex items-center gap-2 mt-1">
                                                {g.recurrence !== 'none' && <span className="flex items-center gap-1 rounded-full bg-white px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-teal-700">{g.recurrence}</span>}
                                                {g.dueDate && <span className="text-[10px] font-medium text-stone-500">Due: {new Date(g.dueDate).toLocaleDateString()}</span>}
                                            </div>
                                         </div>
                                         <span className="shrink-0 font-mono text-xs font-bold text-teal-700">{g.targetType === 'hours' ? `${g.targetHours || 0}h` : `$${g.targetAmount || 0}`}</span>
                                     </div>
                                 ))}
                             </div>
                         </div>
                     )}

                     {/* Tasks Section */}
                     {bucket.assignedTasks.length > 0 && (
                         <div>
                             <h5 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-stone-400">Assigned tasks</h5>
                             <div className="space-y-2">
                     {bucket.assignedTasks.map((t) => (
                         <div key={t.id} className="flex flex-col gap-1 rounded-2xl border border-stone-200 bg-stone-50 p-3 shadow-sm">
                             <div className="flex justify-between items-start gap-4">
                               <p className="line-clamp-2 text-sm font-medium text-[#17211d]">{t.title}</p>
                               <span className="shrink-0 font-mono text-xs text-stone-500">{t.estimatedHours || 0}h</span>
                             </div>
                             <div className="flex items-center gap-2 mt-2">
                                <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-stone-600">
                                    {t.status.replace("_", " ")}
                                </span>
                                {t.dueDate && <span className="text-[10px] font-medium text-stone-500">Due: {String(t.dueDate)}</span>}
                             </div>
                         </div>
                     ))}
                             </div>
                         </div>
                     )}
                 </div>
               </div>
             )
          })}

          {/* Unassigned Workload */}
          <div className="overflow-hidden rounded-[28px] border border-dashed border-stone-300 bg-white/70">
             <div className="flex items-center justify-between border-b border-stone-200 p-4">
                <div>
                    <h4 className="font-semibold text-[#17211d]">Unassigned backlog</h4>
                    <p className="text-xs text-stone-500">Tasks needing owners</p>
                </div>
                <div className="rounded-full bg-stone-100 px-3 py-1 text-sm font-bold text-stone-600">
                    {unassignedHours} hrs
                </div>
             </div>
             <div className="p-4 space-y-3">
                 {unassignedTasks.length === 0 && goals.filter(g => !g.assignedUserId).length === 0 && (
                     <div className="py-4 text-center text-sm italic text-stone-500">Backlog is completely empty!</div>
                 )}

                 {/* Unassigned Goals */}
                 {goals.filter(g => !g.assignedUserId).map(g => (
                     <div key={g.id} className="flex items-start justify-between gap-4 rounded-2xl border border-teal-100 bg-teal-50/50 p-3 shadow-sm">
                         <div>
                             <p className="line-clamp-2 text-sm font-medium text-teal-900">{g.name}</p>
                             <p className="mt-1 text-[10px] uppercase tracking-widest text-stone-500">Goal</p>
                         </div>
                     </div>
                 ))}

                 {/* Unassigned Tasks */}
                 {unassignedTasks.slice(0, 10).map((t) => (
                     <div key={t.id} className="flex items-start justify-between gap-4 rounded-2xl border border-stone-200 bg-white p-3">
                         <p className="line-clamp-1 text-sm font-medium text-stone-700">{t.title}</p>
                         <span className="shrink-0 font-mono text-xs text-stone-500">{t.estimatedHours || 0}h</span>
                     </div>
                 ))}
                 {unassignedTasks.length > 10 && (
                     <div className="pt-2 text-center text-xs font-medium text-stone-500">+ {unassignedTasks.length - 10} more unassigned tasks</div>
                 )}
             </div>
          </div>

      </div>
    </div>
  );
}
