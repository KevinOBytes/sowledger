"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Edit2, Check, X } from "lucide-react";

type UserAction = {
  id: string;
  name: string;
  hourlyRate?: number;
};

export default function ActionsSettingsPage() {
  const [actions, setActions] = useState<UserAction[]>([]);
  const [status, setStatus] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const [editName, setEditName] = useState("");
  const [editRate, setEditRate] = useState("");

  const [newName, setNewName] = useState("");
  const [newRate, setNewRate] = useState("");

  const loadActions = async () => {
    setStatus("Loading...");
    const res = await fetch("/api/user/actions");
    const data = await res.json();
    if (res.ok) {
      setActions(data.actions || []);
      setStatus("");
    } else {
      setStatus(`Error loading actions: ${data.error}`);
    }
  };

  useEffect(() => {
    let mounted = true;
    async function fetchInitial() {
      setStatus("Loading...");
      const res = await fetch("/api/user/actions");
      const data = await res.json();
      if (!mounted) return;
      if (res.ok) {
        setActions(data.actions || []);
        setStatus("");
      } else {
        setStatus(`Error loading actions: ${data.error}`);
      }
    }
    fetchInitial();
    return () => { mounted = false; };
  }, []);

  async function createAction(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    
    setStatus("Saving...");
    const res = await fetch("/api/user/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName.trim(),
        hourlyRate: newRate ? parseFloat(newRate) : undefined,
      }),
    });
    
    const data = await res.json();
    if (res.ok) {
      setNewName("");
      setNewRate("");
      loadActions();
    } else {
      setStatus(`Error: ${data.error}`);
    }
  }

  async function deleteAction(id: string) {
    if (!confirm("Are you sure you want to delete this action?")) return;
    setStatus("Deleting...");
    const res = await fetch(`/api/user/actions?actionId=${id}`, { method: "DELETE" });
    if (res.ok) {
      loadActions();
    } else {
      const data = await res.json();
      setStatus(`Error: ${data.error}`);
    }
  }

  function startEdit(action: UserAction) {
    setEditingId(action.id);
    setEditName(action.name);
    setEditRate(action.hourlyRate !== undefined ? action.hourlyRate.toString() : "");
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) return;
    setStatus("Saving...");
    const res = await fetch("/api/user/actions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actionId: id,
        name: editName.trim(),
        hourlyRate: editRate ? parseFloat(editRate) : undefined,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setEditingId(null);
      loadActions();
    } else {
      setStatus(`Error: ${data.error}`);
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Billing Actions</h1>
        <p className="mt-2 text-slate-400">
          Configure the actions you perform and their optional hourly rates. 
          When you track time, the timer defaults to the highest rate among your selected actions.
        </p>
      </div>

      {status && (
        <div className="mb-4 rounded bg-slate-800 p-3 text-sm text-slate-300">
          {status}
        </div>
      )}

      <div className="mb-8 rounded-xl border border-slate-800 bg-slate-900 overflow-hidden shadow-xl">
        <div className="grid grid-cols-12 gap-4 border-b border-slate-800 bg-slate-800/50 p-4 text-sm font-semibold text-slate-300">
          <div className="col-span-6">Action Name</div>
          <div className="col-span-4">Hourly Rate ($)</div>
          <div className="col-span-2 text-right">Actions</div>
        </div>
        
        <div className="divide-y divide-slate-800">
          {actions.map((act) => (
            <div key={act.id} className="grid grid-cols-12 items-center gap-4 p-4 text-sm text-slate-200 transition-colors hover:bg-slate-800/30">
              {editingId === act.id ? (
                <>
                  <div className="col-span-6">
                    <input 
                      type="text" 
                      className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-1 outline-none focus:border-cyan-500"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  </div>
                  <div className="col-span-4">
                    <input 
                      type="number" 
                      step="0.01"
                      className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-1 outline-none focus:border-cyan-500"
                      value={editRate}
                      onChange={(e) => setEditRate(e.target.value)}
                      placeholder="e.g. 150"
                    />
                  </div>
                  <div className="col-span-2 flex justify-end gap-2 text-slate-400">
                    <button onClick={() => saveEdit(act.id)} className="hover:text-emerald-400 transition-colors">
                      <Check className="h-5 w-5" />
                    </button>
                    <button onClick={cancelEdit} className="hover:text-rose-400 transition-colors">
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="col-span-6 font-medium">{act.name}</div>
                  <div className="col-span-4 text-slate-400">
                    {act.hourlyRate !== undefined ? `$${act.hourlyRate.toFixed(2)}/hr` : "No rate"}
                  </div>
                  <div className="col-span-2 flex justify-end gap-2 text-slate-500">
                    <button onClick={() => startEdit(act)} className="hover:text-cyan-400 transition-colors">
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button onClick={() => deleteAction(act.id)} className="hover:text-rose-400 transition-colors">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}

          {actions.length === 0 && (
            <div className="p-8 text-center text-sm text-slate-500">
              No actions configured yet. Add your first action below.
            </div>
          )}
        </div>
      </div>

      <form onSubmit={createAction} className="flex flex-col gap-4 sm:flex-row sm:items-end rounded-xl border border-slate-800 bg-slate-900/50 p-5 shadow-inner">
        <label className="flex flex-1 flex-col gap-1.5 text-sm font-medium text-slate-300">
          New Action Name
          <input 
            type="text"
            required
            className="rounded-lg border border-slate-700 bg-slate-950 p-2.5 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Code Review"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1.5 text-sm font-medium text-slate-300">
          Hourly Rate (Optional)
          <div className="relative">
            <span className="absolute left-3 top-2.5 text-slate-500">$</span>
            <input 
              type="number"
              step="0.01"
              min="0"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2.5 pl-7 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
              value={newRate}
              onChange={(e) => setNewRate(e.target.value)}
              placeholder="150.00"
            />
          </div>
        </label>
        <button 
          type="submit" 
          disabled={!newName.trim()}
          className="flex h-[42px] items-center justify-center gap-2 rounded-lg bg-cyan-600 px-6 text-sm font-semibold text-white transition-all hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed sm:w-auto"
        >
          <Plus className="h-4 w-4" /> Add Action
        </button>
      </form>

    </div>
  );
}
