"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Archive, Trash2, RotateCcw, Loader2Icon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export function ProjectActions({ projectId, status }: { projectId: string; status: "active" | "archived" }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function toggleArchive() {
    setLoading(true);
    try {
      const res = await fetch("/api/projects", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, status: status === "active" ? "archived" : "active" }),
      });
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setLoading(false);
      setIsOpen(false);
    }
  }

  async function deleteProject() {
    if (!confirm("Are you sure you want to permanently delete this project? All associated tasks and time entry linkages will be removed.")) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/projects?projectId=${encodeURIComponent(projectId)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        router.push("/projects");
        router.refresh();
      }
    } finally {
      setLoading(false);
      setIsOpen(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-cyan-300 hover:text-cyan-700"
        aria-label="Project actions"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -10 }}
              className="absolute right-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
            >
              <div className="flex flex-col p-1">
                <button
                  onClick={toggleArchive}
                  disabled={loading}
                  className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2Icon className="h-4 w-4 animate-spin text-cyan-700" />
                  ) : status === "active" ? (
                    <Archive className="h-4 w-4 text-slate-400" />
                  ) : (
                    <RotateCcw className="h-4 w-4 text-slate-400" />
                  )}
                  {status === "active" ? "Archive Project" : "Restore Project"}
                </button>
                <div className="my-1 h-px bg-slate-100" />
                <button
                  onClick={deleteProject}
                  disabled={loading}
                  className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                >
                  {loading ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Delete Project
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
