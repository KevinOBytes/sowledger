"use client";

import { useCallback, useEffect, useState } from "react";
import { DataLoadNotice } from "@/components/data-load-notice";
import { Check, Edit2, Plus, Trash2, X } from "lucide-react";

type UserAction = {
  id: string;
  name: string;
  hourlyRate?: number | null;
};

export default function ActionsSettingsPage() {
  const [actions, setActions] = useState<UserAction[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRate, setEditRate] = useState("");
  const [newName, setNewName] = useState("");
  const [newRate, setNewRate] = useState("");

  const loadActions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/user/actions");
      if (!res.ok) throw new Error("Work types unavailable");
      const data = await res.json();
      setActions(data.actions || []);
      setLoadError(false);
      setStatus("");
    } catch {
      setLoadError(true);
      setStatus("");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadActions();
  }, [loadActions]);

  async function createAction(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;

    setStatus("Saving...");
    try {
      const res = await fetch("/api/user/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          hourlyRate: newRate ? parseFloat(newRate) : undefined,
        }),
      });
      if (!res.ok) throw new Error("Request failed");
      setNewName("");
      setNewRate("");
      await loadActions();
    } catch {
      setStatus("Could not add the work type. Check the name and rate, then try again.");
    }
  }

  async function deleteAction(id: string) {
    if (!confirm("Delete this work type and rate? Existing time entries keep their saved label.")) return;
    setStatus("Deleting...");
    try {
      const res = await fetch(`/api/user/actions?actionId=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Request failed");
      await loadActions();
    } catch {
      setStatus("Could not delete the work type. Please try again.");
    }
  }

  function startEdit(action: UserAction) {
    setEditingId(action.id);
    setEditName(action.name);
    setEditRate(action.hourlyRate != null ? action.hourlyRate.toString() : "");
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) return;
    setStatus("Saving...");
    try {
      const res = await fetch("/api/user/actions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionId: id,
          name: editName.trim(),
          hourlyRate: editRate ? parseFloat(editRate) : null,
        }),
      });
      if (!res.ok) throw new Error("Request failed");
      setEditingId(null);
      await loadActions();
    } catch {
      setStatus("Could not save the work type. Your changes are still here; please try again.");
    }
  }

  return (
    <main className="min-h-screen bg-[#f6f3ee] p-4 text-slate-950 sm:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Rates</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Work types and rates</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            Save the work types you use often, such as design or consulting. Add an hourly rate to use when you start a timer or log completed work.
          </p>
        </header>

        {status && (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 shadow-sm">
            {status}
          </div>
        )}

        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-4">
            <h2 className="text-xl font-semibold">Your work types</h2>
            <p className="mt-1 text-sm text-slate-500">Examples: Code review, client strategy, research, design QA, admin.</p>
          </div>

          {loading ? (
            <p role="status" className="p-6 text-sm text-slate-500">Loading work types...</p>
          ) : loadError ? (
            <DataLoadNotice message="We couldn't load your work types." onRetry={() => void loadActions()} />
          ) : actions.length === 0 ? (
            <div className="p-10 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-700">
                <Plus className="h-6 w-6" />
              </div>
              <p className="mt-4 text-sm font-bold text-slate-800">No work types yet.</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">Add one reusable label and optional rate below. You can still track time without one.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {actions.map((action) => (
                <div key={action.id} className="grid gap-3 px-6 py-4 text-sm md:grid-cols-[minmax(0,1fr)_160px_120px] md:items-center">
                  {editingId === action.id ? (
                    <>
                      <input
                        aria-label="Work type name"
                        type="text"
                        className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 outline-none transition focus:border-cyan-500 focus:bg-white"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                      />
                      <input
                        aria-label="Hourly rate"
                        type="number"
                        step="0.01"
                        className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 outline-none transition focus:border-cyan-500 focus:bg-white"
                        value={editRate}
                        onChange={(e) => setEditRate(e.target.value)}
                        placeholder="150"
                      />
                      <div className="flex gap-2 md:justify-end">
                        <button type="button" onClick={() => saveEdit(action.id)} className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-500" aria-label="Save work type"><Check className="h-4 w-4" /></button>
                        <button type="button" onClick={cancelEdit} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50" aria-label="Cancel edit"><X className="h-4 w-4" /></button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <p className="font-bold text-slate-950">{action.name}</p>
                        <p className="mt-1 text-xs text-slate-500">Available when you start a timer or log time.</p>
                      </div>
                      <div className="font-mono text-sm font-semibold text-slate-700">
                        {action.hourlyRate != null ? `$${action.hourlyRate.toFixed(2)}/hr` : "No rate"}
                      </div>
                      <div className="flex gap-2 md:justify-end">
                        <button type="button" onClick={() => startEdit(action)} className="rounded-xl border border-slate-200 px-3 py-2 text-slate-600 hover:border-cyan-200 hover:text-cyan-700" aria-label={`Edit ${action.name}`}><Edit2 className="h-4 w-4" /></button>
                        <button type="button" onClick={() => deleteAction(action.id)} className="rounded-xl border border-slate-200 px-3 py-2 text-slate-600 hover:border-rose-200 hover:text-rose-700" aria-label={`Delete ${action.name}`}><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <form onSubmit={createAction} className="grid gap-4 rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm sm:grid-cols-[minmax(0,1fr)_220px_auto] sm:items-end">
          <label className="text-sm font-bold text-slate-700">
            New work type
            <input
              type="text"
              required
              className="mt-1 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Code review"
            />
          </label>
          <label className="text-sm font-bold text-slate-700">
            Hourly rate, optional
            <div className="relative mt-1">
              <span className="absolute left-3 top-3 text-slate-400">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 pl-7 text-sm outline-none transition focus:border-cyan-500 focus:bg-white"
                value={newRate}
                onChange={(e) => setNewRate(e.target.value)}
                placeholder="150.00"
              />
            </div>
          </label>
          <button
            type="submit"
            disabled={!newName.trim()}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Add work type
          </button>
        </form>
      </div>
    </main>
  );
}
