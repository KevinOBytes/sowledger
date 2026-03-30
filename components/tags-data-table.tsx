"use client";

import { useState } from "react";
import { Tag, Trash2, Search, Archive, Check } from "lucide-react";
import { useRouter } from "next/navigation";

type WorkspaceTag = {
  id: string;
  name: string;
  color: string;
  projectId: string | null;
  isBillableDefault: boolean;
  status: "active" | "archived";
};

type Project = {
  id: string;
  name: string;
};

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

export function TagsDataTable({ initialTags, projects }: { initialTags: WorkspaceTag[], projects: Project[] }) {
  const router = useRouter();
  const [tags, setTags] = useState<WorkspaceTag[]>(initialTags);
  const [search, setSearch] = useState("");
  const [updating, setUpdating] = useState<string | null>(null);
  
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(COLORS[0].value);
  const [creating, setCreating] = useState(false);

  const filteredTags = tags.filter(t => t.name.toLowerCase().includes(search.toLowerCase()));

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
        setTags([data.tag, ...tags]);
        setNewTagName("");
        router.refresh();
      }
    } finally {
      setCreating(false);
    }
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
        setTags(tags.map(t => t.id === id ? data.tag : t));
        router.refresh();
      }
    } finally {
      setUpdating(null);
    }
  }

  async function deleteTag(id: string) {
    if (!confirm("Are you sure you want to completely remove this tag?")) return;
    setUpdating(id);
    try {
      const res = await fetch(`/api/settings/tags?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setTags(tags.filter(t => t.id !== id));
        router.refresh();
      }
    } finally {
      setUpdating(null);
    }
  }

  return (
    <div className="rounded-2xl border border-white/5 bg-slate-900/50 shadow-xl overflow-hidden flex flex-col">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-white/5 bg-slate-800/20 p-4">
        <div className="relative w-full sm:max-w-xs">
           <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
           <input 
             value={search}
             onChange={(e) => setSearch(e.target.value)}
             placeholder="Filter tags..."
             className="w-full rounded-xl border border-white/10 bg-black/20 pl-10 pr-4 py-2.5 text-sm text-white focus:border-cyan-500 focus:outline-none transition"
           />
        </div>
        
        <form onSubmit={createTag} className="flex flex-wrap sm:flex-nowrap w-full sm:w-auto items-center gap-3">
            <input 
                type="text"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder="New Tag Name"
                className="w-full sm:w-48 rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm text-white focus:border-cyan-500 focus:outline-none transition"
            />
            <div className="flex items-center gap-2 px-1">
                {COLORS.slice(0, 5).map(c => (
                    <button
                        key={c.value}
                        type="button"
                        onClick={() => setNewTagColor(c.value)}
                        className={`h-6 w-6 shrink-0 rounded-full transition-all ${newTagColor === c.value ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900 scale-110' : 'opacity-60 hover:opacity-100'}`}
                        style={{ backgroundColor: c.value }}
                        title={c.name}
                        aria-label={`Select color ${c.name}`}
                    />
                ))}
            </div>
            <button
                type="submit"
                disabled={creating || !newTagName.trim()}
                className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-xl bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-50"
            >
                {creating ? "Adding..." : "Add Tag"}
            </button>
        </form>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-slate-800/50 text-slate-400">
            <tr>
              <th className="px-6 py-4 font-medium">Tag Info</th>
              <th className="px-6 py-4 font-medium">Project Scope</th>
              <th className="px-6 py-4 font-medium">Status & Billing</th>
              <th className="px-6 py-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {filteredTags.length === 0 ? (
              <tr>
                 <td colSpan={4} className="px-6 py-8 text-center text-slate-500">
                    <Tag className="mx-auto h-8 w-8 opacity-50 mb-3" />
                    No tags found matching your filter.
                 </td>
              </tr>
            ) : filteredTags.map(tag => (
              <tr key={tag.id} className={`transition-colors hover:bg-white/5 ${tag.status === 'archived' ? 'opacity-50' : ''}`}>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="relative group">
                       <div className="h-5 w-5 rounded shadow-inner cursor-pointer" style={{ backgroundColor: tag.color }} />
                       {/* Color Picker Dropdown on Hover could go here, for now simple */}
                    </div>
                    <span className="font-semibold text-white">#{tag.name}</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <select 
                    aria-label="Select Project Scope"
                    value={tag.projectId || "global"}
                    onChange={(e) => updateTag(tag.id, { projectId: e.target.value === "global" ? null : e.target.value })}
                    disabled={updating === tag.id}
                    className="rounded-lg border border-white/5 bg-black/20 px-3 py-1.5 text-xs text-slate-300 focus:border-cyan-500 focus:outline-none disabled:opacity-50"
                  >
                     <option value="global">Global (All Projects)</option>
                     {projects.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                     ))}
                  </select>
                </td>
                <td className="px-6 py-4">
                  <div className="flex flex-col gap-2">
                     <button
                        onClick={() => updateTag(tag.id, { isBillableDefault: !tag.isBillableDefault })}
                        disabled={updating === tag.id}
                        className={`inline-flex w-max items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium transition ${tag.isBillableDefault ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/30' : 'bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700'}`}
                     >
                        <Check className="h-3 w-3" /> {tag.isBillableDefault ? 'Billable Default' : 'Non-Billable'}
                     </button>
                     <button
                        onClick={() => updateTag(tag.id, { status: tag.status === 'active' ? 'archived' : 'active' })}
                        disabled={updating === tag.id}
                        className={`inline-flex w-max items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium transition ${tag.status === 'active' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:bg-rose-500/30'}`}
                     >
                        {tag.status === 'active' ? 'Active' : 'Archived'}
                     </button>
                  </div>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-2">
                    <button 
                       onClick={() => updateTag(tag.id, { status: tag.status === "active" ? "archived" : "active" })}
                       disabled={updating === tag.id}
                       title={tag.status === "active" ? "Archive Tag" : "Restore Tag"}
                       className="p-2 text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-white/10"
                    >
                       <Archive className="h-4 w-4" />
                    </button>
                    <button 
                       onClick={() => deleteTag(tag.id)}
                       disabled={updating === tag.id}
                       title="Delete Tag"
                       className="p-2 text-slate-400 hover:text-rose-400 transition-colors rounded-lg hover:bg-white/10"
                    >
                       <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
