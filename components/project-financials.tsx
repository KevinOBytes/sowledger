import { db } from "@/lib/db";
import { timeEntries, projects as projectsTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { TrendingUp, Clock, DollarSign, AlertTriangle } from "lucide-react";

export async function ProjectFinancials({ projectId }: { projectId: string }) {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) return null;

  const entries = await db.select().from(timeEntries).where(eq(timeEntries.projectId, projectId));

  let totalDurationSeconds = 0;
  let totalBilledAmount = 0;
  let unbilledSeconds = 0;

  for (const entry of entries) {
    if (entry.durationSeconds) {
      totalDurationSeconds += entry.durationSeconds;
      
      const rate = entry.hourlyRate || project.hourlyRate || 0;
      const amount = (entry.durationSeconds / 3600) * rate;
      totalBilledAmount += amount;

      if (entry.status !== "invoiced") {
        unbilledSeconds += entry.durationSeconds;
      }
    }
  }

  const totalHours = totalDurationSeconds / 3600;
  const unbilledHours = unbilledSeconds / 3600;

  // Determine budget status
  let budgetUsagePercent = 0;
  let overBudget = false;
  let nearBudget = false;

  if (project.budgetType === "hours" && project.budgetAmount) {
     budgetUsagePercent = (totalHours / project.budgetAmount) * 100;
  } else if (project.budgetType === "fees" && project.budgetAmount) {
     budgetUsagePercent = (totalBilledAmount / project.budgetAmount) * 100;
  }

  if (budgetUsagePercent >= 100) {
      overBudget = true;
  } else if (budgetUsagePercent >= project.budgetAlertThreshold) {
      nearBudget = true;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
      <div className="rounded-2xl border border-white/5 bg-[#0a0f1c] p-5 flex flex-col justify-between">
         <div className="flex items-center gap-2 text-slate-400 mb-2">
            <Clock className="w-4 h-4 text-cyan-400" />
            <span className="text-sm font-medium">Logged Hours</span>
         </div>
         <div className="text-2xl font-bold text-white">
            {totalHours.toFixed(1)} <span className="text-sm text-slate-500 font-normal">hrs</span>
         </div>
      </div>

      <div className="rounded-2xl border border-white/5 bg-[#0a0f1c] p-5 flex flex-col justify-between">
         <div className="flex items-center gap-2 text-slate-400 mb-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-medium">Unbilled Time</span>
         </div>
         <div className="text-2xl font-bold text-white">
            {unbilledHours.toFixed(1)} <span className="text-sm text-slate-500 font-normal">hrs</span>
         </div>
      </div>

      <div className="rounded-2xl border border-white/5 bg-[#0a0f1c] p-5 flex flex-col justify-between">
         <div className="flex items-center gap-2 text-slate-400 mb-2">
            <DollarSign className="w-4 h-4 text-indigo-400" />
            <span className="text-sm font-medium">Accrued Value</span>
         </div>
         <div className="text-2xl font-bold text-white">
            ${totalBilledAmount.toFixed(2)}
         </div>
      </div>

      <div className={`rounded-2xl border p-5 flex flex-col justify-between ${overBudget ? 'border-rose-500/30 bg-rose-500/5' : nearBudget ? 'border-amber-500/30 bg-amber-500/5' : 'border-white/5 bg-[#0a0f1c]'}`}>
         <div className="flex items-center gap-2 text-slate-400 mb-2">
            {overBudget ? <AlertTriangle className="w-4 h-4 text-rose-500" /> : nearBudget ? <AlertTriangle className="w-4 h-4 text-amber-500" /> : <div className="w-4 h-4 rounded-full border-2 border-emerald-500/50" />}
            <span className="text-sm font-medium">Budget ({project.budgetType === "hours" ? "Hours" : project.budgetType === "fees" ? "Fees" : "None"})</span>
         </div>
         <div className="text-2xl font-bold text-white">
            {project.budgetType === "none" ? (
               <span className="text-slate-600">No limit</span>
            ) : (
               <>
                 <span className={overBudget ? 'text-rose-400' : ''}>{budgetUsagePercent.toFixed(0)}%</span> 
                 <span className="text-sm text-slate-500 font-normal mx-1">of</span>
                 <span className="text-sm font-medium text-slate-400">{project.budgetType === "hours" ? `${project.budgetAmount}h` : `$${project.budgetAmount}`}</span>
               </>
            )}
         </div>
         {project.budgetType !== "none" && (
             <div className="w-full bg-black/40 rounded-full h-1.5 mt-3 overflow-hidden">
                 <div 
                    className={`h-full rounded-full ${overBudget ? 'bg-rose-500' : nearBudget ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${Math.min(budgetUsagePercent, 100)}%` }}
                 />
             </div>
         )}
      </div>
    </div>
  );
}
