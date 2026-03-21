"use client";

import { useState, useEffect, DragEvent } from "react";
import { Plus, GripVertical, CheckCircle2, Circle, HelpCircle } from "lucide-react";
import { ProjectTask, KanbanColumn } from "@/lib/store";

const COLUMNS: { id: KanbanColumn; title: string, color: string }[] = [
  { id: "todo", title: "To Do", color: "text-slate-400" },
  { id: "in_progress", title: "In Progress", color: "text-cyan-400" },
  { id: "review", title: "Review", color: "text-violet-400" },
  { id: "done", title: "Done", color: "text-emerald-400" },
];

export function KanbanBoard({ projectId }: { projectId: string }) {
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);

  // New task inline state
  const [addingToCol, setAddingToCol] = useState<KanbanColumn | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");

  useEffect(() => {
    async function fetchTasks() {
      const res = await fetch(`/api/tasks?projectId=${projectId}`);
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks || []);
      }
      setLoading(false);
    }
    fetchTasks();
  }, [projectId]);

  const handleAddTask = async (status: KanbanColumn) => {
    if (!newTaskTitle.trim()) {
      setAddingToCol(null);
      return;
    }

    // eslint-disable-next-line react-hooks/purity
    const tempId = "temp-" + Date.now();
    const tempTask: ProjectTask = {
      id: tempId,
      workspaceId: "",
      projectId,
      title: newTaskTitle.trim(),
      status,
      // eslint-disable-next-line react-hooks/purity
      position: Date.now(),
      // eslint-disable-next-line react-hooks/purity
      createdAt: new Date().toISOString()
    };
    
    setTasks((prev) => [...prev, tempTask]);
    setAddingToCol(null);
    setNewTaskTitle("");

    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, title: tempTask.title, status })
    });

    if (res.ok) {
      const { task } = await res.json();
      setTasks((prev) => prev.map(t => t.id === tempId ? task : t));
    } else {
      setTasks((prev) => prev.filter(t => t.id !== tempId));
    }
  };

  const handleDragStart = (e: DragEvent, taskId: string) => {
    setDraggedTaskId(taskId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault(); 
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = async (e: DragEvent, targetStatus: KanbanColumn) => {
    e.preventDefault();
    if (!draggedTaskId) return;

    const task = tasks.find(t => t.id === draggedTaskId);
    if (!task || task.status === targetStatus) {
      setDraggedTaskId(null);
      return;
    }

    // Optimistic update
    setTasks(prev => prev.map(t => t.id === draggedTaskId ? { ...t, status: targetStatus } : t));
    setDraggedTaskId(null);

    // Call API
    await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: draggedTaskId, status: targetStatus })
    });
  };

  const deleteBtn = async (id: string) => {
     setTasks(prev => prev.filter(t => t.id !== id));
     await fetch(`/api/tasks?taskId=${id}`, { method: "DELETE" });
  };

  if (loading) return <div className="p-8 text-slate-500 animate-pulse">Loading board...</div>;

  return (
    <div className="flex h-[calc(100vh-10rem)] gap-6 overflow-x-auto pb-8">
      {COLUMNS.map((col) => {
        const colTasks = tasks
            .filter(t => t.status === col.id && !t.parentId) // Top level for now
            .sort((a,b) => a.position - b.position);

        return (
          <div 
            key={col.id} 
            className="flex w-80 shrink-0 flex-col rounded-2xl bg-slate-900/40 p-4 border border-white/5"
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, col.id)}
          >
            <div className="flex items-center justify-between mb-4 px-2">
                <div className="flex items-center gap-2">
                    <span className={`text-sm font-semibold tracking-wide uppercase ${col.color}`}>{col.title}</span>
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-xs font-medium text-slate-400">
                        {colTasks.length}
                    </span>
                </div>
                <button 
                  onClick={() => setAddingToCol(col.id)}
                  className="rounded hover:bg-white/10 p-1 text-slate-400 hover:text-white transition-colors"
                >
                    <Plus className="h-4 w-4" />
                </button>
            </div>

            <div className="flex flex-1 flex-col gap-3 overflow-y-auto min-h-[150px]">
                {colTasks.map((t) => (
                    <div 
                        key={t.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, t.id)}
                        className={`group cursor-grab active:cursor-grabbing rounded-xl border border-white/5 bg-slate-800/80 p-4 shadow-sm hover:border-cyan-500/30 hover:bg-slate-800 transition-all ${draggedTaskId === t.id ? 'opacity-50 border-cyan-500' : ''}`}
                    >
                        <div className="flex items-start justify-between">
                            <p className="text-sm font-medium text-slate-200">{t.title}</p>
                            <button onClick={() => deleteBtn(t.id)} className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400">
                                <HelpCircle className="h-4 w-4 hidden" />
                                <span className="text-xs">✕</span>
                            </button>
                        </div>
                        {t.description && (
                            <p className="mt-2 text-xs text-slate-400 line-clamp-2">{t.description}</p>
                        )}
                        <div className="mt-4 flex items-center justify-between pt-2 border-t border-white/5">
                             <div className="flex items-center gap-1.5 opacity-60">
                                <GripVertical className="h-3.5 w-3.5 text-slate-500" />
                                <span className="text-[10px] text-slate-500 font-mono">DRAG</span>
                             </div>
                             {col.id === "done" ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Circle className="h-4 w-4 text-slate-600" />}
                        </div>
                    </div>
                ))}

                {addingToCol === col.id && (
                    <div className="rounded-xl border border-cyan-500/50 bg-slate-800 p-3 shadow-lg">
                        <input 
                          autoFocus
                          type="text" 
                          placeholder="What needs to be done?"
                          className="w-full bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none"
                          value={newTaskTitle}
                          onChange={e => setNewTaskTitle(e.target.value)}
                          onKeyDown={e => {
                              if (e.key === "Enter") handleAddTask(col.id);
                              if (e.key === "Escape") setAddingToCol(null);
                          }}
                        />
                        <div className="mt-3 flex items-center justify-end gap-2">
                           <button onClick={() => setAddingToCol(null)} className="text-xs text-slate-400 hover:text-white">Cancel</button>
                           <button onClick={() => handleAddTask(col.id)} className="rounded bg-cyan-600 px-3 py-1 text-xs font-semibold text-white hover:bg-cyan-500">Save</button>
                        </div>
                    </div>
                )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
