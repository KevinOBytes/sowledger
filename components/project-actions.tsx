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
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-400 transition hover:bg-white/10 hover:text-white"
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
              className="absolute right-0 top-full z-50 mt-2 w-48 overflow-hidden rounded-xl border border-white/10 bg-slate-900 shadow-2xl backdrop-blur-xl"
            >
              <div className="flex flex-col p-1">
                <button
                  onClick={toggleArchive}
                  disabled={loading}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-300 transition hover:bg-white/5 hover:text-white disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2Icon className="h-4 w-4 animate-spin text-cyan-400" />
                  ) : status === "active" ? (
                    <Archive className="h-4 w-4 text-slate-400" />
                  ) : (
                    <RotateCcw className="h-4 w-4 text-slate-400" />
                  )}
                  {status === "active" ? "Archive Project" : "Restore Project"}
                </button>
                <div className="my-1 h-px bg-white/10" />
                <button
                  onClick={deleteProject}
                  disabled={loading}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-rose-400 transition hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-50"
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
