"use client";

import { useEffect, useId, useState } from "react";

type WorkspaceOption = { id: string; name: string; role: string; invited: boolean };

async function fetchWorkspaces(): Promise<{ workspaces: WorkspaceOption[]; currentWorkspaceId: string }> {
  const res = await fetch("/api/auth/workspaces");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "We couldn't load your workspaces.");
  return data;
}

export function WorkspaceSwitcher() {
  const id = useId();
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [current, setCurrent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const data = await fetchWorkspaces();
      setWorkspaces(data.workspaces);
      setCurrent(data.currentWorkspaceId);
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "We couldn't load your workspaces.");
    }
  }

  useEffect(() => {
    let active = true;
    fetchWorkspaces().then((data) => {
      if (!active) return;
      setWorkspaces(data.workspaces);
      setCurrent(data.currentWorkspaceId);
    }).catch((error: unknown) => {
      if (active) setError(error instanceof Error ? error.message : "We couldn't load your workspaces.");
    });
    return () => { active = false; };
  }, []);

  async function switchWorkspace(workspaceId: string) {
    if (workspaceId === current) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/workspaces", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "We couldn't switch workspaces. Please try again.");
      // A full navigation clears data from the previous workspace in client state.
      window.location.assign(data.redirectTo === "/client" ? "/client" : "/dashboard");
    } catch (error) {
      setError(error instanceof Error ? error.message : "We couldn't switch workspaces. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className="block text-xs font-medium text-stone-500">Workspace</label>
      <select id={id} value={current} disabled={busy || workspaces.length < 2} onChange={(event) => void switchWorkspace(event.target.value)}
        className="w-full rounded-xl border border-stone-200 bg-white px-2 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-600 disabled:opacity-75">
        {workspaces.length === 0 && <option value="">{error ? "Unavailable" : "Loading…"}</option>}
        {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}{workspace.invited ? " — join workspace" : ""}</option>)}
      </select>
      {busy && <p role="status" className="text-xs text-stone-500">Switching workspace…</p>}
      {error && <div role="alert" className="text-xs text-rose-700"><p>{error}</p><button type="button" onClick={() => void load()} className="mt-1 font-medium underline">Try again</button></div>}
    </div>
  );
}
