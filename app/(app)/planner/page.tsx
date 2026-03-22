import { ResourcePlanner } from "@/components/resource-planner";

export const metadata = { title: "Capacity Planner – Billabled" };

export default function PlannerPage() {
  return (
    <main className="flex flex-col p-6 sm:p-10 space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-extrabold tracking-tight text-white drop-shadow-sm">Resource Planner</h1>
        <p className="text-sm font-medium text-slate-400 max-w-2xl">
          Visualize real-time workload distributions across your workforce. Detect capacity bottlenecks and unassigned backlogs.
        </p>
      </div>

      <ResourcePlanner />
    </main>
  );
}
