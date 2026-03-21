import { requireSession } from "@/lib/auth";
import { store } from "@/lib/store";
import { redirect } from "next/navigation";
import { KanbanBoard } from "@/components/kanban-board";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export async function generateMetadata({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = store.projects.get(projectId);
  return { title: project ? `${project.name} Board – Timely` : "Board – Timely" };
}

export default async function ProjectBoardPage({ params }: { params: Promise<{ projectId: string }> }) {
  const session = await requireSession();
  const { projectId } = await params;
  
  const project = store.projects.get(projectId);
  if (!project || project.workspaceId !== session.workspaceId) {
    redirect("/projects");
  }

  return (
    <main className="flex h-screen flex-col bg-[#050914] p-6 sm:p-10">
      <div className="mb-8">
        <Link href="/projects" className="inline-flex items-center gap-2 text-sm font-medium text-slate-400 hover:text-cyan-400 transition-colors mb-4">
            <ChevronLeft className="h-4 w-4" /> Back to Projects
        </Link>
        <div className="flex items-center justify-between">
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-white">{project.name}</h1>
                <p className="mt-2 text-sm text-slate-400">Manage your tasks and drag them across stages to track execution.</p>
            </div>
            <div className="hidden sm:flex items-center gap-4">
                <div className="rounded-full border border-white/5 bg-white/5 px-4 py-1.5 text-sm font-medium text-slate-300">
                    {project.billingModel === "hourly" ? "Hourly Billing" : "Fixed Fee"}
                </div>
            </div>
        </div>
      </div>

      {/* The interactive board expands to fill space */}
      <div className="flex-1 overflow-hidden">
        <KanbanBoard projectId={project.id} />
      </div>
    </main>
  );
}
