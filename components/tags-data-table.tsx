"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Check, Edit2, PlusIcon, Search, Tag as TagIcon, Trash2, XIcon } from "lucide-react";

type WorkspaceTag = { id: string; name: string; color: string; projectId: string | null; isSOWLedgerDefault: boolean; status: "active" | "archived" };
type Project = { id: string; name: string };
const COLORS = [
  { name: "Blue", value: "#3b82f6" }, { name: "Cyan", value: "#06b6d4" },
  { name: "Emerald", value: "#10b981" }, { name: "Rose", value: "#f43f5e" },
  { name: "Amber", value: "#f59e0b" }, { name: "Violet", value: "#8b5cf6" },
  { name: "Fuchsia", value: "#d946ef" }, { name: "Slate", value: "#64748b" },
];
const UNCERTAIN = "We couldn't confirm this change. Reload this page to check your tags before trying again.";
function savedTag(value: unknown, workspaceId: string): value is WorkspaceTag & { workspaceId: string } {
  if (!value || typeof value !== "object") return false;
  const t = value as Record<string, unknown>;
  return t.workspaceId === workspaceId && typeof t.id === "string" && !!t.id.trim() && t.id.length <= 255
    && typeof t.name === "string" && !!t.name.trim() && t.name.length <= 255
    && typeof t.color === "string" && !!t.color.trim() && t.color.length <= 50
    && (t.projectId === null || (typeof t.projectId === "string" && !!t.projectId.trim() && t.projectId.length <= 255))
    && typeof t.isSOWLedgerDefault === "boolean" && (t.status === "active" || t.status === "archived");
}

export function TagsDataTable({ initialTags, projects, workspaceId, canManageTags }: { initialTags: WorkspaceTag[]; projects: Project[]; workspaceId: string; canManageTags: boolean }) {
  const router = useRouter();
  // Parent keys by trusted workspace ID. Refresh props intentionally do not
  // overwrite a local confirmed row or an unsaved draft in this workspace.
  const [tags, setTags] = useState(initialTags);
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState(false);
  const busy = useRef(false), active = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(COLORS[0].value);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const createInput = useRef<HTMLInputElement>(null), searchInput = useRef<HTMLInputElement>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusTarget = useRef<{ kind: "create" | "search" | "edit"; id?: string } | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    const target = focusTarget.current;
    if (pending || !target) return;
    focusTarget.current = null;
    const node = target.kind === "create" ? createInput.current : target.kind === "edit" ? editButtons.current.get(target.id!) ?? searchInput.current : searchInput.current;
    node?.focus();
  }, [pending, editingId, tags]);
  const filteredTags = tags.filter(tag => tag.name.toLowerCase().includes(search.toLowerCase()));
  function focus(id?: string) { focusTarget.current = { kind: id ? "edit" : "search", id }; }
  function startEdit(tag: WorkspaceTag) { if (!canManageTags || busy.current) return; setEditingId(tag.id); setEditName(tag.name); setEditColor(tag.color); }
  function cancelEdit(id: string) { if (busy.current) return; setEditingId(null); focus(id); }

  async function mutate(method: "POST" | "PATCH" | "DELETE", id: string | null, fields: Partial<WorkspaceTag> = {}, closeEdit = false) {
      if (!canManageTags || busy.current || !active.current)
          return;
      busy.current = true;
      setPending(true);
      setError("");
      setNotice("");
      const canonical = { ...fields, ...(fields.name !== undefined ? { name: fields.name.trim().toLowerCase() } : {}), ...(fields.color !== undefined ? { color: fields.color.trim() } : {}) };
      const url = method === "DELETE" ? `/api/settings/tags?id=${encodeURIComponent(id!)}` : "/api/settings/tags";
      try {
          const response = await fetch(url, { method, redirect: "error", ...(method === "DELETE" ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(method === "PATCH" ? { tagId: id, ...fields } : fields) }) });
          if (!response.ok)
              throw new Error("Unconfirmed response");
          if (method === "DELETE" && response.url !== new URL(url, window.location.href).href)
              throw new Error("Unconfirmed response URL");
          const data: unknown = await response.json();
          if (!active.current)
              return;
          if (!data || typeof data !== "object" || (data as {
              ok?: unknown;
          }).ok !== true)
              throw new Error("Unconfirmed envelope");
          if (method === "DELETE") {
              setTags(current => current.filter(tag => tag.id !== id));
              setNotice("Tag deleted.");
              focus();
          }
          else {
              const tag = (data as {
                  tag?: unknown;
              }).tag;
              const expected = method === "POST" ? { projectId: null, isSOWLedgerDefault: false, status: "active", ...canonical } : canonical;
              if (!savedTag(tag, workspaceId) || (method === "PATCH" ? tag.id !== id : tags.some(row => row.id === tag.id))
                  || Object.entries(expected).some(([key, value]) => tag[key as keyof WorkspaceTag] !== value))
                  throw new Error("Unconfirmed record");
              setTags(current => method === "POST" ? [tag, ...current] : current.map(row => row.id === id ? tag : row));
              if (method === "POST") {
                  setNewTagName("");
                  focusTarget.current = { kind: "create" };
              }
              if (closeEdit) {
                  setEditingId(null);
                  focus(id!);
              }
              setNotice(method === "POST" ? "Tag created." : "Tag saved.");
          }
          // A refresh is not the mutation receipt. Its failure must never turn a
          // confirmed mutation into an uncertain one or provoke an automatic retry.
          try {
              router.refresh();
          }
          catch { /* Confirmed local state is retained. */ }
      }
      catch {
          if (active.current)
              setError(UNCERTAIN);
      }
      finally {
          busy.current = false;
          if (active.current)
              setPending(false);
      }
  }
  function saveEdit(id: string) { if (editName.trim()) void mutate("PATCH", id, { name: editName, color: editColor }, true); }
  function deleteTag(id: string) { if (!canManageTags || busy.current) return; if (confirm("Completely remove this tag? Existing time-entry tag strings are not deleted.")) void mutate("DELETE", id); }
  const fieldClass = "h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-cyan-500 disabled:opacity-50";
  const actionClass = "rounded-xl bg-slate-50 p-2 text-slate-600 hover:bg-cyan-50 hover:text-cyan-700 disabled:opacity-50";
  return <div className="w-full min-w-0 max-w-full overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm" aria-busy={pending}>
    <div className="space-y-4 border-b border-slate-100 p-5">
      <div className="relative w-full xl:max-w-md"><Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input ref={searchInput} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search or filter tags..." aria-label="Search or filter tags" className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-sm outline-none focus:border-cyan-500" /></div>
      {canManageTags ? <form onSubmit={e => { e.preventDefault(); if (newTagName.trim()) void mutate("POST", null, { name: newTagName, color: newTagColor }); }} className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <input ref={createInput} maxLength={255} disabled={pending} value={newTagName} onChange={e => setNewTagName(e.target.value)} placeholder="Enter new tag..." aria-label="New Tag Name" className={`${fieldClass} h-12 min-w-0 sm:w-56`} />
        <div className="flex max-w-full flex-wrap items-center gap-1.5 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">{COLORS.map(color => <button key={color.value} type="button" disabled={pending} onClick={() => setNewTagColor(color.value)} aria-label={`Select color ${color.name}`} aria-pressed={newTagColor === color.value} className={`h-5 w-5 rounded-full disabled:opacity-50 ${newTagColor === color.value ? "ring-2 ring-slate-950" : "opacity-55"}`} style={{ backgroundColor: color.value }} />)}</div>
        <button type="submit" disabled={pending || !newTagName.trim()} className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 text-sm font-bold text-white disabled:opacity-50"><PlusIcon className="h-4 w-4" />Add Tag</button>
      </form> : <p className="text-sm text-slate-600">Managers can edit workspace tags.</p>}
      <div className="text-sm text-slate-500"><p>Tags can still be used on other projects.</p><p>This label doesn&apos;t change time entries, rates, or invoices.</p></div>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      {(pending || notice) && <p role="status" className="text-sm text-cyan-700">{pending ? "Saving tag change…" : notice}</p>}
    </div>
    {!filteredTags.length ? <div className="p-8 text-center text-slate-500"><TagIcon className="mx-auto mb-4 h-12 w-12 text-slate-300" /><p className="font-semibold text-slate-700">No tags available</p><p className="mt-1 text-sm">{search ? "No tags match your search." : canManageTags ? "Add a tag to label work in your workspace." : "Ask a workspace manager to add tags."}</p></div> : <div className="max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label="Workspace tags table">
      <table className="w-full min-w-[1000px] text-sm"><thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Tag</th><th className="px-5 py-3">Associated project</th><th className="px-5 py-3">Billing label</th><th className="px-5 py-3">Status</th>{canManageTags && <th className="px-5 py-3 text-right">Actions</th>}</tr></thead><tbody className="divide-y divide-slate-100">
        {filteredTags.map(tag => {
          const isEditing = canManageTags && editingId === tag.id;
          const project = projects.find(p => p.id === tag.projectId);
          const projectText = tag.projectId === null ? "No associated project" : project?.name ?? "Associated project unavailable";
          const billingText = tag.isSOWLedgerDefault ? "Billable label" : "No billable label";
          return <tr key={tag.id} className={tag.status === "archived" ? "bg-slate-50/60 text-slate-500" : "bg-white"}>
            <td className="px-5 py-4">
              {isEditing ? <div className="flex items-center gap-2">
                <input autoFocus maxLength={255} disabled={pending} value={editName}
                  onChange={e => setEditName(e.target.value)} aria-label="Edit tag name"
                  className={`${fieldClass} w-44 font-bold`}
                  onKeyDown={e => {
                    if (e.key === "Enter") { e.preventDefault(); saveEdit(tag.id); }
                    if (e.key === "Escape") cancelEdit(tag.id);
                  }} />
                <div className="flex gap-1">
                  {COLORS.slice(0, 4).map(color => <button key={color.value} type="button"
                    disabled={pending} onClick={() => setEditColor(color.value)}
                    className={`h-4 w-4 rounded-full ${editColor === color.value ? "ring-2 ring-slate-950" : ""}`}
                    style={{ backgroundColor: color.value }} aria-label={`Use ${color.name}`}
                    aria-pressed={editColor === color.value} />)}
                </div>
              </div> : canManageTags ? <button disabled={pending} onClick={() => startEdit(tag)}
                aria-label={`Rename tag ${tag.name}`}
                className="inline-flex items-center gap-3 font-bold text-slate-800 hover:text-cyan-700 disabled:opacity-50">
                <span className="h-4 w-4 rounded-full" style={{ backgroundColor: tag.color }} />#{tag.name}
              </button> : <span className="inline-flex items-center gap-3 font-bold">
                <span className="h-4 w-4 rounded-full" style={{ backgroundColor: tag.color }} />#{tag.name}
              </span>}
            </td>
            <td className="px-5 py-4">
              {canManageTags ? <select aria-label={`Associated project for ${tag.name}`}
                value={tag.projectId ?? ""} disabled={pending} className={fieldClass}
                onChange={e => void mutate("PATCH", tag.id, { projectId: e.target.value || null })}>
                <option value="">No associated project</option>
                {tag.projectId && !project && <option value={tag.projectId} disabled>Associated project unavailable</option>}
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select> : projectText}
            </td>
            <td className="px-5 py-4">
              {canManageTags ? <button disabled={pending} aria-label={`${billingText} for ${tag.name}`}
                onClick={() => void mutate("PATCH", tag.id, { isSOWLedgerDefault: !tag.isSOWLedgerDefault })}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold disabled:opacity-50 ${tag.isSOWLedgerDefault ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                {billingText}
              </button> : billingText}
            </td>
            <td className="px-5 py-4"><span className="capitalize">{tag.status}</span></td>
            {canManageTags && <td className="px-5 py-4">
              <div className="flex justify-end gap-1">
                {isEditing ? <>
                  <button disabled={pending || !editName.trim()} onClick={() => saveEdit(tag.id)}
                    aria-label={`Save changes for ${tag.name}`} className={actionClass}><Check className="h-4 w-4" /></button>
                  <button disabled={pending} onClick={() => cancelEdit(tag.id)}
                    aria-label={`Cancel editing ${tag.name}`} className={actionClass}><XIcon className="h-4 w-4" /></button>
                </> : <>
                  <button ref={node => {
                    if (node) editButtons.current.set(tag.id, node);
                    else editButtons.current.delete(tag.id);
                  }} disabled={pending} onClick={() => startEdit(tag)}
                    aria-label={`Edit tag ${tag.name}`} className={actionClass}><Edit2 className="h-4 w-4" /></button>
                  <button disabled={pending}
                    onClick={() => void mutate("PATCH", tag.id, { status: tag.status === "active" ? "archived" : "active" })}
                    aria-label={`${tag.status === "active" ? "Archive" : "Restore"} tag ${tag.name}`}
                    className={actionClass}><Archive className="h-4 w-4" /></button>
                  <button disabled={pending} onClick={() => deleteTag(tag.id)}
                    aria-label={`Delete tag ${tag.name}`} className={actionClass}><Trash2 className="h-4 w-4" /></button>
                </>}
              </div>
            </td>}
          </tr>;
        })}
      </tbody></table>
    </div>}
  </div>;
}
