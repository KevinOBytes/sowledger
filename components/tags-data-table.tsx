"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Check, Edit2, PlusIcon, Search, Tag as TagIcon, Trash2, XIcon } from "lucide-react";

type WorkspaceTag = {
  id: string;
  name: string;
  color: string;
  projectId: string | null;
  isBillableDefault: boolean;
  status: "active" | "archived";
};

type Project = { id: string; name: string };

const COLORS = [
  { name: "Blue", value: "#3b82f6" },
  { name: "Cyan", value: "#06b6d4" },
  { name: "Emerald", value: "#10b981" },
  { name: "Rose", value: "#f43f5e" },
  { name: "Amber", value: "#f59e0b" },
  { name: "Violet", value: "#8b5cf6" },
  { name: "Fuchsia", value: "#d946ef" },
  { name: "Slate", value: "#64748b" },
];

export function TagsDataTable({ initialTags, projects }: { initialTags: WorkspaceTag[]; projects: Project[] }) {
  const router = useRouter();
  const [tags, setTags] = useState<WorkspaceTag[]>(initialTags);
  const [search, setSearch] = useState("");
  const [updating, setUpdating] = useState<string | null>(null);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(COLORS[0].value);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");

  const filteredTags = tags.filter((tag) => tag.name.toLowerCase().includes(search.toLowerCase()));

  async function createTag(e: React.FormEvent) {
    e.preventDefault();
    if (!newTagName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/settings/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTagName, color: newTagColor }),
      });
      if (res.ok) {
        const data = await res.json();
        setTags((current) => [data.tag, ...current]);
        setNewTagName("");
        router.refresh();
      }
    } finally {
      setCreating(false);
    }
  }

  function startEdit(tag: WorkspaceTag) {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditColor(tag.color);
  }

  async function updateTag(id: string, payload: Partial<WorkspaceTag>) {
    setUpdating(id);
    try {
      const res = await fetch("/api/settings/tags", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagId: id, ...payload }),
      });
      if (res.ok) {
        const data = await res.json();
        setTags((current) => current.map((tag) => tag.id === id ? data.tag : tag));
        router.refresh();
      }
    } finally {
      setUpdating(null);
    }
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) return;
    await updateTag(id, { name: editName, color: editColor });
    setEditingId(null);
  }

  async function deleteTag(id: string) {
    if (!confirm("Completely remove this tag? Existing time-entry tag strings are not deleted.")) return;
    setUpdating(id);
    try {
      const res = await fetch(`/api/settings/tags?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setTags((current) => current.filter((tag) => tag.id !== id));
        router.refresh();
      }
    } finally {
      setUpdating(null);
    }
  }

  return (
    <div className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-slate-100 p-5 xl:flex-row xl:items-center xl:justify-between">
        <div className="relative w-full xl:max-w-md">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search or filter tags..." className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" />
        </div>
        <form onSubmit={createTag} className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input value={newTagName} onChange={(e) => setNewTagName(e.target.value)} placeholder="Enter new tag..." aria-label="New Tag Name" className="h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none transition focus:border-cyan-500 focus:bg-white sm:w-56" />
          <div className="flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
            {COLORS.map((color) => <button key={color.value} type="button" onClick={() => setNewTagColor(color.value)} title={color.name} aria-label={`Select color ${color.name}`} className={`h-5 w-5 rounded-full transition ${newTagColor === color.value ? "scale-125 ring-2 ring-slate-950" : "opacity-55 hover:opacity-100"}`} style={{ backgroundColor: color.value }} />)}
          </div>
          <button type="submit" disabled={creating || !newTagName.trim()} className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-50"><PlusIcon className="h-4 w-4" />Add Tag</button>
        </form>
      </div>

      {filteredTags.length === 0 ? (
        <div className="p-16 text-center text-slate-500">
          <TagIcon className="mx-auto mb-4 h-12 w-12 text-slate-300" />
          <p className="font-semibold text-slate-700">No tags available</p>
          <p className="mt-1 text-sm">{search ? "No tags match your search." : "Create tags to categorize time entries and billing defaults."}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
              <tr><th className="px-5 py-3">Tag</th><th className="px-5 py-3">Project scope</th><th className="px-5 py-3">Billing</th><th className="px-5 py-3">Status</th><th className="px-5 py-3 text-right">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredTags.map((tag) => {
                const isEditing = editingId === tag.id;
                return (
                  <tr key={tag.id} className={tag.status === "archived" ? "bg-slate-50/60 text-slate-500" : "bg-white"}>
                    <td className="px-5 py-4">
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none focus:border-cyan-500" autoFocus onKeyDown={(e) => { if (e.key === "Enter") saveEdit(tag.id); if (e.key === "Escape") setEditingId(null); }} />
                          <div className="flex gap-1">
                            {COLORS.slice(0, 4).map((color) => <button key={color.value} type="button" onClick={() => setEditColor(color.value)} className={`h-4 w-4 rounded-full ${editColor === color.value ? "ring-2 ring-slate-950" : ""}`} style={{ backgroundColor: color.value }} aria-label={`Use ${color.name}`} />)}
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => startEdit(tag)} className="inline-flex items-center gap-3 font-bold text-slate-800 hover:text-cyan-700">
                          <span className="h-4 w-4 rounded-full" style={{ backgroundColor: tag.color }} />#{tag.name}
                        </button>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <select aria-label="Select Project Scope" value={tag.projectId || "global"} onChange={(e) => updateTag(tag.id, { projectId: e.target.value === "global" ? null : e.target.value })} disabled={updating === tag.id} className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-cyan-500 disabled:opacity-50">
                        <option value="global">Global Scope (All)</option>
                        {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                      </select>
                    </td>
                    <td className="px-5 py-4"><button onClick={() => updateTag(tag.id, { isBillableDefault: !tag.isBillableDefault })} disabled={updating === tag.id} className={`rounded-full px-3 py-1.5 text-xs font-bold ${tag.isBillableDefault ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{tag.isBillableDefault ? "Billable Default" : "Non-Billable"}</button></td>
                    <td className="px-5 py-4"><button onClick={() => updateTag(tag.id, { status: tag.status === "active" ? "archived" : "active" })} disabled={updating === tag.id} className={`rounded-full px-3 py-1.5 text-xs font-bold capitalize ${tag.status === "active" ? "bg-cyan-50 text-cyan-700" : "bg-rose-50 text-rose-700"}`}>{tag.status}</button></td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-1">
                        {isEditing ? (
                          <>
                            <button onClick={() => saveEdit(tag.id)} title="Save changes" className="rounded-xl bg-emerald-50 p-2 text-emerald-700 hover:bg-emerald-100"><Check className="h-4 w-4" /></button>
                            <button onClick={() => setEditingId(null)} title="Cancel editing" className="rounded-xl bg-slate-50 p-2 text-slate-500 hover:bg-slate-100"><XIcon className="h-4 w-4" /></button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => startEdit(tag)} title="Edit Tag" className="rounded-xl bg-slate-50 p-2 text-slate-500 hover:bg-cyan-50 hover:text-cyan-700"><Edit2 className="h-4 w-4" /></button>
                            <button onClick={() => updateTag(tag.id, { status: tag.status === "active" ? "archived" : "active" })} title={tag.status === "active" ? "Archive Tag" : "Restore Tag"} aria-label={tag.status === "active" ? "Archive Tag" : "Restore Tag"} className="rounded-xl bg-slate-50 p-2 text-slate-500 hover:bg-cyan-50 hover:text-cyan-700"><Archive className="h-4 w-4" /></button>
                            <button onClick={() => deleteTag(tag.id)} title="Delete Tag" className="rounded-xl bg-slate-50 p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-700"><Trash2 className="h-4 w-4" /></button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
