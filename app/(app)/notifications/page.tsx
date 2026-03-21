"use client";

import { useEffect, useState } from "react";
import { Bell, CheckSquare, Clock } from "lucide-react";

type AppNotification = {
  id: string;
  message: string;
  read: boolean;
  createdAt: string;
};

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchNotifications();
  }, []);

  async function fetchNotifications() {
    const res = await fetch("/api/notifications");
    if (res.ok) {
      const data = await res.json();
      setNotifications(data.notifications || []);
    }
    setLoading(false);
  }

  async function markAllAsRead() {
    const res = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAllRead: true }),
    });
    if (res.ok) {
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    }
  }

  async function markAsRead(id: string) {
    const res = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notificationId: id }),
    });
    if (res.ok) {
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    }
  }

  return (
    <main className="flex h-screen flex-col bg-[#050914] p-6 sm:p-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Notifications</h1>
          <p className="mt-2 text-sm text-slate-400">Review your alerts and unread messages.</p>
        </div>
        <button
          onClick={markAllAsRead}
          className="flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700 hover:text-white"
        >
          <CheckSquare className="h-4 w-4" />
          Mark all as read
        </button>
      </div>

      <div className="flex-1 overflow-y-auto rounded-2xl border border-white/5 bg-slate-900/40 shadow-xl backdrop-blur-xl">
        {loading ? (
          <div className="flex h-40 items-center justify-center text-slate-500 animate-pulse">Loading notifications...</div>
        ) : notifications.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center text-slate-500">
            <Bell className="mb-2 h-8 w-8 opacity-20" />
            <p>You have no notifications yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {notifications.map((n) => (
              <div
                key={n.id}
                className={`flex items-start justify-between p-4 px-6 transition-colors ${
                  !n.read ? "bg-cyan-500/5" : "hover:bg-white/[0.02]"
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className={`mt-1 flex h-2 w-2 rounded-full ${!n.read ? "bg-cyan-400" : "bg-transparent"}`} />
                  <div>
                    <p className={`text-sm ${!n.read ? "font-semibold text-white" : "text-slate-300"}`}>{n.message}</p>
                    <div className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                      <Clock className="h-3 w-3" />
                      {new Date(n.createdAt).toLocaleString()}
                    </div>
                  </div>
                </div>
                {!n.read && (
                  <button
                    onClick={() => markAsRead(n.id)}
                    className="rounded-lg px-3 py-1 text-xs font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
                  >
                    Mark as read
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
