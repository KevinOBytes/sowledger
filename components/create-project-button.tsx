"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, Loader2Icon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export function CreateProjectButton() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), billingModel: "hourly" }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create project");
      }

      setIsOpen(false);
      setName("");
      router.refresh(); // Refresh the Server Component data
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative">
      <AnimatePresence mode="popLayout">
        {!isOpen ? (
          <motion.button
            key="button"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95, filter: "blur(4px)" }}
            onClick={() => setIsOpen(true)}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-500/25 transition hover:from-cyan-400 hover:to-cyan-500 active:scale-95"
          >
            <PlusIcon strokeWidth={2.5} className="h-4 w-4" />
            New Project
          </motion.button>
        ) : (
          <motion.form
            key="form"
            initial={{ opacity: 0, x: -20, filter: "blur(4px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.95, filter: "blur(4px)" }}
            onSubmit={submit}
            className="flex w-72 flex-col gap-2 rounded-xl border border-white/10 bg-slate-900/80 p-3 shadow-2xl backdrop-blur-xl"
          >
            <input
              autoFocus
              type="text"
              placeholder="Project name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
              className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
            />
            {error && <p className="text-xs text-rose-400 px-1">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  setName("");
                  setError("");
                }}
                disabled={loading}
                className="flex-1 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-400 hover:bg-white/5 hover:text-white transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !name.trim()}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-500 transition disabled:opacity-50"
              >
                {loading ? <Loader2Icon className="h-4 w-4 animate-spin" /> : "Create"}
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
