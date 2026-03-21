"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clock, FolderKanban, CalendarDays, Settings, LogOut, Bell, Users, BarChart3, CheckSquare, Receipt, Webhook } from "lucide-react";

export function Sidebar() {
  const pathname = usePathname();

  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    async function fetchNotifications() {
      try {
        const res = await fetch("/api/notifications");
        if (res.ok) {
          const data = await res.json();
          const unread = data.notifications?.filter((n: { read: boolean }) => !n.read).length || 0;
          setUnreadCount(unread);
        }
      } catch {
        // silently fail
      }
    }
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, []);

  const navItems = [
    { name: "Timer", href: "/", icon: Clock },
    { name: "Projects", href: "/projects", icon: FolderKanban },
    { name: "Planner", href: "/planner", icon: Users },
    { name: "Reports", href: "/reports", icon: BarChart3 },
    { name: "Approvals", href: "/approvals", icon: CheckSquare },
    { name: "Invoices", href: "/invoices", icon: Receipt },
    { name: "Calendar", href: "/calendar", icon: CalendarDays },
    { name: "Notifications", href: "/notifications", icon: Bell },
    { name: "Billing Actions", href: "/settings/actions", icon: Settings },
    { name: "Webhooks", href: "/settings/webhooks", icon: Webhook },
  ];

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 z-50 w-64 flex-col border-r border-slate-800 bg-[#050914]">
        {/* Brand */}
        <div className="flex h-16 shrink-0 items-center px-6">
          <span className="text-xl font-bold tracking-tight text-white">Timely</span>
          <span className="ml-2 rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-cyan-400 uppercase">Pro</span>
        </div>

        {/* Navigation */}
        <nav className="flex flex-1 flex-col gap-1 px-4 py-4">
          {navItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                  isActive
                    ? "bg-cyan-500/10 text-cyan-400"
                    : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-100"
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`h-4 w-4 ${isActive ? "text-cyan-400" : "text-slate-500 group-hover:text-slate-300"}`} />
                  {item.name}
                </div>
                {item.name === "Notifications" && unreadCount > 0 && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-sm ring-2 ring-[#050914]">
                    {unreadCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-slate-800 p-4">
          <Link
            href="/api/auth/logout"
            className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-400 transition-all hover:bg-red-500/10 hover:text-red-400"
          >
            <LogOut className="h-4 w-4 text-slate-500 group-hover:text-red-400" />
            Sign out
          </Link>
        </div>
      </aside>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 z-50 flex w-full items-center justify-around border-t border-slate-800 bg-[#050914] px-2 py-3 pb-safe shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex flex-col items-center justify-center gap-1 p-2 transition-all ${
                isActive ? "text-cyan-400" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{item.name}</span>
              {item.name === "Notifications" && unreadCount > 0 && (
                <span className="absolute right-3 top-1 flex h-3 w-3 items-center justify-center rounded-full bg-red-500 text-[8px] font-bold text-white shadow-sm ring-2 ring-[#050914]" />
              )}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
