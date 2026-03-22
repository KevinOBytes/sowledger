"use client";

import { useState, useEffect } from "react";
import { Tag, Loader2, Plus, Trash2 } from "lucide-react";

type WorkspaceTag = {
  id: string;
  name: string;
  color: string;
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

export default function TagsSettingsPage() {
  const [tags, setTags] = useState<WorkspaceTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(COLORS[0].value);

  useEffect(() => {
    fetchTags();
  }, []);

  async function fetchTags() {
    try {
      const res = await fetch("/api/settings/tags");
      if (res.ok) {
        const data = await res.json();
        setTags(data.tags);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateTag(e: React.FormEvent) {
    e.preventDefault();
    if (!newTagName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTagName, color: newTagColor }),
      });
      if (res.ok) {
        setNewTagName("");
        fetchTags();
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteTag(id: string) {
    if (!confirm("Are you sure you want to remove this tag's color configuration?")) return;
    try {
      const res = await fetch(`/api/settings/tags?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setTags(tags.filter(t => t.id !== id));
      }
    } catch {
      // ignore
    }
  }

  if (loading) {
    return (
      <div className="flex animate-pulse flex-col space-y-4">
        <div className="h-8 w-1/4 rounded bg-slate-800"></div>
        <div className="h-32 rounded-xl bg-slate-800/50"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-white">Tag Management</h2>
        <p className="mt-2 text-sm text-slate-400">
          Configure persistent color coding for your workspace tags. Timer entries using these tags will adopt their customized appearance across the dashboard.
        </p>
      </div>

      <div className="rounded-2xl border border-white/5 bg-slate-900/50 p-6 shadow-xl">
        <h3 className="text-lg font-medium text-white mb-6">Active Tags</h3>
        
        {tags.length === 0 ? (
          <div className="text-center py-8">
            <Tag className="mx-auto h-12 w-12 text-slate-700 opacity-50 mb-3" />
            <p className="text-sm text-slate-500">No tag colors configured. Time entries will use default slate colors.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-8">
             {tags.map(tag => (
                 <div key={tag.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="flex items-center gap-3">
                        <div className="h-4 w-4 rounded-full shadow-inner" style={{ backgroundColor: tag.color }} />
                        <span className="font-medium text-slate-200">#{tag.name}</span>
                    </div>
                    <button 
                       onClick={() => handleDeleteTag(tag.id)}
                       className="p-2 text-slate-500 hover:text-rose-400 transition-colors rounded-lg hover:bg-white/5"
                    >
                        <Trash2 className="h-4 w-4" />
                    </button>
                 </div>
             ))}
          </div>
        )}

        <div className="mt-8 border-t border-white/10 pt-8">
            <h4 className="text-sm font-medium text-slate-300 mb-4">Add or Update Tag Color</h4>
            <form onSubmit={handleCreateTag} className="flex flex-col sm:flex-row gap-4 items-end">
                <div className="flex-1 w-full">
                    <label className="block text-xs font-medium text-slate-400 mb-2">Tag Name</label>
                    <input 
                        type="text"
                        value={newTagName}
                        onChange={(e) => setNewTagName(e.target.value)}
                        placeholder="e.g. deep-work"
                        className="w-full rounded-lg border border-white/10 bg-black/20 px-4 py-2.5 text-sm text-white focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none"
                    />
                </div>
                <div className="flex-1 w-full">
                    <label className="block text-xs font-medium text-slate-400 mb-2">Color Setup</label>
                    <div className="flex items-center gap-2 overflow-x-auto pb-1">
                        {COLORS.map(c => (
                            <button
                                key={c.value}
                                type="button"
                                onClick={() => setNewTagColor(c.value)}
                                className={`h-8 w-8 shrink-0 rounded-full transition-all ${newTagColor === c.value ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900 scale-110' : 'opacity-60 hover:opacity-100'}`}
                                style={{ backgroundColor: c.value }}
                                title={c.name}
                            />
                        ))}
                    </div>
                </div>
                <button
                    type="submit"
                    disabled={saving || !newTagName.trim()}
                    className="flex h-10 shrink-0 w-full sm:w-auto items-center justify-center gap-2 rounded-lg bg-cyan-600 px-6 font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-50"
                >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Save Label
                </button>
            </form>
        </div>
      </div>
    </div>
  );
}
