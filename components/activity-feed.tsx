"use client";

import { useEffect, useState } from "react";
import { Activity, Clock, Edit2, Play, Square, Trash2 } from "lucide-react";

type Diff = Record<string, { before: unknown; after: unknown }>;

type AuditActivity = {
  id: string;
  eventType: string;
  diff: Diff;
  createdAt: string;
  actor: { name: string; id: string };
  target: { id: string; description: string };
};

export function ActivityFeed({ projectId }: { projectId?: string }) {
  const [activities, setActivities] = useState<AuditActivity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchActivities() {
      const url = projectId ? `/api/activity?projectId=${projectId}` : `/api/activity`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setActivities(data.activities || []);
      }
      setLoading(false);
    }
    fetchActivities();
  }, [projectId]);

  const renderActionLabel = (eventType: string) => {
    switch (eventType) {
      case "CREATE": return <span className="font-semibold text-emerald-700">started tracking</span>;
      case "STOP": return <span className="font-semibold text-rose-700">stopped tracking</span>;
      case "UPDATE": return <span className="font-semibold text-cyan-700">updated</span>;
      case "DELETE": return <span className="font-semibold text-red-700">deleted</span>;
      default: return <span className="font-semibold text-slate-600">modified</span>;
    }
  };

  const renderIcon = (eventType: string) => {
    switch (eventType) {
      case "CREATE": return <Play className="h-3 w-3 text-emerald-700" />;
      case "STOP": return <Square className="h-3 w-3 text-rose-700" />;
      case "UPDATE": return <Edit2 className="h-3 w-3 text-cyan-700" />;
      case "DELETE": return <Trash2 className="h-3 w-3 text-red-700" />;
      default: return <Activity className="h-3 w-3 text-slate-400" />;
    }
  };

  const renderDiffs = (diff: Diff) => {
    const keys = Object.keys(diff).filter(k => k !== "id" && k !== "updatedAt");
    if (keys.length === 0) return null;
    return (
      <div className="mt-2 flex flex-col gap-1 rounded-2xl border border-slate-200 bg-slate-50 p-2 text-xs font-mono text-slate-500 shadow-inner">
        {keys.map(k => {
          const change = diff[k];
          return (
            <div key={k} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
              <span className="text-slate-500 font-semibold">{k}:</span>
              <div className="flex items-center gap-1 overflow-hidden truncate">
                <span className="line-through opacity-70 truncate max-w-[120px]">{JSON.stringify(change.before)}</span>
                <span className="text-slate-600">→</span>
                <span className="text-cyan-700 truncate max-w-[120px]">{JSON.stringify(change.after)}</span>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  if (loading) {
    return <div className="p-4 text-center text-sm text-slate-500 animate-pulse">Loading activity...</div>;
  }

  if (activities.length === 0) {
    return <div className="p-6 text-center text-sm text-slate-500">No recent activity.</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      {activities.map((activity, index) => (
        <div key={activity.id} className="relative flex gap-4">
          {index !== activities.length - 1 && (
            <div className="absolute bottom-[-16px] left-4 top-8 w-[1px] bg-slate-200" />
          )}
          <div className="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm">
            {renderIcon(activity.eventType)}
          </div>
          <div className="flex-1 pb-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-600">
                <span className="font-medium text-slate-950">{activity.actor.name}</span>{" "}
                {renderActionLabel(activity.eventType)}{" "}
                <span className="font-medium text-slate-500 truncate max-w-[150px] inline-block align-bottom">{activity.target.description}</span>
              </p>
              <div className="flex items-center gap-1 text-xs text-slate-500 shrink-0">
                <Clock className="h-3 w-3" />
                {new Date(activity.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
            {renderDiffs(activity.diff)}
          </div>
        </div>
      ))}
    </div>
  );
}
