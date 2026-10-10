"use client";

import { useEffect, useState } from "react";
import { Bell, CheckCheck, CheckSquare, Clock, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { DataLoadNotice } from "@/components/data-load-notice";

type AppNotification = {
  id: string;
  message: string;
  read: boolean;
  createdAt: string;
};

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    async function fetchNotifications() {
      try {
        const res = await fetch("/api/notifications");
        if (!res.ok) throw new Error("Notifications unavailable");
        const data = await res.json();
        setNotifications(data.notifications || []);
      } catch {
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    }
    fetchNotifications();
  }, []);

  async function markAllAsRead() {
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAllRead: true }),
      });
      if (!res.ok) throw new Error("Request failed");
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      toast.success("All notifications marked as read");
    } catch {
      toast.error("Could not update notifications. Please try again.");
    }
  }

  async function markAsRead(id: string) {
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationId: id }),
      });
      if (!res.ok) throw new Error("Request failed");
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
      toast.success("Notification marked as read");
    } catch {
      toast.error("Could not mark this notification as read. Please try again.");
    }
  }

  const unread = notifications.filter((notification) => !notification.read);
  const read = notifications.filter((notification) => notification.read);

  return (
    <main className="min-h-screen bg-[#f6f3ee] p-4 text-slate-950 sm:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Review</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Notifications</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-500">Review reminders and updates from your workspace.</p>
            </div>
            <button
              onClick={markAllAsRead}
              disabled={loading || loadError || unread.length === 0}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800"
            >
              <CheckSquare className="h-4 w-4" />
              Mark all as read
            </button>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-cyan-700">
                <Bell className="h-4 w-4" />
                <span className="text-xs font-bold uppercase tracking-[0.2em]">Unread</span>
              </div>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{unread.length}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-cyan-700">
                <CheckCheck className="h-4 w-4" />
                <span className="text-xs font-bold uppercase tracking-[0.2em]">Read</span>
              </div>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{read.length}</p>
            </div>
            <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4">
              <div className="flex items-center gap-2 text-cyan-700">
                <Sparkles className="h-4 w-4" />
                <span className="text-xs font-bold uppercase tracking-[0.2em]">Focus</span>
              </div>
              <p className="mt-2 text-sm font-semibold text-slate-950">Mark an update as read when you have reviewed it. Unread updates appear first.</p>
            </div>
          </div>
        </header>

        <section className="rounded-[32px] border border-slate-200 bg-white shadow-sm">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-slate-500 animate-pulse">Loading notifications...</div>
          ) : loadError ? (
            <DataLoadNotice message="We couldn't load your notifications." />
          ) : notifications.length === 0 ? (
            <div className="flex h-56 flex-col items-center justify-center text-slate-500">
              <Bell className="mb-4 h-10 w-10 text-slate-300" />
              <p className="text-lg font-semibold text-slate-950">No notifications yet</p>
              <p className="mt-2 max-w-md text-center text-sm text-slate-500">New workspace reminders and updates will appear here. There is nothing to review right now.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {[...unread, ...read].map((n) => (
                <div
                  key={n.id}
                  className={`flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-start sm:justify-between ${!n.read ? "bg-cyan-50/70" : "bg-white"}`}
                >
                  <div className="flex items-start gap-4">
                    <div className={`mt-1 h-3 w-3 rounded-full ${!n.read ? "bg-cyan-500" : "bg-slate-200"}`} />
                    <div>
                      <p className={`text-sm ${!n.read ? "font-semibold text-slate-950" : "text-slate-600"}`}>{n.message}</p>
                      <div className="mt-2 flex items-center gap-1 text-xs text-slate-500">
                        <Clock className="h-3 w-3" />
                        {new Date(n.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  {!n.read && (
                    <button
                      onClick={() => markAsRead(n.id)}
                      className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition hover:border-cyan-200 hover:text-cyan-700"
                    >
                      Mark as read
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
