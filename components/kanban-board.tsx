"use client";

import { useState, useEffect, DragEvent } from "react";
import { Plus, GripVertical, CheckCircle2, Circle, HelpCircle, Lock, Paperclip, X, Link as LinkIcon, ExternalLink } from "lucide-react";
import { ProjectTask, KanbanColumn } from "@/lib/store";

const COLUMNS: { id: KanbanColumn; title: string, color: string }[] = [
  { id: "todo", title: "To Do", color: "text-stone-500" },
  { id: "in_progress", title: "In Progress", color: "text-teal-700" },
  { id: "review", title: "Review", color: "text-amber-700" },
  { id: "done", title: "Done", color: "text-emerald-700" },
];

export function KanbanBoard({ projectId }: { projectId: string }) {
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);

  // New task inline state
  const [addingToCol, setAddingToCol] = useState<KanbanColumn | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");

  const [selectedTask, setSelectedTask] = useState<ProjectTask | null>(null);
  const [newAttachmentName, setNewAttachmentName] = useState("");
  const [newAttachmentUrl, setNewAttachmentUrl] = useState("");
  const [isPatching, setIsPatching] = useState(false);

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
      createdAt: new Date(),
      blockedByTaskIds: [],
      parentId: null,
      description: null,
      dueDate: null,
      assigneeId: null,
      attachments: null,
      estimatedHours: null,
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

  const isBlocked = (taskT: ProjectTask) => {
    if (!taskT.blockedByTaskIds || taskT.blockedByTaskIds.length === 0) return false;
    return taskT.blockedByTaskIds.some(blockerId => {
      const blocker = tasks.find(x => x.id === blockerId);
      return blocker && blocker.status !== "done";
    });
  };

  const handleDrop = async (e: DragEvent, targetStatus: KanbanColumn) => {
    e.preventDefault();
    if (!draggedTaskId) return;

    const task = tasks.find(t => t.id === draggedTaskId);
    if (!task || task.status === targetStatus) {
      setDraggedTaskId(null);
      return;
    }

    if ((targetStatus === "done" || targetStatus === "review") && isBlocked(task)) {
      alert("This task is blocked by incomplete dependencies. You cannot move it to Review or Done until all blockers are complete.");
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

  const deleteBtn = async (id: string, e?: React.MouseEvent) => {
     if (e) e.stopPropagation();
     setTasks(prev => prev.filter(t => t.id !== id));
     await fetch(`/api/tasks?taskId=${id}`, { method: "DELETE" });
  };

  const handleAddAttachment = async () => {
    if (!selectedTask || !newAttachmentName.trim() || !newAttachmentUrl.trim()) return;
    setIsPatching(true);
    const newAttachment = { name: newAttachmentName.trim(), url: newAttachmentUrl.trim() };
    const updatedAttachments = [...(selectedTask.attachments || []), newAttachment];
    
    // optimistically update local state
    const updatedTask = { ...selectedTask, attachments: updatedAttachments };
    setTasks(prev => prev.map(t => t.id === selectedTask.id ? updatedTask : t));
    setSelectedTask(updatedTask);
    
    setNewAttachmentName("");
    setNewAttachmentUrl("");

    await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: selectedTask.id,
        attachments: updatedAttachments
      })
    });
    setIsPatching(false);
  };

  const handleRemoveAttachment = async (index: number) => {
    if (!selectedTask) return;
    setIsPatching(true);
    const updatedAttachments = selectedTask.attachments?.filter((_, i) => i !== index) || [];
    
    const updatedTask = { ...selectedTask, attachments: updatedAttachments };
    setTasks(prev => prev.map(t => t.id === selectedTask.id ? updatedTask : t));
    setSelectedTask(updatedTask);

    await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: selectedTask.id,
        attachments: updatedAttachments
      })
    });
    setIsPatching(false);
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
            className="flex w-80 shrink-0 flex-col rounded-[28px] border border-stone-200 bg-white/90 p-4 shadow-sm"
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, col.id)}
          >
            <div className="flex items-center justify-between mb-4 px-2">
                <div className="flex items-center gap-2">
                    <span className={`text-sm font-semibold tracking-wide uppercase ${col.color}`}>{col.title}</span>
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-stone-100 text-xs font-medium text-stone-500">
                        {colTasks.length}
                    </span>
                </div>
                <button 
                  onClick={() => setAddingToCol(col.id)}
                  className="rounded-lg p-1 text-stone-400 transition-colors hover:bg-stone-100 hover:text-teal-700"
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
                        onClick={() => setSelectedTask(t)}
                        className={`group cursor-grab rounded-2xl border border-stone-200 bg-[#fffdf8] p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-md active:cursor-grabbing ${draggedTaskId === t.id ? 'border-teal-500 opacity-50' : ''}`}
                    >
                        <div className="flex items-start justify-between">
                            <p className="text-sm font-medium text-[#17211d]">{t.title}</p>
                            <div className="flex items-center gap-2">
                                {isBlocked(t) && (
                                   <Lock className="h-3 w-3 text-rose-500" />
                                )}
                                <button onClick={() => deleteBtn(t.id)} className="text-stone-400 opacity-0 hover:text-red-500 group-hover:opacity-100">
                                    <HelpCircle className="h-4 w-4 hidden" />
                                    <span className="text-xs">✕</span>
                                </button>
                            </div>
                        </div>
                        {t.description && (
                            <p className="mt-2 line-clamp-2 text-xs text-stone-500">{t.description}</p>
                        )}
                        {t.attachments && t.attachments.length > 0 && (
                            <div className="mt-3 flex items-center gap-1.5 text-xs text-stone-500">
                                <Paperclip className="h-3.5 w-3.5" />
                                {t.attachments.length} attachment{t.attachments.length !== 1 && 's'}
                            </div>
                        )}
                        <div className="mt-4 flex items-center justify-between border-t border-stone-100 pt-2">
                             <div className="flex items-center gap-1.5 opacity-60">
                                <GripVertical className="h-3.5 w-3.5 text-stone-400" />
                                <span className="font-mono text-[10px] text-stone-400">DRAG</span>
                             </div>
                             {col.id === "done" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-stone-300" />}
                        </div>
                    </div>
                ))}

                {addingToCol === col.id && (
                    <div className="rounded-2xl border border-teal-200 bg-teal-50 p-3 shadow-lg shadow-teal-900/5">
                        <input 
                          autoFocus
                          type="text" 
                          placeholder="What needs to be done?"
                          className="w-full bg-transparent text-sm text-[#17211d] placeholder-stone-500 focus:outline-none"
                          value={newTaskTitle}
                          onChange={e => setNewTaskTitle(e.target.value)}
                          onKeyDown={e => {
                              if (e.key === "Enter") handleAddTask(col.id);
                              if (e.key === "Escape") setAddingToCol(null);
                          }}
                        />
                        <div className="mt-3 flex items-center justify-end gap-2">
                           <button onClick={() => setAddingToCol(null)} className="text-xs text-stone-500 hover:text-stone-800">Cancel</button>
                           <button onClick={() => handleAddTask(col.id)} className="rounded-full bg-[#163c36] px-3 py-1 text-xs font-semibold text-white hover:bg-[#23544b]">Save</button>
                        </div>
                    </div>
                )}
            </div>
          </div>
        );
      })}

      {selectedTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/40 p-4 backdrop-blur-sm">
          <div className="animate-in fade-in zoom-in flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-[32px] border border-stone-200 bg-[#fffdf8] shadow-2xl shadow-stone-950/20 duration-200">
            <div className="flex items-center justify-between border-b border-stone-200 bg-stone-50/70 p-6">
              <h2 className="text-xl font-bold text-[#17211d]">{selectedTask.title}</h2>
              <button onClick={() => setSelectedTask(null)} className="rounded-lg p-1 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-800">
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="flex-1 space-y-8 overflow-y-auto p-6">
              {/* Info Section */}
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-2xl border border-stone-200 bg-white p-4">
                   <p className="mb-1 text-xs font-medium uppercase tracking-wider text-stone-500">Status</p>
                   <p className="text-sm font-semibold uppercase tracking-wider text-[#17211d]">{selectedTask.status.replace("_", " ")}</p>
                </div>
                <div className="rounded-2xl border border-stone-200 bg-white p-4">
                   <p className="mb-1 text-xs font-medium uppercase tracking-wider text-stone-500">Estimated hours</p>
                   <p className="font-semibold text-[#17211d]">{selectedTask.estimatedHours ? `${selectedTask.estimatedHours} hrs` : "--"}</p>
                </div>
              </div>

              {selectedTask.description && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-stone-700">Description</h3>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-600">{selectedTask.description}</p>
                </div>
              )}

              {/* Attachments Section */}
              <div className="rounded-2xl border border-stone-200 bg-white p-5">
                <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-[#17211d]">
                  <Paperclip className="h-4 w-4 text-teal-700" />
                  Project Assets & Attachments
                </h3>
                
                <div className="mb-5 space-y-2">
                  {!selectedTask.attachments || selectedTask.attachments.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-stone-300 p-6 text-center text-stone-500">
                      <p className="text-sm">No assets attached to this task yet.</p>
                    </div>
                  ) : (
                    selectedTask.attachments.map((att, idx) => (
                      <div key={idx} className="flex items-center justify-between rounded-2xl border border-stone-200 bg-stone-50 p-3 transition hover:border-teal-200">
                        <div className="flex items-center gap-3 overflow-hidden">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                            <LinkIcon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-[#17211d]">{att.name}</p>
                            <a href={att.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 truncate text-xs text-teal-700 hover:text-teal-600">
                              {att.url} <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        </div>
                        <button 
                          onClick={() => handleRemoveAttachment(idx)}
                          disabled={isPatching}
                          className="shrink-0 p-2 text-stone-400 hover:text-rose-500 disabled:opacity-50"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {/* Add new attachment form */}
                <div className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-stone-50 p-4 sm:flex-row sm:items-end">
                  <div className="flex-1 space-y-1">
                    <label className="text-[10px] font-medium uppercase tracking-wider text-stone-500">Asset name</label>
                    <input 
                      type="text" 
                      placeholder="e.g. Figma UI Mockup"
                      value={newAttachmentName}
                      onChange={e => setNewAttachmentName(e.target.value)}
                      className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-[#17211d] placeholder-stone-400 outline-none focus:ring-1 focus:ring-teal-500"
                    />
                  </div>
                  <div className="flex-1 space-y-1">
                    <label className="text-[10px] font-medium uppercase tracking-wider text-stone-500">Public URL</label>
                    <input 
                      type="url" 
                      placeholder="https://"
                      value={newAttachmentUrl}
                      onChange={e => setNewAttachmentUrl(e.target.value)}
                      className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-[#17211d] placeholder-stone-400 outline-none focus:ring-1 focus:ring-teal-500"
                      onKeyDown={e => {
                        if (e.key === "Enter") handleAddAttachment();
                      }}
                    />
                  </div>
                  <button 
                    onClick={handleAddAttachment}
                    disabled={!newAttachmentName.trim() || !newAttachmentUrl.trim() || isPatching}
                    className="h-9 shrink-0 rounded-xl bg-[#163c36] px-4 text-sm font-semibold text-white transition hover:bg-[#23544b] disabled:opacity-50 sm:h-[38px]"
                  >
                    Attach Asset
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
