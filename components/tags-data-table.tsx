"use client";

import { useState } from "react";
import { Tag as TagIcon, Trash2, Search, Archive, Check, Edit2, XIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

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

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");

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

  function startEdit(tag: WorkspaceTag) {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditColor(tag.color);
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) return;
    await updateTag(id, { name: editName, color: editColor });
    setEditingId(null);
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
    <div className="space-y-6">
      {/* Glow effect background layer */}
      <div className="relative">
        <div className="absolute inset-0 -z-10 rounded-3xl bg-gradient-to-b from-cyan-500/5 to-transparent blur-2xl flex items-center justify-center">
            <div className="h-full w-full max-w-lg bg-cyan-500/10 rounded-full blur-[100px]" />
        </div>

        <div className="rounded-3xl border border-white/10 bg-[#0a0f1c]/70 backdrop-blur-3xl shadow-2xl overflow-hidden flex flex-col">
          {/* Toolbar */}
          <div className="flex flex-col xl:flex-row items-center justify-between gap-4 border-b border-white/5 bg-slate-800/20 p-5">
            <div className="relative w-full xl:max-w-md">
               <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
               <input 
                 value={search}
                 onChange={(e) => setSearch(e.target.value)}
                 placeholder="Search or filter tags..."
                 className="w-full rounded-2xl border border-white/10 bg-black/40 pl-11 pr-4 py-3 text-sm text-white placeholder-slate-500 focus:border-cyan-500/50 focus:bg-black/60 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 transition-all shadow-inner"
               />
            </div>
            
            <form onSubmit={createTag} className="flex flex-col sm:flex-row w-full xl:w-auto items-center gap-3">
                <input 
                    type="text"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    placeholder="Enter new tag..."
                    className="w-full sm:w-52 rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-cyan-500/50 focus:bg-black/60 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 transition-all shadow-inner"
                />
                <div className="flex w-full sm:w-auto items-center gap-1.5 px-3 py-2 rounded-2xl border border-white/5 bg-black/20 justify-center">
                    {COLORS.slice(0, 8).map(c => (
                        <button
                            key={c.value}
                            type="button"
                            onClick={() => setNewTagColor(c.value)}
                            className={`h-5 w-5 shrink-0 rounded-full transition-all ${newTagColor === c.value ? 'ring-2 ring-white scale-125 z-10 shadow-lg' : 'opacity-40 hover:opacity-100 hover:scale-110'}`}
                            style={{ backgroundColor: c.value, boxShadow: newTagColor === c.value ? `0 0 10px ${c.value}80` : 'none' }}
                            title={c.name}
                            aria-label={`Select color ${c.name}`}
                        />
                    ))}
                </div>
                <button
                    type="submit"
                    disabled={creating || !newTagName.trim()}
                    className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-500 to-cyan-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 transition hover:from-cyan-400 hover:to-cyan-500 disabled:opacity-50 hover:shadow-cyan-400/40"
                >
                    {creating ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" /> : <PlusIcon className="h-4 w-4" />}
                    <span>Add Tag</span>
                </button>
            </form>
          </div>

          {/* Data List area */}
          <div className="p-3 sm:p-5">
            <AnimatePresence mode="popLayout">
              {filteredTags.length === 0 ? (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="px-6 py-20 text-center"
                >
                  <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-[2rem] bg-slate-800/40 border border-white/5 shadow-inner mb-6 relative">
                    <div className="absolute inset-0 rounded-[2rem] bg-cyan-500/10 blur-xl" />
                    <TagIcon className="h-10 w-10 text-slate-500 relative z-10" />
                  </div>
                  <h3 className="text-xl font-medium text-white mb-2">No tags available</h3>
                  <p className="text-slate-400 text-sm max-w-sm mx-auto">
                    {search ? "No tags match your search filter." : "Create meaningful tags to categorize your time entries and map them to billing frameworks."}
                  </p>
                </motion.div>
              ) : (
                <div className="space-y-3">
                  <div className="hidden lg:grid grid-cols-12 gap-4 px-6 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <div className="col-span-4">Tag Details</div>
                    <div className="col-span-3">Project Scope</div>
                    <div className="col-span-3">Billing Status</div>
                    <div className="col-span-2 text-right">Actions</div>
                  </div>

                  {filteredTags.map(tag => (
                    <motion.div 
                      layout
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      key={tag.id} 
                      className={`group relative grid grid-cols-1 lg:grid-cols-12 gap-4 items-center rounded-2xl border border-white/5 bg-white/[0.015] p-4 transition-all duration-300 hover:bg-white/[0.04] hover:border-cyan-500/20 hover:shadow-xl hover:shadow-cyan-900/10 ${tag.status === 'archived' ? 'opacity-40 grayscale hover:opacity-100 hover:grayscale-0' : ''}`}
                    >
                      {/* Tag Name Column */}
                      <div className="col-span-4 flex items-center pr-4">
                        {editingId === tag.id ? (
                          <div className="flex w-full items-center gap-3 bg-black/40 rounded-xl p-2.5 border border-white/10 shadow-inner">
                            <div className="flex gap-1.5 shrink-0 px-1">
                              {COLORS.slice(0, 4).map(c => (
                                <div 
                                  key={c.value} 
                                  onClick={() => setEditColor(c.value)}
                                  className={`w-4 h-4 rounded-full cursor-pointer transition-transform ${editColor === c.value ? 'ring-2 ring-white scale-125' : 'opacity-40 hover:opacity-100'}`}
                                  style={{ backgroundColor: c.value }}
                                />
                              ))}
                            </div>
                            <input 
                              type="text" 
                              title="Tag Name"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className="bg-transparent text-white text-sm font-semibold outline-none w-full border-l border-white/10 pl-3"
                              autoFocus
                              onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(tag.id); if (e.key === 'Escape') setEditingId(null); }}
                            />
                          </div>
                        ) : (
                          <div className="flex items-center gap-4 group/item cursor-pointer" onClick={() => startEdit(tag)}>
                            <div className="relative flex items-center justify-center w-12 h-12 rounded-xl bg-black/40 border border-white/5 shadow-inner transition-transform group-hover:scale-105 group-hover:bg-black/60">
                               <div className="w-5 h-5 rounded-full shadow-lg transition-transform group-hover:scale-110" style={{ backgroundColor: tag.color, boxShadow: `0 0 16px ${tag.color}80` }} />
                            </div>
                            <div>
                               <span className="font-semibold tracking-tight text-slate-300 group-hover/item:text-white transition-colors text-base">#{tag.name}</span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Scope Column */}
                      <div className="col-span-3">
                        <select 
                          aria-label="Select Project Scope"
                          value={tag.projectId || "global"}
                          onChange={(e) => updateTag(tag.id, { projectId: e.target.value === "global" ? null : e.target.value })}
                          disabled={updating === tag.id}
                          className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-slate-300 font-medium focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 disabled:opacity-50 transition-colors shadow-inner"
                        >
                           <option value="global" className="bg-slate-900">Global Scope (All)</option>
                           <option disabled className="bg-slate-900">──────────</option>
                           {projects.map(p => (
                              <option key={p.id} value={p.id} className="bg-slate-900">{p.name}</option>
                           ))}
                        </select>
                      </div>

                      {/* Status Column */}
                      <div className="col-span-3 flex flex-wrap gap-2">
                        <button
                            onClick={() => updateTag(tag.id, { isBillableDefault: !tag.isBillableDefault })}
                            disabled={updating === tag.id}
                            className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-semibold transition-all ${tag.isBillableDefault ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/20' : 'bg-slate-800/50 text-slate-400 border border-slate-700/50 hover:bg-slate-700 hover:text-slate-300'}`}
                        >
                            <Check className="h-3.5 w-3.5" /> 
                            {tag.isBillableDefault ? 'Billable' : 'Non-Billable'}
                        </button>
                        <button
                            onClick={() => updateTag(tag.id, { status: tag.status === 'active' ? 'archived' : 'active' })}
                            disabled={updating === tag.id}
                            className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-semibold transition-all ${tag.status === 'active' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.1)]' : 'bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20'}`}
                        >
                            {tag.status === 'active' ? 'Active' : 'Archived'}
                        </button>
                      </div>

                      {/* Actions Column */}
                      <div className="col-span-2 flex items-center justify-end gap-2">
                        {editingId === tag.id ? (
                          <>
                            <button onClick={() => saveEdit(tag.id)} title="Save changes" className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-colors border border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.2)]">
                              <Check className="h-4 w-4" />
                            </button>
                            <button onClick={() => setEditingId(null)} title="Cancel editing" className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800/50 text-slate-400 hover:bg-slate-700 hover:text-white transition-colors border border-slate-700/50">
                              <XIcon className="h-4 w-4" />
                            </button>
                          </>
                        ) : (
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                            <button onClick={() => startEdit(tag)} disabled={updating === tag.id} title="Edit Tag" className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 hover:bg-white/10 hover:text-white transition-colors border border-transparent">
                               <Edit2 className="h-4 w-4" />
                            </button>
                            <button 
                               onClick={() => updateTag(tag.id, { status: tag.status === "active" ? "archived" : "active" })}
                               disabled={updating === tag.id}
                               title={tag.status === "active" ? "Archive Tag" : "Restore Tag"}
                               className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 hover:bg-white/10 hover:text-white transition-colors border border-transparent"
                            >
                               <Archive className="h-4 w-4" />
                            </button>
                            <button 
                               onClick={() => deleteTag(tag.id)}
                               disabled={updating === tag.id}
                               title="Delete Tag"
                               className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 hover:bg-rose-500/10 hover:text-rose-400 transition-colors border border-transparent"
                            >
                               <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
