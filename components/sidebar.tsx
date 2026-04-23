"use client";

import { useState, useEffect, type ComponentType } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  CheckSquare,
  Clock,
  FolderKanban,
  LogOut,
  Receipt,
  Settings,
  Tag,
  Users,
  Webhook,
} from "lucide-react";

type NavItem = {
  name: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  prefix?: string;
  showBadge?: boolean;
};

type NavSection = {
  label: string;
  items: NavItem[];
};

function routeIsActive(pathname: string, item: NavItem) {
  if (pathname === item.href) return true;
  const prefix = item.prefix ?? `${item.href}/`;
  return pathname.startsWith(prefix);
}

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

  const navSections: NavSection[] = [
    {
      label: "Track",
      items: [
        { name: "Time Tracker", href: "/dashboard", icon: Clock },
        { name: "Activity", href: "/activity", icon: CalendarDays },
        { name: "Calendar", href: "/calendar", icon: CalendarDays },
      ],
    },
    {
      label: "Analyze",
      items: [
        { name: "Reports", href: "/reports", icon: BarChart3 },
        { name: "Approvals", href: "/approvals", icon: CheckSquare },
        { name: "Invoices", href: "/invoices", icon: Receipt },
      ],
    },
    {
      label: "Manage",
      items: [
        { name: "Projects", href: "/projects", icon: FolderKanban },
        { name: "Clients", href: "/clients", icon: Building2 },
        { name: "Planner", href: "/planner", icon: Users },
        { name: "Notifications", href: "/notifications", icon: Bell, showBadge: true },
      ],
    },
    {
      label: "Configure",
      items: [
        { name: "Workspace Settings", href: "/settings", icon: Settings },
        { name: "Billing", href: "/settings/billing", icon: Receipt },
        { name: "Tags", href: "/settings/tags", icon: Tag },
        { name: "Webhooks", href: "/settings/webhooks", icon: Webhook },
      ],
    },
  ];

  const mobileNav: NavItem[] = [
    { name: "Timer", href: "/dashboard", icon: Clock },
    { name: "Calendar", href: "/calendar", icon: CalendarDays },
    { name: "Projects", href: "/projects", icon: FolderKanban },
    { name: "Reports", href: "/reports", icon: BarChart3 },
    { name: "Settings", href: "/settings", icon: Settings, prefix: "/settings", showBadge: true },
  ];

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 z-50 w-72 flex-col border-r border-slate-800/80 bg-slate-950/95">
        {/* Brand */}
        <div className="border-b border-slate-800/80 px-6 py-5">
          <div className="flex items-center">
            <Image src="/logo.png" alt="Billabled" width={28} height={28} className="mr-3 rounded-md" unoptimized />
            <div>
              <p className="text-lg font-semibold tracking-tight text-slate-100">Billabled</p>
              <p className="text-xs text-slate-500">Workforce Operations</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex flex-1 flex-col overflow-y-auto px-4 py-4">
          {navSections.map((section) => (
            <div key={section.label} className="mb-6">
              <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">{section.label}</p>
              <div className="space-y-1">
                {section.items.map((item) => {
                  const isActive = routeIsActive(pathname, item);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`group flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                        isActive
                          ? "bg-cyan-500/15 text-cyan-300 ring-1 ring-cyan-500/35"
                          : "text-slate-300 hover:bg-slate-900 hover:text-slate-100"
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <Icon className={`h-4 w-4 ${isActive ? "text-cyan-300" : "text-slate-500 group-hover:text-slate-300"}`} />
                        {item.name}
                      </span>
                      {item.showBadge && unreadCount > 0 && (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">
                          {unreadCount}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-slate-800/80 p-4">
          <Link
            href="/api/auth/logout"
            className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-rose-500/10 hover:text-rose-300"
          >
            <LogOut className="h-4 w-4 text-slate-500 group-hover:text-rose-300" />
            Sign out
          </Link>
        </div>
      </aside>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 z-50 flex w-full items-center justify-around border-t border-slate-800 bg-slate-950/95 px-2 py-3 pb-safe shadow-[0_-10px_35px_rgba(0,0,0,0.45)]">
        {mobileNav.map((item) => {
          const isActive = routeIsActive(pathname, item);
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
              {item.showBadge && unreadCount > 0 && (
                <span className="absolute right-2 top-1 flex h-3 w-3 items-center justify-center rounded-full bg-rose-500 text-[8px] font-bold text-white shadow-sm ring-2 ring-slate-950" />
              )}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
